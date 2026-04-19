/**
 * Shadow tax: the slice of total wait time that produced no forward progress.
 *
 * Three disjoint buckets, credited to the most specific one:
 *   - failed_call_ms  — duration of calls that ended in non-success status
 *   - retry_ms        — retry_count × duration for calls that succeeded (failed
 *                       calls' duration is already in failed_call_ms)
 *   - chain_queue_ms  — queue_wait_ms for calls that were part of a chain
 *
 * Buckets are disjoint by construction so operators can re-aggregate without
 * double-counting a single receipt's waste.
 */

export interface ShadowTaxInput {
  duration_ms: number | null;
  status: string;
  retry_count: number;
  chain_id: string | null;
  queue_wait_ms: number;
}

export interface ShadowTaxResult {
  total_ms: number;
  failed_call_ms: number;
  retry_ms: number;
  chain_queue_ms: number;
  percentage_of_wait: number;
}

export function computeShadowTax(
  rows: readonly ShadowTaxInput[],
  totalWaitMs: number,
): ShadowTaxResult {
  let failedCallMs = 0;
  let retryMs = 0;
  let chainQueueMs = 0;

  for (const row of rows) {
    const dur = row.duration_ms ?? 0;
    const isFailed = row.status !== 'success';

    if (isFailed) {
      failedCallMs += dur;
    } else if (row.retry_count > 0) {
      retryMs += row.retry_count * dur;
    }
    if (row.chain_id && row.queue_wait_ms > 0) {
      chainQueueMs += row.queue_wait_ms;
    }
  }

  const total = failedCallMs + retryMs + chainQueueMs;
  return {
    total_ms: total,
    failed_call_ms: failedCallMs,
    retry_ms: retryMs,
    chain_queue_ms: chainQueueMs,
    percentage_of_wait: totalWaitMs > 0 ? Math.round((total / totalWaitMs) * 1000) / 1000 : 0,
  };
}
