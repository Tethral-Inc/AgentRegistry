/**
 * Cohort baseline prepend — thin-sample detection + rendering contract.
 *
 * The header renderer is `fetch`-dependent, so tests patch global
 * `fetch` to return a canned cohort response. The function must never
 * throw (a failed baseline can't break a lens) and must return '' when
 * the cohort is too small or absent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isThinSample,
  renderCohortBaselineHeader,
  THIN_SAMPLE_THRESHOLD,
} from '../../packages/mcp-server/src/utils/cohort-baseline.js';

const API = 'https://acr.example.com';

// Active-session shim: the real session module reads a module-level
// global. For the header renderer we just need `providerClass`, so we
// replace the import target with a minimal stand-in.
vi.mock('../../packages/mcp-server/src/session-state.js', () => ({
  getActiveSession: () => ({ providerClass: 'anthropic' }),
}));

describe('isThinSample', () => {
  it('treats null/undefined as thin', () => {
    expect(isThinSample(null)).toBe(true);
    expect(isThinSample(undefined)).toBe(true);
  });

  it('true when below threshold', () => {
    expect(isThinSample(0)).toBe(true);
    expect(isThinSample(THIN_SAMPLE_THRESHOLD - 1)).toBe(true);
  });

  it('false when at or above threshold', () => {
    expect(isThinSample(THIN_SAMPLE_THRESHOLD)).toBe(false);
    expect(isThinSample(THIN_SAMPLE_THRESHOLD + 100)).toBe(false);
  });
});

describe('renderCohortBaselineHeader', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns non-empty rendering when cohort has targets', async () => {
    beforeEach;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        provider_class: 'anthropic',
        window_days: 7,
        cohort_size: 12,
        total_interactions: 4500,
        targets: [
          {
            target_system_id: 'api:openai.com',
            target_system_type: 'api',
            cohort_size: 8,
            total_interactions: 900,
            median_duration_ms: 240,
            p95_duration_ms: 1800,
            failure_rate: 0.04,
            anomaly_rate: 0.01,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const out = await renderCohortBaselineHeader(API);
    expect(out).toContain("Your cohort's typical performance");
    expect(out).toContain('api:openai.com');
    expect(out).toContain('240ms median');
    expect(out).toContain('1800ms p95');
    expect(out).toContain('4.0% failure');
  });

  it('returns empty string when cohort_size < 3', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        provider_class: 'anthropic',
        window_days: 7,
        cohort_size: 1,
        total_interactions: 10,
        targets: [],
        reason: 'cohort too small',
      }),
    })) as unknown as typeof fetch;

    const out = await renderCohortBaselineHeader(API);
    expect(out).toBe('');
  });

  it('returns empty string on fetch failure (never throws)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    // Must not throw — a broken baseline can't break a lens.
    const out = await renderCohortBaselineHeader(API);
    expect(out).toBe('');
  });

  it('returns empty string on non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server down' }),
    })) as unknown as typeof fetch;

    const out = await renderCohortBaselineHeader(API);
    expect(out).toBe('');
  });
});
