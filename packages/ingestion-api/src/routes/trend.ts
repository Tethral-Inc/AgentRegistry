import { Hono } from 'hono';
import { query, createLogger, FrictionScope, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'trend' });
const app = new Hono();

/**
 * GET /agent/{id}/trend — Period-over-period raw comparison.
 *
 * Returns the raw per-target stats for the current window and the
 * previous window of the same length, alongside the delta between them.
 * Does NOT return a synthetic "direction" label computed from hidden
 * thresholds. Clients interpret the numbers.
 *
 * Free tier.
 */

interface TargetWindow {
  target: string;
  median_duration_ms: number | null;
  failure_rate: number;
  receipt_count: number;
}

function getScopeWindows(scope: string): { current: { start: Date; end: Date }; previous: { start: Date; end: Date } } {
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
  const periodMs = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime());
  const previousStart = new Date(start.getTime() - periodMs);
  return { current: { start, end }, previous: { start: previousStart, end: previousEnd } };
}

async function fetchWindow(agentId: string, start: Date, end: Date): Promise<TargetWindow[]> {
  return query<TargetWindow>(
    `SELECT
       target_system_id AS "target",
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "median_duration_ms",
       COALESCE(
         COUNT(*) FILTER (WHERE status IN ('failure', 'timeout'))::float /
         NULLIF(COUNT(*), 0), 0
       ) AS "failure_rate",
       COUNT(*)::int AS "receipt_count"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3
       AND duration_ms IS NOT NULL
     GROUP BY target_system_id
     HAVING COUNT(*) >= 5`,
    [agentId, start.toISOString(), end.toISOString()],
  ).catch(() => []);
}

app.get('/agent/:agent_id/trend', async (c) => {
  const identifier = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'day';

  const scopeParsed = FrictionScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be session, day, or week'), 400);
  }

  const scope = scopeParsed.data;
  const { current, previous } = getScopeWindows(scope);

  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  const [currentRows, previousRows] = await Promise.all([
    fetchWindow(agentId, current.start, current.end),
    fetchWindow(agentId, previous.start, previous.end),
  ]);

  const previousMap = new Map<string, TargetWindow>();
  for (const r of previousRows) previousMap.set(r.target, r);

  // Per-target: raw numbers for both windows + computed delta. No
  // interpretation. A target only appears here if it had >=5 receipts in
  // the CURRENT window (inclusion filter is part of the response).
  const perTarget = currentRows.map((cur) => {
    const prev = previousMap.get(cur.target);
    const latencyChange =
      prev && prev.median_duration_ms && prev.median_duration_ms > 0 && cur.median_duration_ms != null
        ? (cur.median_duration_ms - prev.median_duration_ms) / prev.median_duration_ms
        : null;
    const failureChange =
      prev != null ? cur.failure_rate - prev.failure_rate : null;

    return {
      target: cur.target,
      current: {
        median_duration_ms: cur.median_duration_ms,
        failure_rate: cur.failure_rate,
        receipt_count: cur.receipt_count,
      },
      previous: prev
        ? {
            median_duration_ms: prev.median_duration_ms,
            failure_rate: prev.failure_rate,
            receipt_count: prev.receipt_count,
          }
        : null,
      latency_change_ratio: latencyChange != null ? Math.round(latencyChange * 10000) / 10000 : null,
      failure_rate_delta: failureChange != null ? Math.round(failureChange * 10000) / 10000 : null,
    };
  });

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    current_period: { start: current.start.toISOString(), end: current.end.toISOString() },
    comparison_period: { start: previous.start.toISOString(), end: previous.end.toISOString() },
    inclusion_filter: {
      min_receipts_current_period: 5,
      min_receipts_previous_period: 5,
      requires_duration_ms: true,
    },
    per_target: perTarget,
    tier: 'free',
  });
});

export { app as trendRoute };
