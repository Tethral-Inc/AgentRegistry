import { Hono } from 'hono';
import { query, createLogger, FrictionScope, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'failure-registry' });
const app = new Hono();

/**
 * GET /agent/{id}/failure-registry — Grouped failures with error codes.
 *
 * Free tier. Returns failures grouped by target with error code breakdown
 * and category context. Actionable: an operator can see "mcp:github failed
 * 14 times today, 8 with 429 and 6 with 504" and act on it.
 *
 * Pro tier could later add population context: "12 other agents saw the
 * same 429 spike on this target."
 */

interface FailureRow {
  target_system_id: string;
  target_system_type: string;
  status: string;
  error_code: string | null;
  category: string;
  count: number;
  median_duration_ms: number | null;
  total_duration_ms: number;
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

app.get('/agent/:agent_id/failure-registry', async (c) => {
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

  // Pull all failure rows grouped by (target, status, error_code, category).
  const rows = await query<FailureRow>(
    `SELECT
       target_system_id AS "target_system_id",
       target_system_type AS "target_system_type",
       status AS "status",
       COALESCE(error_code, '') AS "error_code",
       interaction_category AS "category",
       COUNT(*)::int AS "count",
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS "median_duration_ms",
       COALESCE(SUM(duration_ms), 0)::int AS "total_duration_ms"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3
       AND status IN ('failure', 'timeout')
     GROUP BY target_system_id, target_system_type, status, error_code, interaction_category
     ORDER BY COUNT(*) DESC
     LIMIT 200`,
    [agentId, start.toISOString(), end.toISOString()],
  ).catch((err) => { log.warn({ err, agentId }, 'Failure-registry rows query failed'); return []; });

  // Group by target.
  type TargetGroup = {
    target: string;
    target_type: string;
    total_count: number;
    statuses: Record<string, number>;
    error_codes: Record<string, number>;
    categories: Record<string, number>;
    median_duration_when_failed_ms: number | null;
    total_duration_on_failures_ms: number;
  };

  const grouped = new Map<string, TargetGroup>();

  for (const r of rows) {
    const key = r.target_system_id;
    let g = grouped.get(key);
    if (!g) {
      g = {
        target: r.target_system_id,
        target_type: r.target_system_type,
        total_count: 0,
        statuses: {},
        error_codes: {},
        categories: {},
        median_duration_when_failed_ms: r.median_duration_ms,
        total_duration_on_failures_ms: 0,
      };
      grouped.set(key, g);
    }
    g.total_count += r.count;
    g.statuses[r.status] = (g.statuses[r.status] ?? 0) + r.count;
    if (r.error_code) {
      g.error_codes[r.error_code] = (g.error_codes[r.error_code] ?? 0) + r.count;
    }
    g.categories[r.category] = (g.categories[r.category] ?? 0) + r.count;
    g.total_duration_on_failures_ms += r.total_duration_ms;
  }

  // Sort by count desc.
  const failures = Array.from(grouped.values()).sort((a, b) => b.total_count - a.total_count);

  // Total failure rate over the period.
  const totalRows = await query<{ total: number; failures: number }>(
    `SELECT
       COUNT(*)::int AS "total",
       COUNT(*) FILTER (WHERE status IN ('failure', 'timeout'))::int AS "failures"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
    [agentId, start.toISOString(), end.toISOString()],
  ).catch((err) => { log.warn({ err, agentId }, 'Failure-registry totals query failed'); return []; });

  const total = totalRows[0]?.total ?? 0;
  const totalFailures = totalRows[0]?.failures ?? 0;
  const failureRate = total > 0 ? totalFailures / total : 0;

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    total_interactions: total,
    total_failures: totalFailures,
    failure_rate: Math.round(failureRate * 1000) / 1000,
    distinct_failing_targets: failures.length,
    failures,
    tier: 'free',
  });
});

export { app as failureRegistryRoute };
