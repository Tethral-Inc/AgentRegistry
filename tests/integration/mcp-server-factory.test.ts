/**
 * Integration tests for the MCP server factory.
 *
 * Scope:
 *  - Stdio happy path: createAcrServer() returns a usable McpServer and
 *    binds the supplied SessionState to it, with background probes
 *    disabled via env vars so the test does not touch the network.
 *  - HTTP session isolation (SKIPPED until Phase 1): a placeholder
 *    scaffold that documents the invariant the `getSession` factory
 *    split must preserve — two concurrent HTTP sessions must never read
 *    or write each other's state. The current tools read from
 *    `defaultSession` at module load, so this test would fail today.
 *    Phase 1 removes the module-level read and enables this block.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Neutralize all background fetches before importing the server factory.
// These env vars gate the fetch observer, environmental probe, and version
// check. We set them synchronously before the server module is loaded so
// the module-level behavior is deterministic.
process.env.ACR_DISABLE_FETCH_OBSERVE = '1';
process.env.ACR_DISABLE_ENV_PROBE = '1';
process.env.ACR_DISABLE_VERSION_CHECK = '1';
// Point at an unreachable URL so any residual fetch (e.g. the background
// ensureRegistered fire-and-forget) fails fast without hitting prod.
process.env.ACR_API_URL = 'http://127.0.0.1:1';
// Don't persist a fake agent id to the real home-dir state file.
process.env.ACR_STATE_FILE = '/tmp/acr-state-test.json';

const { createAcrServer } = await import(
  '../../packages/mcp-server/src/server.js'
);
const { SessionState } = await import(
  '../../packages/mcp-server/src/session-state.js'
);

describe('createAcrServer — stdio happy path', () => {
  beforeAll(() => {
    // Silence the background registration attempt that fires from
    // createAcrServer's IIFE. It would otherwise reject loudly at 127.0.0.1:1.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns an McpServer instance', () => {
    const session = new SessionState('stdio');
    const server = createAcrServer({ session });
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
    expect(typeof server.close).toBe('function');
  });

  it('binds the supplied session to the server for provider_class inference', () => {
    const session = new SessionState('stdio');
    const setMcpServerSpy = vi.spyOn(session, 'setMcpServer');
    const server = createAcrServer({ session });
    expect(setMcpServerSpy).toHaveBeenCalledWith(server);
    expect(setMcpServerSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the caller-supplied session rather than defaultSession when one is passed', () => {
    const custom = new SessionState('stdio');
    custom.setAgentId('agt_test_custom');
    const server = createAcrServer({ session: custom });
    // The server factory must not mutate the caller's session's identity.
    expect(custom.agentId).toBe('agt_test_custom');
    expect(server).toBeDefined();
  });

  it('each createAcrServer call produces a distinct server instance', () => {
    const sessionA = new SessionState('stdio');
    const sessionB = new SessionState('stdio');
    const serverA = createAcrServer({ session: sessionA });
    const serverB = createAcrServer({ session: sessionB });
    expect(serverA).not.toBe(serverB);
  });
});

describe('createAcrServer — concurrent session construction', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('two sessions keep their agent identity independent after their servers are built', () => {
    const a = new SessionState('streamable-http');
    const b = new SessionState('streamable-http');
    createAcrServer({ session: a });
    createAcrServer({ session: b });
    a.setAgentId('agt_alpha');
    b.setAgentId('agt_beta');
    expect(a.agentId).toBe('agt_alpha');
    expect(b.agentId).toBe('agt_beta');
  });

  it('two sessions keep their chain state independent after their servers are built', () => {
    const a = new SessionState('streamable-http');
    const b = new SessionState('streamable-http');
    createAcrServer({ session: a });
    createAcrServer({ session: b });
    const aCtx = a.nextChainContext(1_000);
    const bCtx = b.nextChainContext(1_000);
    expect(aCtx.chain_id).not.toBe(bCtx.chain_id);
  });
});

// ----------------------------------------------------------------------------
// Phase 1 TDD anchor
// ----------------------------------------------------------------------------
// Once the getSession factory split is done (Phase 1), drop `.skip` and
// promote this to a regression guard. Today it would fail because most
// tools import `defaultSession` directly — so invoking a tool on server B
// reads server A's session when both run in the same process.
// ----------------------------------------------------------------------------
describe.skip('createAcrServer — HTTP session isolation (Phase 1)', () => {
  it('two concurrent HTTP sessions do not share agent identity through tool calls', () => {
    // Scaffold:
    //   const a = new SessionState('streamable-http');
    //   const b = new SessionState('streamable-http');
    //   a.setAgentId('agt_alpha');
    //   b.setAgentId('agt_beta');
    //   const serverA = createAcrServer({ session: a });
    //   const serverB = createAcrServer({ session: b });
    //   const [transportA, clientA] = inMemoryPair();
    //   const [transportB, clientB] = inMemoryPair();
    //   await serverA.connect(transportA);
    //   await serverB.connect(transportB);
    //   const resA = await clientA.callTool({ name: 'get_my_agent', arguments: {} });
    //   const resB = await clientB.callTool({ name: 'get_my_agent', arguments: {} });
    //   expect(text(resA)).toContain('agt_alpha');
    //   expect(text(resB)).toContain('agt_beta');
    expect(true).toBe(true);
  });

  it('deep-composition preference is per-session, not process-global', () => {
    // Same shape: turn off deep composition on session A, confirm B is
    // unaffected when configure_deep_composition is called on A's server.
    expect(true).toBe(true);
  });
});
