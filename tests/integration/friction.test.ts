import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@acr/shared';
import app from '../../packages/ingestion-api/src/index.js';

const TEST_AGENT_ID = 'acr_test123';
const TEST_KEY = 'test-api-key';

// agentAuth middleware makes two query() calls: api_keys lookup, then
// resolveAgentId → agents lookup. Stub both so auth succeeds and the route
// handler's scope validator can run.
function stubAuthFor(agentId: string): void {
  const q = vi.mocked(query);
  q.mockImplementationOnce(async () => [
    { operator_id: agentId, tier: 'free', revoked: false } as never,
  ]);
  q.mockImplementationOnce(async () => [
    { agent_id: agentId, name: null } as never,
  ]);
}

const authedHeaders = { Authorization: `Bearer ${TEST_KEY}` };

describe('GET /api/v1/agent/:id/friction', () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
  });

  it('rejects invalid scope parameter', async () => {
    stubAuthFor(TEST_AGENT_ID);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/friction?scope=invalid`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('accepts valid scope parameters', async () => {
    // These will fail at the DB level since we have no database connected,
    // but they should pass validation. In a real integration test with DB,
    // these would return 200.
    for (const scope of ['session', 'day', 'week']) {
      stubAuthFor(TEST_AGENT_ID);
      const res = await app.request(
        `/api/v1/agent/${TEST_AGENT_ID}/friction?scope=${scope}`,
        { headers: authedHeaders },
      );
      // Will be 500 (no DB) but not 400 (validation passed)
      expect(res.status).not.toBe(400);
    }
  });

  it('defaults to day scope when not specified', async () => {
    stubAuthFor(TEST_AGENT_ID);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/friction`,
      { headers: authedHeaders },
    );
    // Will be 500 (no DB) but not 400 (default scope accepted)
    expect(res.status).not.toBe(400);
  });
});
