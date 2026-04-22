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
const { SessionState, sessionContext, getActiveSession } = await import(
  '../../packages/mcp-server/src/session-state.js'
);
const stateModule = await import('../../packages/mcp-server/src/state.js');

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
// HTTP session isolation — the invariant Phase 1 is about.
// ----------------------------------------------------------------------------
// The real HTTP transport wraps each incoming request in
// `sessionContext.run(session, …)` so tools + middleware + the fetch
// observer resolve the right SessionState via getActiveSession() without
// the tool factories having to thread it through. These tests exercise
// that contract directly by entering the context ourselves — which is
// exactly what http.ts does on every request.
// ----------------------------------------------------------------------------
describe('createAcrServer — HTTP session isolation', () => {
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('state.ts getters read the per-request session, not a process singleton', () => {
    const a = new SessionState('streamable-http');
    const b = new SessionState('streamable-http');
    a.setAgentId('agt_alpha');
    a.setApiKey('sk_alpha');
    b.setAgentId('agt_beta');
    b.setApiKey('sk_beta');

    // Outside any context → falls back to defaultSession (stdio semantics).
    // We don't assert its value — stdio's defaultSession may carry whatever
    // an earlier test left on it. The isolation guarantee is what we test.

    // Inside A's context → getters see A's data.
    sessionContext.run(a, () => {
      expect(stateModule.getAgentId()).toBe('agt_alpha');
      expect(stateModule.getApiKey()).toBe('sk_alpha');
      expect(stateModule.getAuthHeaders()).toEqual({ Authorization: 'Bearer sk_alpha' });
      expect(getActiveSession()).toBe(a);
    });

    // Inside B's context → getters see B's data. A's mutations did not leak.
    sessionContext.run(b, () => {
      expect(stateModule.getAgentId()).toBe('agt_beta');
      expect(stateModule.getApiKey()).toBe('sk_beta');
      expect(stateModule.getAuthHeaders()).toEqual({ Authorization: 'Bearer sk_beta' });
      expect(getActiveSession()).toBe(b);
    });
  });

  it('writes through setAgentId land on the per-request session, not defaultSession', () => {
    const a = new SessionState('streamable-http');
    sessionContext.run(a, () => {
      stateModule.setAgentId('agt_written_in_context');
    });
    // The write landed on A, not on whatever session defaultSession is.
    expect(a.agentId).toBe('agt_written_in_context');
  });

  it('nested contexts resolve to the innermost session', () => {
    const outer = new SessionState('streamable-http');
    const inner = new SessionState('streamable-http');
    outer.setAgentId('agt_outer');
    inner.setAgentId('agt_inner');

    sessionContext.run(outer, () => {
      expect(getActiveSession()).toBe(outer);
      sessionContext.run(inner, () => {
        expect(getActiveSession()).toBe(inner);
        expect(stateModule.getAgentId()).toBe('agt_inner');
      });
      // Back to outer once we leave the inner run.
      expect(getActiveSession()).toBe(outer);
      expect(stateModule.getAgentId()).toBe('agt_outer');
    });
  });

  it('two sessions retain independent deep-composition preferences under their own contexts', () => {
    const a = new SessionState('streamable-http');
    const b = new SessionState('streamable-http');
    sessionContext.run(a, () => a.setDeepComposition(false));
    sessionContext.run(b, () => {
      expect(b.deepComposition).toBe(true);
      expect(getActiveSession().deepComposition).toBe(true);
    });
    sessionContext.run(a, () => {
      expect(getActiveSession().deepComposition).toBe(false);
    });
  });

  it('async tool work inside a session context propagates across awaits', async () => {
    const a = new SessionState('streamable-http');
    a.setAgentId('agt_async');
    await sessionContext.run(a, async () => {
      // Simulate a tool handler that awaits something — als context must
      // ride the Promise chain, otherwise HTTP isolation breaks the moment
      // any tool uses await (which is every tool).
      await new Promise((r) => setTimeout(r, 1));
      expect(stateModule.getAgentId()).toBe('agt_async');
      await new Promise((r) => setImmediate(r));
      expect(getActiveSession()).toBe(a);
    });
  });
});
