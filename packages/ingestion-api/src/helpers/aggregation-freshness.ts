/**
 * Shared aggregation-freshness probe.
 *
 * Both `/health` and `/network/status` need to know "when did the
 * system_health aggregator last refresh?" — they used to compute it
 * independently with different thresholds, which let the two
 * responses contradict each other ("stale" on one, "ok" on the
 * other). Centralizing here means a single source of truth for the
 * freshness signal and the thresholds that interpret it.
 */
import { query } from '@acr/shared';

/** Below this lag, the pipeline is fresh. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Above this lag, the pipeline is presumed stuck. */
export const DOWN_AFTER_MS = 2 * 60 * 60 * 1000;

export interface AggregationFreshness {
  /** ISO timestamp of the most recent system_health row, or null if empty. */
  last_aggregation_at: string | null;
  /** Seconds since the most recent aggregation, or null if empty. */
  freshness_seconds: number | null;
  /** True when freshness exceeds STALE_AFTER_MS, OR when the table is empty. */
  stale: boolean;
  /** True when freshness exceeds DOWN_AFTER_MS, OR when the table is empty. */
  down: boolean;
}

/**
 * Probe the aggregation pipeline. Catches DB errors and returns a
 * "down" verdict so callers don't have to wrap. The query is cheap
 * (uses idx_system_health_last_seen added in migration 000023).
 */
export async function probeAggregationFreshness(): Promise<AggregationFreshness> {
  const rows = await query<{ max_last_seen: string | null }>(
    `SELECT MAX(last_seen_at)::text AS "max_last_seen" FROM system_health`,
  ).catch(() => [{ max_last_seen: null }]);

  const lastAggregationAt = rows[0]?.max_last_seen ?? null;
  if (!lastAggregationAt) {
    return {
      last_aggregation_at: null,
      freshness_seconds: null,
      stale: true,
      down: true,
    };
  }

  const lagMs = Date.now() - new Date(lastAggregationAt).getTime();
  return {
    last_aggregation_at: lastAggregationAt,
    freshness_seconds: Math.max(0, Math.floor(lagMs / 1000)),
    stale: lagMs > STALE_AFTER_MS,
    down: lagMs > DOWN_AFTER_MS,
  };
}
