import { describe, it, expect } from 'vitest';
import { computeShadowTax, type ShadowTaxInput } from '../../packages/ingestion-api/src/lib/shadow-tax.js';

function row(over: Partial<ShadowTaxInput> = {}): ShadowTaxInput {
  return {
    duration_ms: 100,
    status: 'success',
    retry_count: 0,
    chain_id: null,
    queue_wait_ms: 0,
    ...over,
  };
}

describe('computeShadowTax()', () => {
  it('empty input → all-zero result', () => {
    const r = computeShadowTax([], 0);
    expect(r.total_ms).toBe(0);
    expect(r.failed_call_ms).toBe(0);
    expect(r.retry_ms).toBe(0);
    expect(r.chain_queue_ms).toBe(0);
    expect(r.percentage_of_wait).toBe(0);
  });

  it('only successful calls, no retries, no chains → zero waste', () => {
    const rows = [row({ duration_ms: 50 }), row({ duration_ms: 120 })];
    const r = computeShadowTax(rows, 170);
    expect(r.total_ms).toBe(0);
    expect(r.percentage_of_wait).toBe(0);
  });

  it('failed call → credits duration to failed_call_ms', () => {
    const rows = [row({ duration_ms: 250, status: 'timeout' })];
    const r = computeShadowTax(rows, 250);
    expect(r.failed_call_ms).toBe(250);
    expect(r.retry_ms).toBe(0);
    expect(r.chain_queue_ms).toBe(0);
    expect(r.total_ms).toBe(250);
    expect(r.percentage_of_wait).toBe(1);
  });

  it('successful call with retry_count → credits retry_count × duration to retry_ms', () => {
    const rows = [row({ duration_ms: 100, retry_count: 2, status: 'success' })];
    const r = computeShadowTax(rows, 100);
    expect(r.retry_ms).toBe(200);
    expect(r.failed_call_ms).toBe(0);
    expect(r.total_ms).toBe(200);
  });

  it('failed call with retry_count is NOT double-counted in retry_ms', () => {
    // Credit goes to the most specific bucket — failed_call_ms only.
    const rows = [row({ duration_ms: 100, retry_count: 3, status: 'error' })];
    const r = computeShadowTax(rows, 100);
    expect(r.failed_call_ms).toBe(100);
    expect(r.retry_ms).toBe(0);
    expect(r.total_ms).toBe(100);
  });

  it('chained call → credits queue_wait_ms to chain_queue_ms', () => {
    const rows = [row({ chain_id: 'c1', queue_wait_ms: 80 })];
    const r = computeShadowTax(rows, 100);
    expect(r.chain_queue_ms).toBe(80);
    expect(r.failed_call_ms).toBe(0);
    expect(r.retry_ms).toBe(0);
  });

  it('chain_queue_ms stacks on top of failed_call_ms for a failed chained call', () => {
    // queue_wait_ms is a distinct dimension from duration_ms, so both buckets
    // accumulate independently for a failed chained call.
    const rows = [row({
      duration_ms: 200,
      status: 'timeout',
      chain_id: 'c1',
      queue_wait_ms: 50,
    })];
    const r = computeShadowTax(rows, 200);
    expect(r.failed_call_ms).toBe(200);
    expect(r.chain_queue_ms).toBe(50);
    expect(r.total_ms).toBe(250);
  });

  it('queue_wait_ms on non-chained call is ignored', () => {
    const rows = [row({ chain_id: null, queue_wait_ms: 999 })];
    const r = computeShadowTax(rows, 100);
    expect(r.chain_queue_ms).toBe(0);
  });

  it('mixed workload aggregates across buckets', () => {
    const rows = [
      row({ duration_ms: 100, status: 'success' }),                                      // no waste
      row({ duration_ms: 200, status: 'timeout' }),                                      // +200 failed
      row({ duration_ms: 50, status: 'success', retry_count: 2 }),                       // +100 retry
      row({ duration_ms: 300, status: 'success', chain_id: 'c1', queue_wait_ms: 40 }),   // +40 chain
    ];
    const r = computeShadowTax(rows, 650);
    expect(r.failed_call_ms).toBe(200);
    expect(r.retry_ms).toBe(100);
    expect(r.chain_queue_ms).toBe(40);
    expect(r.total_ms).toBe(340);
    expect(r.percentage_of_wait).toBe(0.523); // 340/650 = 0.5230... → rounded to 3dp
  });

  it('percentage_of_wait is 0 when totalWaitMs is 0', () => {
    const rows = [row({ duration_ms: 0, status: 'timeout', chain_id: 'c1', queue_wait_ms: 10 })];
    const r = computeShadowTax(rows, 0);
    expect(r.chain_queue_ms).toBe(10);
    expect(r.total_ms).toBe(10);
    expect(r.percentage_of_wait).toBe(0);
  });

  it('handles null duration_ms gracefully', () => {
    const rows = [row({ duration_ms: null, status: 'timeout' })];
    const r = computeShadowTax(rows, 0);
    expect(r.failed_call_ms).toBe(0);
    expect(r.total_ms).toBe(0);
  });
});
