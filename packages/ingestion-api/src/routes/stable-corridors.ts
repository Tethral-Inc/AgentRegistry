import { Hono } from 'hono';
import { query, createLogger, FrictionScope, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'stable-corridors' });
const app = new Hono();

/**
 * GET /agent/{id}/stable-corridors — Targets that match a stability filter.
 *
 * "Stable" here means statistically stable: sufficient sample size,
 * zero failures and zero anomalies in the window, and a coefficient of
 * variation below a threshold. It is not a verdict about whether the
 * target is "good" or "healthy" — it's a description of the measured
 * variance pattern. The filter is fully described in `filter_applied`
 * so clients can reproduce or adjust it.
 *
 * Free tier.
 */

interface CorridorRow {
  target_system_id: string;
  target_system_type: string;
  receipt_count: number;
  median_duration_ms: number | null;
  stddev_duration_ms: number | null;
  failure_rate: number;
  anomaly_rate: number;
}

function getScopeWindow(scope: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  switch (scope) {
    case 'session':
      start.setHours(start.getHours() - 1);
      break;
    case 'day':
      start.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

app.get('/agent/:agent_id/stable-corridors', async (c) => {
  const identifier = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'day';

  const scopeParsed = FrictionScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be session, day, yesterday, or week'), 400);
  }

  const scope = scopeParsed.data;
  const { start, end } = getScopeWindow(scope);

  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  const rows = await query<CorridorRow>(
    `SELECT
       target_system_id AS "target_system_id",
       target_system_type AS "target_system_type",
       COUNT(*)::int AS "receipt_count",
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "median_duration_ms",
       STDDEV(duration_ms)::int AS "stddev_duration_ms",
       COALESCE(
         COUNT(*) FILTER (WHERE status IN ('failure', 'timeout'))::float /
         NULLIF(COUNT(*), 0), 0
       ) AS "failure_rate",
       COALESCE(
         COUNT(*) FILTER (WHERE anomaly_flagged = true)::float /
         NULLIF(COUNT(*), 0), 0
       ) AS "anomaly_rate"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3
       AND duration_ms IS NOT NULL
     GROUP BY target_system_id, target_system_type
     HAVING COUNT(*) >= 10
        AND COUNT(*) FILTER (WHERE status IN ('failure', 'timeout')) = 0
        AND COUNT(*) FILTER (WHERE anomaly_flagged = true) = 0
     ORDER BY COUNT(*) DESC
     LIMIT 50`,
    [agentId, start.toISOString(), end.toISOString()],
  ).catch(() => []);

  // The SQL already filters to receipts >= 10, 0 failures, 0 anomalies.
  // Client-side: also drop entries where coefficient of variation is too
  // high. Both filters are described in filter_applied so the client sees
  // exactly what the result represents.
  const matches = rows
    .filter((r) => {
      if (r.median_duration_ms == null || r.median_duration_ms <= 0) return false;
      if (r.stddev_duration_ms == null) return true;
      return r.stddev_duration_ms / r.median_duration_ms < 0.5;
    })
    .map((r) => ({
      target: r.target_system_id,
      target_type: r.target_system_type,
      interaction_count: r.receipt_count,
      median_duration_ms: r.median_duration_ms,
      stddev_duration_ms: r.stddev_duration_ms,
      coefficient_of_variation:
        r.median_duration_ms && r.stddev_duration_ms != null
          ? Math.round((r.stddev_duration_ms / r.median_duration_ms) * 1000) / 1000
          : null,
    }));

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    filter_applied: {
      min_receipts: 10,
      failure_count: 0,
      anomaly_count: 0,
      max_coefficient_of_variation: 0.5,
    },
    match_count: matches.length,
    matches,
    tier: 'free',
  });
});

export { app as stableCorridorsRoute };
