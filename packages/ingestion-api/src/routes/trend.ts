import { Hono } from 'hono';
import { query, createLogger, FrictionScope, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'trend' });
const app = new Hono();

/**
 * GET /agent/{id}/trend — Period-over-period directional trend.
 *
 * Free tier returns DIRECTIONAL ONLY: improving / worsening / stable per
 * target. No magnitudes, no z-scores, no population overlay.
 *
 * The same endpoint at the Pro tier (gated by API key check) would return
 * magnitude (% change), significance, and population overlay. That extension
 * is intentionally not built in this commit — it's a Pro tier addition.
 *
 * Thin client principle: this answers "is anything getting better or worse?"
 * without requiring the client to keep history.
 */

type Direction = 'improving' | 'worsening' | 'stable' | 'insufficient_data';

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

/**
 * Pure directional comparison — no magnitudes leak.
 *
 * A target is:
 *  - improving if median latency dropped by >=10% AND failure rate didn't grow
 *  - worsening if median latency rose by >=10% OR failure rate grew by >=5pp
 *  - stable if neither
 *  - insufficient_data if either window had <5 receipts
 */
function classifyDirection(current: TargetWindow | undefined, previous: TargetWindow | undefined): Direction {
  if (!current || !previous) return 'insufficient_data';
  if (current.receipt_count < 5 || previous.receipt_count < 5) return 'insufficient_data';
  if (current.median_duration_ms == null || previous.median_duration_ms == null) return 'insufficient_data';
  if (previous.median_duration_ms === 0) return 'insufficient_data';

  const latencyChange = (current.median_duration_ms - previous.median_duration_ms) / previous.median_duration_ms;
  const failureChange = current.failure_rate - previous.failure_rate;

  if (latencyChange >= 0.1 || failureChange >= 0.05) return 'worsening';
  if (latencyChange <= -0.1 && failureChange <= 0) return 'improving';
  return 'stable';
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

  // Index previous by target.
  const previousMap = new Map<string, TargetWindow>();
  for (const r of previousRows) previousMap.set(r.target, r);

  // Compute per-target direction. Only include targets present in current.
  const perTarget = currentRows
    .map((cur) => ({
      target: cur.target,
      direction: classifyDirection(cur, previousMap.get(cur.target)),
    }))
    .sort((a, b) => {
      const order: Record<Direction, number> = {
        worsening: 0,
        improving: 1,
        stable: 2,
        insufficient_data: 3,
      };
      return order[a.direction] - order[b.direction];
    });

  // Overall trend — most worrying direction across targets.
  let overallTrend: Direction = 'insufficient_data';
  const counts = { worsening: 0, improving: 0, stable: 0, insufficient_data: 0 };
  for (const t of perTarget) counts[t.direction]++;

  if (perTarget.length === 0) overallTrend = 'insufficient_data';
  else if (counts.worsening > counts.improving) overallTrend = 'worsening';
  else if (counts.improving > counts.worsening) overallTrend = 'improving';
  else if (counts.stable > 0) overallTrend = 'stable';
  else overallTrend = 'insufficient_data';

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    current_period: { start: current.start.toISOString(), end: current.end.toISOString() },
    comparison_period: { start: previous.start.toISOString(), end: previous.end.toISOString() },
    overall_trend: overallTrend,
    per_target: perTarget,
    counts,
    tier: 'free',
    note:
      'Free tier shows directional trends only (improving / worsening / stable). Pro tier adds magnitude (% change), significance, and population overlay (is this happening to other agents calling the same target?).',
  });
});

export { app as trendRoute };
