import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@acr/shared';
import app from '../../packages/ingestion-api/src/index.js';

const TEST_AGENT_ID = 'acr_cmptest123';
const TEST_KEY = 'test-api-key';

function stubAuthFor(agentId: string): void {
  const q = vi.mocked(query);
  q.mockImplementationOnce(async () => [
    { operator_id: agentId, tier: 'free', revoked: false } as never,
  ]);
  q.mockImplementationOnce(async () => [
    { agent_id: agentId, name: null } as never,
  ]);
}

// Route order after auth:
//   1. resolveAgentId
//   2. chain_analysis rows
//   3. chain_analysis_fleet rows (skipped if #2 is empty)
function stubRouteQueries(
  agentId: string,
  patterns: Array<{
    pattern_hash: string;
    chain_pattern: string[];
    frequency: number;
    avg_overhead_ms?: number;
    computed_at?: string;
  }>,
  fleet: Array<{ pattern_hash: string; agent_count: number; total_frequency: number }> = [],
): void {
  const q = vi.mocked(query);
  q.mockImplementationOnce(async () => [
    { agent_id: agentId, name: null } as never,
  ]);
  q.mockImplementationOnce(async () => patterns.map((p) => ({
    pattern_hash: p.pattern_hash,
    chain_pattern: p.chain_pattern,
    frequency: p.frequency,
    avg_overhead_ms: p.avg_overhead_ms ?? 0,
    computed_at: p.computed_at ?? '2026-04-19T00:00:00Z',
  })) as never);
  if (patterns.length > 0) {
    q.mockImplementationOnce(async () => fleet as never);
  }
}

const authedHeaders = { Authorization: `Bearer ${TEST_KEY}` };

describe('GET /api/v1/agent/:id/compensation', () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
  });

  it('rejects invalid window parameter', async () => {
    stubAuthFor(TEST_AGENT_ID);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=month`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('accepts day and week windows', async () => {
    for (const w of ['day', 'week']) {
      stubAuthFor(TEST_AGENT_ID);
      stubRouteQueries(TEST_AGENT_ID, []);
      const res = await app.request(
        `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=${w}`,
        { headers: authedHeaders },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.window).toBe(w);
    }
  });

  it('defaults to week when window not specified', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, []);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toBe('week');
  });

  it('empty state: no chains logged → zero totals, empty patterns, null computed_at', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, []);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.total_chains).toBe(0);
    expect(body.summary.distinct_patterns).toBe(0);
    expect(body.summary.agent_stability).toBe(0);
    expect(body.patterns).toEqual([]);
    expect(body.computed_at).toBeNull();
  });

  it('single pattern → stability 1.0 and share 1.0', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, [
      {
        pattern_hash: 'h1',
        chain_pattern: ['mcp:github', 'api:stripe'],
        frequency: 42,
        avg_overhead_ms: 120,
      },
    ]);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.total_chains).toBe(42);
    expect(body.summary.distinct_patterns).toBe(1);
    expect(body.summary.agent_stability).toBe(1);
    expect(body.patterns).toHaveLength(1);
    expect(body.patterns[0].pattern_stability).toBe(1);
    expect(body.patterns[0].share_of_chains).toBe(1);
    expect(body.patterns[0].avg_overhead_ms).toBe(120);
  });

  it('ranks patterns by frequency and computes per-pattern stability', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, [
      { pattern_hash: 'h_big', chain_pattern: ['a', 'b'], frequency: 90, avg_overhead_ms: 10 },
      { pattern_hash: 'h_mid', chain_pattern: ['c', 'd'], frequency: 7, avg_overhead_ms: 80 },
      { pattern_hash: 'h_low', chain_pattern: ['e', 'f'], frequency: 3, avg_overhead_ms: 200 },
    ]);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.total_chains).toBe(100);
    expect(body.summary.distinct_patterns).toBe(3);
    expect(body.patterns[0].pattern_hash).toBe('h_big');
    expect(body.patterns[0].pattern_stability).toBe(0.9);
    expect(body.patterns[1].pattern_hash).toBe('h_mid');
    expect(body.patterns[1].pattern_stability).toBe(0.07);
    expect(body.patterns[2].pattern_hash).toBe('h_low');
    expect(body.patterns[2].pattern_stability).toBe(0.03);
  });

  it('merges fleet data: idiosyncratic patterns get agent_count 1', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(
      TEST_AGENT_ID,
      [
        { pattern_hash: 'h_shared', chain_pattern: ['a'], frequency: 10 },
        { pattern_hash: 'h_unique', chain_pattern: ['b'], frequency: 5 },
      ],
      [
        { pattern_hash: 'h_shared', agent_count: 12, total_frequency: 340 },
        { pattern_hash: 'h_unique', agent_count: 1, total_frequency: 5 },
      ],
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const shared = body.patterns.find((p: { pattern_hash: string }) => p.pattern_hash === 'h_shared');
    const unique = body.patterns.find((p: { pattern_hash: string }) => p.pattern_hash === 'h_unique');
    expect(shared.fleet_agent_count).toBe(12);
    expect(shared.fleet_total_frequency).toBe(340);
    expect(unique.fleet_agent_count).toBe(1);
    expect(unique.fleet_total_frequency).toBe(5);
  });

  it('patterns without fleet coverage get null fleet fields', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(
      TEST_AGENT_ID,
      [{ pattern_hash: 'h_only_here', chain_pattern: ['x'], frequency: 4 }],
      [], // fleet query returns nothing for this hash
    );
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patterns[0].fleet_agent_count).toBeNull();
    expect(body.patterns[0].fleet_total_frequency).toBeNull();
  });

  it('uniform distribution yields agent_stability 0', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, [
      { pattern_hash: 'h1', chain_pattern: ['a'], frequency: 5 },
      { pattern_hash: 'h2', chain_pattern: ['b'], frequency: 5 },
      { pattern_hash: 'h3', chain_pattern: ['c'], frequency: 5 },
      { pattern_hash: 'h4', chain_pattern: ['d'], frequency: 5 },
    ]);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.agent_stability).toBe(0);
  });

  it('returns computed_at from the highest-frequency row', async () => {
    stubAuthFor(TEST_AGENT_ID);
    stubRouteQueries(TEST_AGENT_ID, [
      {
        pattern_hash: 'h1',
        chain_pattern: ['a'],
        frequency: 10,
        computed_at: '2026-04-18T03:00:00Z',
      },
    ]);
    const res = await app.request(
      `/api/v1/agent/${TEST_AGENT_ID}/compensation?window=week`,
      { headers: authedHeaders },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.computed_at).toBe('2026-04-18T03:00:00Z');
  });
});
