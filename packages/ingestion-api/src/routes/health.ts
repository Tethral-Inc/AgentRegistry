import { Hono } from 'hono';
import { query } from '@acr/shared';
import { probeAggregationFreshness } from '../helpers/aggregation-freshness.js';

const app = new Hono();

type HealthStatus = 'ok' | 'degraded' | 'stale' | 'down';

interface KnownIssue {
  component: string;
  message: string;
}

interface HealthResponse {
  status: HealthStatus;
  database: 'connected' | 'unreachable';
  last_aggregation_at: string | null;
  freshness_seconds: number | null;
  known_issues: KnownIssue[];
  timestamp: string;
}

/**
 * GET /health — unified health response consumed by both
 * `check_environment` and `get_network_status` so they can never
 * disagree about system state. Backwards-compatible with the old
 * `{ status, database, timestamp }` shape; adds
 * `last_aggregation_at`, `freshness_seconds`, and `known_issues`
 * so tools can surface a reason instead of a binary "ok".
 *
 * `status` semantics, ordered most-permissive first:
 *   - ok       — DB reachable, aggregation ran in the last 30 min
 *   - degraded — DB reachable, recent aggregation, other issues
 *   - stale    — aggregation lag > 30 min (cron lagging)
 *   - down     — DB unreachable OR aggregation lag > 2 h
 */
app.get('/health', async (c) => {
  const issues: KnownIssue[] = [];

  try {
    await query('SELECT 1');
  } catch {
    return c.json<HealthResponse>({
      status: 'down',
      database: 'unreachable',
      last_aggregation_at: null,
      freshness_seconds: null,
      known_issues: [{ component: 'database', message: 'Database connection failed' }],
      timestamp: new Date().toISOString(),
    }, 503);
  }

  const freshness = await probeAggregationFreshness();

  let status: HealthStatus;
  if (freshness.last_aggregation_at === null) {
    status = 'down';
    issues.push({
      component: 'aggregation',
      message: 'system_health is empty — aggregation has never run',
    });
  } else if (freshness.down) {
    status = 'down';
    const minutes = Math.floor((freshness.freshness_seconds ?? 0) / 60);
    issues.push({
      component: 'aggregation',
      message: `system_health is ${minutes} min stale (cron likely stuck)`,
    });
  } else if (freshness.stale) {
    status = 'stale';
    const minutes = Math.floor((freshness.freshness_seconds ?? 0) / 60);
    issues.push({
      component: 'aggregation',
      message: `system_health is ${minutes} min stale`,
    });
  } else if (issues.length > 0) {
    status = 'degraded';
  } else {
    status = 'ok';
  }

  return c.json<HealthResponse>({
    status,
    database: 'connected',
    last_aggregation_at: freshness.last_aggregation_at,
    freshness_seconds: freshness.freshness_seconds,
    known_issues: issues,
    timestamp: new Date().toISOString(),
  });
});

export { app as healthRoute };
