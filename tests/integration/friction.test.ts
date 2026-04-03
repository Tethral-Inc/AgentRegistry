import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('GET /api/v1/agent/:id/friction', () => {
  it('rejects invalid scope parameter', async () => {
    const res = await app.request('/api/v1/agent/acr_test123/friction?scope=invalid');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('accepts valid scope parameters', async () => {
    // These will fail at the DB level since we have no database connected,
    // but they should pass validation. In a real integration test with DB,
    // these would return 200.
    for (const scope of ['session', 'day', 'week']) {
      const res = await app.request(`/api/v1/agent/acr_test123/friction?scope=${scope}`);
      // Will be 500 (no DB) but not 400 (validation passed)
      expect(res.status).not.toBe(400);
    }
  });

  it('defaults to day scope when not specified', async () => {
    const res = await app.request('/api/v1/agent/acr_test123/friction');
    // Will be 500 (no DB) but not 400 (default scope accepted)
    expect(res.status).not.toBe(400);
  });
});
