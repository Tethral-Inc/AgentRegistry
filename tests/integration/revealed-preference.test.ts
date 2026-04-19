import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@acr/shared';
import app from '../../packages/ingestion-api/src/index.js';

const TEST_AGENT_ID = 'acr_rptest123';
const TEST_KEY = 'test-api-key';

// agentAuth middleware makes two query() calls: api_keys lookup, then
// resolveAgentId → agents lookup. Stub both so auth succeeds and the route
// handler can run.
function stubAuthFor(agentId: string): void {
  const q = vi.mocked(query);
  q.mockImplementationOnce(async () => [
    { operator_id: agentId, tier: 'free', revoked: false } as never,
  ]);
  q.mockImplementationOnce(async () => [
    { agent_id: agentId, name: null } as never,
  ]);
}

// The route calls resolveAgentId -> one query, then runs two parallel queries
// (composition sources + receipts). Stub the agent resolve and both data queries.
function stubAgentResolveAndDataFor(
  agentId: string,
  bindings: Array<{ source: 'mcp_observed' | 'agent_reported'; composition: unknown }>,
  calls: Array<{ target_system_id: string; call_count: number; last_called: string }>,
): void {
  const q = vi.mocked(query);
  // resolveAgentId
  q.mockImplementationOnce(async () => [
    { agent_id: agentId, name: null } as never,
  ]);
  // composition sources
  q.mockImplementationOnce(async () => bindings as never);
  // receipts group-by-target
  q.mockImplementationOnce(async () => calls as never);
}

const authedHeaders = { Authorization: `Bearer ${TEST_KEY}` };

describe('GET /api/v1/agent/:id/revealed-preference', () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
  });

  it('rejects invalid scope parameter', async () => {
    stubAuthFor(TEST_AGENT_ID);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=century`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('accepts yesterday, day, week, month scopes', async () => {
    for (const scope of ['yesterday', 'day', 'week', 'month']) {
      stubAuthFor(TEST_AGENT_ID);
      stubAgentResolveAndDataFor(TEST_AGENT_ID, [], []);
      const res = await app.request(
        `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=${scope}`,
        { headers: authedHeaders },
      );
      expect(res.status).not.toBe(400);
    }
  });

  it('defaults to yesterday when scope not specified', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(TEST_AGENT_ID, [], []);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('yesterday');
  });

  it('classifies a bound-but-uncalled target', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(
      TEST_AGENT_ID,
      [{ source: 'agent_reported', composition: { mcps: ['github'] } }],
      [], // no calls
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=yesterday`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.bound_uncalled).toBe(1);
    expect(body.summary.bound_targets).toBe(1);
    expect(body.summary.called_targets).toBe(0);
    const target = body.targets.find((t: { target_system_id: string }) => t.target_system_id === 'mcp:github');
    expect(target).toBeDefined();
    expect(target.classification).toBe('bound_uncalled');
    expect(target.call_count).toBe(0);
    expect(target.binding_sources).toEqual(['agent_reported']);
  });

  it('classifies a called-but-unbound target (composition drift)', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(
      TEST_AGENT_ID,
      [], // no composition recorded
      [{ target_system_id: 'api:stripe.com', call_count: 5, last_called: '2026-04-17T10:00:00Z' }],
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=yesterday`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.called_unbound).toBe(1);
    const target = body.targets[0];
    expect(target.classification).toBe('called_unbound');
    expect(target.binding_sources).toEqual([]);
  });

  it('classifies bound_underused (1-2 calls) vs bound_active (>=3 calls)', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(
      TEST_AGENT_ID,
      [{ source: 'agent_reported', composition: { mcps: ['github', 'filesystem'] } }],
      [
        { target_system_id: 'mcp:github', call_count: 1, last_called: '2026-04-17T10:00:00Z' },
        { target_system_id: 'mcp:filesystem', call_count: 10, last_called: '2026-04-17T11:00:00Z' },
      ],
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=yesterday`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.bound_underused).toBe(1);
    expect(body.summary.bound_active).toBe(1);
    const github = body.targets.find((t: { target_system_id: string }) => t.target_system_id === 'mcp:github');
    const filesystem = body.targets.find((t: { target_system_id: string }) => t.target_system_id === 'mcp:filesystem');
    expect(github.classification).toBe('bound_underused');
    expect(filesystem.classification).toBe('bound_active');
  });

  it('flags binding_source_disagreements when two sources disagree', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(
      TEST_AGENT_ID,
      [
        { source: 'mcp_observed', composition: { mcps: ['github'] } },
        { source: 'agent_reported', composition: { mcps: ['filesystem'] } },
      ],
      [],
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=yesterday`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Two targets, each declared by only one source → 2 disagreements
    expect(body.summary.binding_source_disagreements).toBe(2);
  });

  it('empty state: no bindings and no calls → empty result', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubAgentResolveAndDataFor(TEST_AGENT_ID, [], []);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/revealed-preference?scope=yesterday`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.bound_targets).toBe(0);
    expect(body.summary.called_targets).toBe(0);
    expect(body.targets).toEqual([]);
  });
});
