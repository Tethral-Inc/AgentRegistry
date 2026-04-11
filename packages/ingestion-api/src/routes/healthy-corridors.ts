import { Hono } from 'hono';
import { query, createLogger, FrictionScope, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'healthy-corridors' });
const app = new Hono();

/**
 * GET /agent/{id}/healthy-corridors — The "what's working" surface.
 *
 * Returns targets where the agent has consistently low friction, low
 * failure rate, and low anomaly rate. This is the reassurance / preservation
 * signal — telling the operator what NOT to touch.
 *
 * Free tier. The free version returns count + list with basic stability
 * metrics. Pro tier could later add baseline comparison and variance
 * breakdown showing WHY the corridor is stable.
 *
 * Free tier thresholds:
 *  - At least 10 receipts in the period
 *  - 0% failure rate
 *  - 0% anomaly rate
 *  - Consistent — coefficient of variation under 0.5
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
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

app.get('/agent/:agent_id/healthy-corridors', async (c) => {
  const identifier = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'day';

  const scopeParsed = FrictionScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be session, day, or week'), 400);
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

  // Filter to corridors with reasonable coefficient of variation.
  const corridors = rows
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
      stability_reason: 'no_failures_no_anomalies_low_variance',
    }));

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    corridor_count: corridors.length,
    corridors,
    tier: 'free',
    note:
      corridors.length === 0
        ? 'No healthy corridors detected yet. A corridor needs at least 10 interactions in the period with no failures, no anomalies, and consistent latency.'
        : 'Healthy corridors are targets your agent uses successfully and consistently. Preserve them.',
  });
});

export { app as healthyCorridorsRoute };
