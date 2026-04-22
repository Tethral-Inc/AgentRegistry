/**
 * /api/v1/baselines/cohort — public cohort baseline endpoint.
 *
 * Why these specific shapes matter:
 *   • 400 on missing provider_class — new-agent-on-first-call code paths
 *     in the MCP should fail loudly if they forget to pass it.
 *   • Empty cohort response is NOT 404 — the endpoint is defined, there
 *     just aren't ≥3 agents in the class yet. The MCP renderer treats
 *     that as "skip the header" rather than "blow up."
 *   • No auth required — this is the thin-sample prepend's entry point,
 *     and a brand-new agent may not even be registered yet.
 */

import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('GET /api/v1/baselines/cohort', () => {
  it('rejects missing provider_class', async () => {
    const res = await app.request('/api/v1/baselines/cohort');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_PARAM');
  });

  it('returns empty cohort shape (not 404) when no agents exist', async () => {
    // With the DB stub returning [], cohort_size is 0 and the handler
    // returns a 200 with reason text. The MCP renderer reads `targets`
    // and `cohort_size` off this shape to decide whether to skip the
    // prepend — which it must be able to do gracefully.
    const res = await app.request('/api/v1/baselines/cohort?provider_class=anthropic');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider_class).toBe('anthropic');
    expect(body.cohort_size).toBe(0);
    expect(body.targets).toEqual([]);
    expect(body.reason).toMatch(/no agents|cohort too small/i);
  });

  it('clamps window_days to [1, 30]', async () => {
    // 999 days should not leak to SQL — the handler must clamp. A 200
    // response with window_days in the output proves the clamp ran.
    const res = await app.request('/api/v1/baselines/cohort?provider_class=openai&window_days=999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window_days).toBeLessThanOrEqual(30);
    expect(body.window_days).toBeGreaterThanOrEqual(1);
  });

  it('defaults window_days to 7 when absent', async () => {
    const res = await app.request('/api/v1/baselines/cohort?provider_class=openai');
    const body = await res.json();
    expect(body.window_days).toBe(7);
  });
});
