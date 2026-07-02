/**
 * Shared aggregation-freshness probe.
 *
 * Both `/health` and `/network/status` need to know "is the aggregation
 * pipeline alive?" — they used to compute it independently with different
 * thresholds, which let the two responses contradict each other.
 *
 * Pipeline health and network activity are two INDEPENDENT facts:
 *   * pipeline — did the system-health-aggregate job run recently? Read from
 *     job_heartbeats.last_run_at (written by every cron run, even ones that
 *     had nothing new to write).
 *   * activity — when was the last receipt observed? Read from
 *     MAX(last_seen_at) on system_health. A quiet network is not an issue.
 *
 * Before job_heartbeats existed, staleness was inferred from data recency
 * alone, so a successful run over a quiet network reported "aggregation
 * stale" minutes after a green cron run (a false-red). When the heartbeat
 * row is missing (migration not applied / job never ran), we fall back to
 * the old data-recency signal rather than claiming the pipeline is fine.
 */
import { query } from '@acr/shared';

/** Below this lag, the pipeline is fresh. Aggregation runs every 15 min. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Above this lag, the pipeline is presumed stuck. */
export const DOWN_AFTER_MS = 2 * 60 * 60 * 1000;

export interface AggregationFreshness {
  /** ISO timestamp of the last system-health-aggregate run, or null. */
  last_aggregation_at: string | null;
  /** Seconds since that run, or null. */
  freshness_seconds: number | null;
  /** True when the pipeline signal exceeds STALE_AFTER_MS (or is absent). */
  stale: boolean;
  /** True when the pipeline signal exceeds DOWN_AFTER_MS (or is absent). */
  down: boolean;
  /** Result of the last run ('ok', 'error', 'http_500'…), or null. */
  last_run_status: string | null;
  /** ISO timestamp of the most recent receipt observed by aggregation, or null. Neutral activity signal — old data on a healthy pipeline just means a quiet network. */
  last_data_observed_at: string | null;
  /** Which signal produced stale/down: the job heartbeat, or the pre-000025 data-recency fallback. */
  signal: 'job_heartbeat' | 'data_recency_fallback';
}

export async function probeAggregationFreshness(): Promise<AggregationFreshness> {
  const [heartbeatRows, dataRows] = await Promise.all([
    query<{ last_run_at: string; last_status: string }>(
      `SELECT last_run_at::text AS "last_run_at", last_status AS "last_status"
       FROM job_heartbeats WHERE job_name = 'system-health-aggregate'`,
    ).catch(() => []),
    query<{ max_last_seen: string | null }>(
      `SELECT MAX(last_seen_at)::text AS "max_last_seen" FROM system_health`,
    ).catch(() => [{ max_last_seen: null }]),
  ]);

  const lastDataAt = dataRows[0]?.max_last_seen ?? null;
  const heartbeat = heartbeatRows[0];

  // Pipeline signal: prefer the heartbeat; fall back to data recency.
  const pipelineAt = heartbeat?.last_run_at ?? lastDataAt;
  const signal: AggregationFreshness['signal'] = heartbeat ? 'job_heartbeat' : 'data_recency_fallback';

  if (!pipelineAt) {
    return {
      last_aggregation_at: null,
      freshness_seconds: null,
      stale: true,
      down: true,
      last_run_status: null,
      last_data_observed_at: lastDataAt,
      signal,
    };
  }

  const lagMs = Date.now() - new Date(pipelineAt).getTime();
  const erroring = heartbeat != null && heartbeat.last_status !== 'ok';
  return {
    last_aggregation_at: pipelineAt,
    freshness_seconds: Math.max(0, Math.floor(lagMs / 1000)),
    // A pipeline whose last run errored is stale regardless of recency:
    // it's running, but it isn't producing.
    stale: lagMs > STALE_AFTER_MS || erroring,
    down: lagMs > DOWN_AFTER_MS,
    last_run_status: heartbeat?.last_status ?? null,
    last_data_observed_at: lastDataAt,
    signal,
  };
}
