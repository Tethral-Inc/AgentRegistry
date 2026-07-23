/**
 * probeAggregationFreshness — declared intent vs. observed lag.
 *
 * The regression these lock down: between 2026-07-12 and 2026-07-22 the
 * aggregation cron was suspended deliberately, and /health reported
 * `status: down` with "cron likely stuck" the whole time because nothing
 * recorded that the pause was intentional. A suspended job must never read as
 * broken, and a job on a slow cadence must not be judged by 15-minute
 * thresholds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();

vi.mock('@acr/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@acr/shared')>();
  return { ...original, query };
});

const { probeAggregationFreshness, STALE_INTERVALS, DOWN_INTERVALS, SCHEDULER_GRACE_MS } = await import(
  '../../packages/ingestion-api/src/helpers/aggregation-freshness.js'
);

const MINUTE = 60 * 1000;

interface Fixture {
  /** Minutes since the last heartbeat, or null for "no heartbeat row". */
  heartbeatAgoMin: number | null;
  heartbeatStatus?: string;
  /** Declared cadence, null = suspended, undefined = no job_schedules row. */
  intervalMinutes?: number | null;
  suspendedAt?: string | null;
  reason?: string | null;
}

/**
 * Route each of the probe's three queries by the table it reads.
 * Teardown invokes the mocked query with no arguments, so tolerate a
 * non-string first arg rather than throwing out of the implementation.
 */
function stubDb(f: Fixture): void {
  query.mockImplementation(async (sql?: string) => {
    if (typeof sql !== 'string') return [];
    if (sql.includes('job_heartbeats')) {
      if (f.heartbeatAgoMin === null) return [];
      return [{
        last_run_at: new Date(Date.now() - f.heartbeatAgoMin * MINUTE).toISOString(),
        last_status: f.heartbeatStatus ?? 'ok',
      }];
    }
    if (sql.includes('system_health')) return [{ max_last_seen: null }];
    if (sql.includes('job_schedules')) {
      if (f.intervalMinutes === undefined) return [];
      return [{
        expected_interval_minutes: f.intervalMinutes,
        suspended_at: f.suspendedAt ?? (f.intervalMinutes === null ? '2026-07-12T18:41:35Z' : null),
        reason: f.reason ?? null,
      }];
    }
    return [];
  });
}

beforeEach(() => query.mockReset());

describe('probeAggregationFreshness — suspended jobs', () => {
  it('reports paused, not down, for a job suspended 10 days ago', async () => {
    stubDb({ heartbeatAgoMin: 10 * 24 * 60, intervalMinutes: null, reason: 'no external users' });
    const f = await probeAggregationFreshness();

    expect(f.paused).toBe(true);
    // The whole point: 10 days of lag on a suspended job is not an incident.
    expect(f.down).toBe(false);
    expect(f.stale).toBe(false);
    expect(f.schedule_reason).toBe('no external users');
    // Still reports the real lag — paused hides the alarm, not the reading.
    expect(f.freshness_seconds).toBeGreaterThan(9 * 24 * 3600);
  });

  it('stays paused when the job never ran at all', async () => {
    stubDb({ heartbeatAgoMin: null, intervalMinutes: null });
    const f = await probeAggregationFreshness();

    expect(f.paused).toBe(true);
    expect(f.down).toBe(false);
    expect(f.stale).toBe(false);
  });

  it('reports down when the job never ran and IS expected to run', async () => {
    stubDb({ heartbeatAgoMin: null, intervalMinutes: 1440 });
    const f = await probeAggregationFreshness();

    expect(f.paused).toBe(false);
    expect(f.down).toBe(true);
    expect(f.last_aggregation_at).toBeNull();
  });
});

describe('probeAggregationFreshness — thresholds follow the declared cadence', () => {
  const daily = 1440;

  it('is fresh a few hours after a daily run', async () => {
    stubDb({ heartbeatAgoMin: 3 * 60, intervalMinutes: daily });
    const f = await probeAggregationFreshness();

    // Under the old fixed 2h rule this exact case reported `down`.
    expect(f.stale).toBe(false);
    expect(f.down).toBe(false);
    expect(f.expected_interval_minutes).toBe(daily);
  });

  it('goes stale once a daily job misses its stale-interval budget', async () => {
    const past = daily * STALE_INTERVALS + SCHEDULER_GRACE_MS / MINUTE + 10;
    stubDb({ heartbeatAgoMin: past, intervalMinutes: daily });
    const f = await probeAggregationFreshness();

    expect(f.stale).toBe(true);
    expect(f.down).toBe(false);
  });

  it('goes down once a daily job misses its down-interval budget', async () => {
    const past = daily * DOWN_INTERVALS + SCHEDULER_GRACE_MS / MINUTE + 10;
    stubDb({ heartbeatAgoMin: past, intervalMinutes: daily });
    const f = await probeAggregationFreshness();

    expect(f.down).toBe(true);
  });

  it('treats an erroring run as stale even when it just ran', async () => {
    stubDb({ heartbeatAgoMin: 1, heartbeatStatus: 'error', intervalMinutes: daily });
    const f = await probeAggregationFreshness();

    // Running but not producing is still not healthy.
    expect(f.stale).toBe(true);
    expect(f.last_run_status).toBe('error');
  });
});

describe('probeAggregationFreshness — no declaration (pre-000028 fallback)', () => {
  it('keeps the legacy 30 min / 2 h thresholds when job_schedules has no row', async () => {
    stubDb({ heartbeatAgoMin: 45 }); // intervalMinutes undefined => no row
    const f = await probeAggregationFreshness();

    expect(f.paused).toBe(false);
    expect(f.expected_interval_minutes).toBeNull();
    expect(f.stale).toBe(true);   // > 30 min
    expect(f.down).toBe(false);   // < 2 h
  });

  it('reports down past 2 h with no declaration', async () => {
    stubDb({ heartbeatAgoMin: 3 * 60 });
    const f = await probeAggregationFreshness();

    expect(f.down).toBe(true);
  });

  it('survives job_schedules not existing yet (migration not applied)', async () => {
    query.mockImplementation(async (sql?: string) => {
      if (typeof sql !== 'string') return [];
      if (sql.includes('job_schedules')) throw new Error('relation "job_schedules" does not exist');
      if (sql.includes('job_heartbeats')) {
        return [{ last_run_at: new Date(Date.now() - 5 * MINUTE).toISOString(), last_status: 'ok' }];
      }
      return [{ max_last_seen: null }];
    });

    const f = await probeAggregationFreshness();
    expect(f.paused).toBe(false);
    expect(f.stale).toBe(false);
  });
});
