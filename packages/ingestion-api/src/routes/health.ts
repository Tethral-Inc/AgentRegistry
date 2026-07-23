import { Hono } from 'hono';
import { query } from '@acr/shared';
import { probeAggregationFreshness } from '../helpers/aggregation-freshness.js';

const app = new Hono();

type HealthStatus = 'ok' | 'degraded' | 'paused' | 'stale' | 'down';

interface KnownIssue {
  component: string;
  message: string;
}

interface HealthResponse {
  status: HealthStatus;
  database: 'connected' | 'unreachable';
  last_aggregation_at: string | null;
  freshness_seconds: number | null;
  /** Neutral activity signal: when aggregation last saw a receipt. Old data
   *  on a healthy pipeline means a quiet network, not a broken one. */
  last_data_observed_at?: string | null;
  /** Declared intent from job_schedules — what the pipeline is SUPPOSED to do.
   *  Lets a reader tell "off on purpose" from "broken" without guessing. */
  schedule?: {
    expected_interval_minutes: number | null;
    suspended_at: string | null;
    reason: string | null;
  };
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
 *   - ok       — DB reachable, aggregation ran within its declared cadence
 *   - degraded — DB reachable, recent aggregation, other issues
 *   - paused   — aggregation is declared suspended in job_schedules. NOT an
 *                incident: the rollups are frozen on purpose and the reason is
 *                in `schedule.reason`. Returns 200; nothing should escalate.
 *   - stale    — aggregation missed ~2 expected runs (cron lagging)
 *   - down     — DB unreachable OR aggregation missed ~4 expected runs
 *
 * Thresholds come from job_schedules.expected_interval_minutes, not from a
 * fixed 30 min / 2 h assumption — see helpers/aggregation-freshness.ts.
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
  // Intent first: a suspended job is not late, it is off. Checking this before
  // the lag branches is what stops a deliberate pause from being reported as
  // "cron likely stuck" (which is exactly what happened 2026-07-12 → 07-22).
  if (freshness.paused) {
    status = 'paused';
    issues.push({
      component: 'aggregation',
      message:
        `aggregation intentionally suspended` +
        (freshness.suspended_at ? ` on ${freshness.suspended_at.slice(0, 10)}` : '') +
        (freshness.schedule_reason ? `: ${freshness.schedule_reason}` : '') +
        ' — lens rollups are frozen by design, not broken',
    });
  } else if (freshness.last_aggregation_at === null) {
    status = 'down';
    issues.push({
      component: 'aggregation',
      message: 'aggregation has never run',
    });
  } else if (freshness.down) {
    status = 'down';
    const minutes = Math.floor((freshness.freshness_seconds ?? 0) / 60);
    const expected = freshness.expected_interval_minutes;
    issues.push({
      component: 'aggregation',
      // Now that suspension has its own status, "stuck" is a claim this branch
      // has earned: the job is declared active and still isn't running.
      message:
        `aggregation job last ran ${minutes} min ago` +
        (expected != null ? ` (expected every ${expected} min)` : '') +
        ' — cron likely stuck',
    });
  } else if (freshness.stale) {
    status = 'stale';
    const minutes = Math.floor((freshness.freshness_seconds ?? 0) / 60);
    issues.push({
      component: 'aggregation',
      message:
        freshness.last_run_status && freshness.last_run_status !== 'ok'
          ? `aggregation job is running but failing (last run: ${freshness.last_run_status})`
          : `aggregation job last ran ${minutes} min ago`,
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
    last_data_observed_at: freshness.last_data_observed_at,
    schedule: {
      expected_interval_minutes: freshness.expected_interval_minutes,
      suspended_at: freshness.suspended_at,
      reason: freshness.schedule_reason,
    },
    known_issues: issues,
    timestamp: new Date().toISOString(),
  });
});

export { app as healthRoute };
