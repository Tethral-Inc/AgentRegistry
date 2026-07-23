/**
 * Shared aggregation-freshness probe.
 *
 * Both `/health` and `/network/status` need to know "is the aggregation
 * pipeline alive?" — they used to compute it independently with different
 * thresholds, which let the two responses contradict each other.
 *
 * Three INDEPENDENT facts, kept separate on purpose:
 *   * intent   — is this job supposed to be running at all, and how often?
 *     Read from job_schedules (migration 000028). A job with no declared
 *     interval is intentionally suspended, which is not a failure.
 *   * pipeline — did the system-health-aggregate job run recently *relative to
 *     its declared cadence*? Read from job_heartbeats.last_run_at (written by
 *     every cron run, even ones that had nothing new to write).
 *   * activity — when was the last receipt observed? Read from
 *     MAX(last_seen_at) on system_health. A quiet network is not an issue.
 *
 * Before job_heartbeats existed, staleness was inferred from data recency
 * alone, so a successful run over a quiet network reported "aggregation
 * stale" minutes after a green cron run (a false-red). When the heartbeat
 * row is missing (migration not applied / job never ran), we fall back to
 * the old data-recency signal rather than claiming the pipeline is fine.
 *
 * Before job_schedules existed, intent was invisible: thresholds were pinned
 * to a 15-minute cadence, so a deliberately suspended job and a broken one produced
 * identical output ("cron likely stuck"), and any job on a slower cadence was
 * judged as if it were late. Thresholds are now derived from the declared
 * interval; the old constants remain as the no-declaration fallback.
 */
import { query } from '@acr/shared';

/** Fallback: below this lag the pipeline is fresh, when nothing is declared. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Fallback: above this lag the pipeline is presumed stuck, when nothing is declared. */
export const DOWN_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Missed-run tolerance when a cadence IS declared. A job is stale once it has
 * missed two consecutive runs and down once it has missed four — expressed as
 * multiples of its own interval so a daily job isn't judged like a 15-minute
 * one. The grace absorbs scheduler jitter (Vercel and GitHub both fire late).
 */
export const STALE_INTERVALS = 2;
export const DOWN_INTERVALS = 4;
export const SCHEDULER_GRACE_MS = 15 * 60 * 1000;

export interface AggregationFreshness {
  /** ISO timestamp of the last system-health-aggregate run, or null. */
  last_aggregation_at: string | null;
  /** Seconds since that run, or null. */
  freshness_seconds: number | null;
  /** True when the pipeline signal exceeds the stale threshold (or is absent). Always false while paused. */
  stale: boolean;
  /** True when the pipeline signal exceeds the down threshold (or is absent). Always false while paused. */
  down: boolean;
  /** True when the job is declared suspended. Not a failure — the rollups are frozen on purpose. */
  paused: boolean;
  /** Declared cadence in minutes, or null when suspended / undeclared. */
  expected_interval_minutes: number | null;
  /** Operator-written note from job_schedules.reason — why it's suspended, or a cadence note. */
  schedule_reason: string | null;
  /** ISO timestamp of when the job was suspended, or null. */
  suspended_at: string | null;
  /** Result of the last run ('ok', 'error', 'http_500'…), or null. */
  last_run_status: string | null;
  /** ISO timestamp of the most recent receipt observed by aggregation, or null. Neutral activity signal — old data on a healthy pipeline just means a quiet network. */
  last_data_observed_at: string | null;
  /** Which signal produced stale/down: the job heartbeat, or the pre-000025 data-recency fallback. */
  signal: 'job_heartbeat' | 'data_recency_fallback';
}

/** The job whose cadence defines "is the aggregation pipeline alive?". */
const PROBE_JOB = 'system-health-aggregate';

interface ScheduleRow {
  expected_interval_minutes: number | null;
  suspended_at: string | null;
  reason: string | null;
}

export async function probeAggregationFreshness(): Promise<AggregationFreshness> {
  const [heartbeatRows, dataRows, scheduleRows] = await Promise.all([
    query<{ last_run_at: string; last_status: string }>(
      `SELECT last_run_at::text AS "last_run_at", last_status AS "last_status"
       FROM job_heartbeats WHERE job_name = $1`,
      [PROBE_JOB],
    ).catch(() => []),
    query<{ max_last_seen: string | null }>(
      `SELECT MAX(last_seen_at)::text AS "max_last_seen" FROM system_health`,
    ).catch(() => [{ max_last_seen: null }]),
    // Absent table (migration 000028 not applied) => no declared intent =>
    // fall back to the old fixed thresholds. Never let this throw the probe.
    query<ScheduleRow>(
      `SELECT expected_interval_minutes AS "expected_interval_minutes",
              suspended_at::text AS "suspended_at",
              reason AS "reason"
       FROM job_schedules WHERE job_name = $1`,
      [PROBE_JOB],
    ).catch(() => []),
  ]);

  const lastDataAt = dataRows[0]?.max_last_seen ?? null;
  const heartbeat = heartbeatRows[0];
  const schedule = scheduleRows[0];

  // A declared row with no interval means "off on purpose". Report it as its
  // own state: the rollups really are frozen, but nothing is broken, so no
  // reader should escalate. This is the whole point of migration 000028.
  const paused = schedule != null && schedule.expected_interval_minutes == null;
  const intervalMinutes = schedule?.expected_interval_minutes ?? null;

  // Pipeline signal: prefer the heartbeat; fall back to data recency.
  const pipelineAt = heartbeat?.last_run_at ?? lastDataAt;
  const signal: AggregationFreshness['signal'] = heartbeat ? 'job_heartbeat' : 'data_recency_fallback';

  const scheduleFields = {
    paused,
    expected_interval_minutes: intervalMinutes,
    schedule_reason: schedule?.reason ?? null,
    suspended_at: schedule?.suspended_at ?? null,
  };

  if (!pipelineAt) {
    return {
      last_aggregation_at: null,
      freshness_seconds: null,
      // "Never ran" is only an alarm if the job is supposed to run.
      stale: !paused,
      down: !paused,
      ...scheduleFields,
      last_run_status: null,
      last_data_observed_at: lastDataAt,
      signal,
    };
  }

  const lagMs = Date.now() - new Date(pipelineAt).getTime();
  const erroring = heartbeat != null && heartbeat.last_status !== 'ok';

  // Thresholds from the declared cadence when there is one, else the legacy
  // constants (which assume the */15 schedule they were written for).
  const intervalMs = intervalMinutes != null ? intervalMinutes * 60 * 1000 : null;
  const staleAfter = intervalMs != null ? intervalMs * STALE_INTERVALS + SCHEDULER_GRACE_MS : STALE_AFTER_MS;
  const downAfter = intervalMs != null ? intervalMs * DOWN_INTERVALS + SCHEDULER_GRACE_MS : DOWN_AFTER_MS;

  return {
    last_aggregation_at: pipelineAt,
    freshness_seconds: Math.max(0, Math.floor(lagMs / 1000)),
    // A pipeline whose last run errored is stale regardless of recency:
    // it's running, but it isn't producing. A paused job is neither.
    stale: !paused && (lagMs > staleAfter || erroring),
    down: !paused && lagMs > downAfter,
    ...scheduleFields,
    last_run_status: heartbeat?.last_status ?? null,
    last_data_observed_at: lastDataAt,
    signal,
  };
}
