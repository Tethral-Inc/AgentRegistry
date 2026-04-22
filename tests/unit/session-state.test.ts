/**
 * Unit tests for SessionState — the per-session container the MCP relies on
 * to keep concurrent HTTP sessions from clobbering each other's agent id,
 * API key, chain state, and deep-composition preference.
 *
 * These tests pin the behaviors that the Phase 1 getSession split is about
 * to lean on more heavily. If any of them start failing during the split,
 * the factory pattern has introduced a regression.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionState } from '../../packages/mcp-server/src/session-state.js';

describe('SessionState', () => {
  describe('construction + defaults', () => {
    it('defaults to stdio transport', () => {
      const s = new SessionState();
      expect(s.transportType).toBe('stdio');
    });

    it('carries the declared transport type through', () => {
      expect(new SessionState('stdio').transportType).toBe('stdio');
      expect(new SessionState('streamable-http').transportType).toBe('streamable-http');
    });

    it('starts with no agent identity', () => {
      const s = new SessionState();
      expect(s.agentId).toBeNull();
      expect(s.agentName).toBeNull();
      expect(s.apiKey).toBeNull();
      expect(s.clientType).toBeNull();
      expect(s.versionCheck).toBeNull();
    });

    it('deep composition defaults to enabled', () => {
      // Module import captured ACR_DEEP_COMPOSITION at load — default is 'true'.
      const s = new SessionState();
      expect(s.deepComposition).toBe(true);
    });
  });

  describe('setters', () => {
    it('agent identity round-trips', () => {
      const s = new SessionState();
      s.setAgentId('agt_abc');
      s.setAgentName('Test Agent');
      s.setApiKey('sk_live_xyz');
      s.setClientType('claude-code');
      expect(s.agentId).toBe('agt_abc');
      expect(s.agentName).toBe('Test Agent');
      expect(s.apiKey).toBe('sk_live_xyz');
      expect(s.clientType).toBe('claude-code');
    });

    it('deep composition toggle flips both ways', () => {
      const s = new SessionState();
      s.setDeepComposition(false);
      expect(s.deepComposition).toBe(false);
      s.setDeepComposition(true);
      expect(s.deepComposition).toBe(true);
    });

    it('version check round-trips', () => {
      const s = new SessionState();
      s.setVersionCheck({ current: '2.4.1', latest: '2.5.0', hasUpdate: true });
      expect(s.versionCheck).toEqual({ current: '2.4.1', latest: '2.5.0', hasUpdate: true });
    });
  });

  describe('providerClass inference', () => {
    it('returns unknown when no MCP server is attached', () => {
      const s = new SessionState();
      expect(s.providerClass).toBe('unknown');
    });

    it('maps known MCP client names to canonical providers', () => {
      const cases: Array<[string, string]> = [
        ['claude-code', 'anthropic'],
        ['claude-desktop', 'anthropic'],
        ['claude', 'anthropic'],
        ['copilot', 'openai'],
        ['cursor', 'custom'],
        ['continue', 'custom'],
        ['zed', 'custom'],
        ['windsurf', 'custom'],
        ['cline', 'custom'],
      ];
      for (const [clientName, expected] of cases) {
        const s = new SessionState();
        // Stub just enough of the McpServer surface for inferProviderClass.
        s.setMcpServer({
          server: { getClientVersion: () => ({ name: clientName, version: '1.0.0' }) },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        expect(s.providerClass, `clientName=${clientName}`).toBe(expected);
      }
    });

    it('maps case-insensitively', () => {
      const s = new SessionState();
      s.setMcpServer({
        server: { getClientVersion: () => ({ name: 'Claude-Code', version: '1.0.0' }) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(s.providerClass).toBe('anthropic');
    });

    it('falls back to custom for unknown client names', () => {
      const s = new SessionState();
      s.setMcpServer({
        server: { getClientVersion: () => ({ name: 'some-novel-host', version: '1.0.0' }) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(s.providerClass).toBe('custom');
    });

    it('returns unknown when the MCP server exposes no client name', () => {
      const s = new SessionState();
      s.setMcpServer({
        server: { getClientVersion: () => undefined },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(s.providerClass).toBe('unknown');
    });
  });

  describe('nextChainContext — session-inferred chains', () => {
    // Note: the implementation uses `_lastCallMs === 0` as an internal
    // "no prior call" sentinel. Tests use timestamps ≥ 1 so we don't trip
    // it on our second call and masquerade a real-clock call as "first".
    // (Real Date.now() values are always well above 0, so this is only a
    // test-time concern — but flagging it: the sentinel should be `null`,
    // not `0`, to be clock-agnostic. Tracked for Phase 1/2 cleanup.)
    const T0 = 1_000;

    it('mints a new s-prefixed chain on the first call', () => {
      const s = new SessionState();
      const { chain_id, chain_position } = s.nextChainContext(T0);
      expect(chain_id).toMatch(/^s-[0-9a-f]{16}$/);
      expect(chain_position).toBe(0);
    });

    it('extends the same chain on successive calls within the idle window', () => {
      const s = new SessionState();
      const a = s.nextChainContext(T0);
      const b = s.nextChainContext(T0 + 60_000); // 1 minute later — well inside 5-minute idle
      const c = s.nextChainContext(T0 + 120_000);
      expect(b.chain_id).toBe(a.chain_id);
      expect(c.chain_id).toBe(a.chain_id);
      expect([a.chain_position, b.chain_position, c.chain_position]).toEqual([0, 1, 2]);
    });

    it('rotates the chain when idle exceeds 5 minutes', () => {
      const s = new SessionState();
      const first = s.nextChainContext(T0);
      // 5 minutes + 1ms — the boundary is strict "greater than" per code.
      const second = s.nextChainContext(T0 + 5 * 60 * 1000 + 1);
      expect(second.chain_id).not.toBe(first.chain_id);
      // Position resets on rotation.
      expect(second.chain_position).toBe(0);
    });

    it('does not rotate exactly at the 5-minute mark', () => {
      const s = new SessionState();
      const first = s.nextChainContext(T0);
      const second = s.nextChainContext(T0 + 5 * 60 * 1000); // exactly idle timeout
      expect(second.chain_id).toBe(first.chain_id);
      expect(second.chain_position).toBe(1);
    });

    it('resetChain forces a fresh chain on the next call', () => {
      const s = new SessionState();
      const first = s.nextChainContext(T0);
      s.resetChain();
      const second = s.nextChainContext(T0 + 1_000);
      expect(second.chain_id).not.toBe(first.chain_id);
      expect(second.chain_position).toBe(0);
    });
  });

  describe('multi-instance isolation', () => {
    // This is the invariant Phase 1's getSession factory split exists to
    // defend. Two concurrent HTTP sessions must not read or write each
    // other's state. If any of these start failing, the split has a leak.
    it('two instances keep their agent identity independent', () => {
      const a = new SessionState('streamable-http');
      const b = new SessionState('streamable-http');
      a.setAgentId('agt_alpha');
      b.setAgentId('agt_beta');
      expect(a.agentId).toBe('agt_alpha');
      expect(b.agentId).toBe('agt_beta');
    });

    it('two instances keep their chain state independent', () => {
      const a = new SessionState('streamable-http');
      const b = new SessionState('streamable-http');
      const aCtx = a.nextChainContext(1_000);
      const bCtx = b.nextChainContext(1_000);
      expect(aCtx.chain_id).not.toBe(bCtx.chain_id);
      // A's counter moving doesn't drag B's along.
      a.nextChainContext(2_000);
      a.nextChainContext(3_000);
      const bSecond = b.nextChainContext(2_000);
      expect(bSecond.chain_position).toBe(1);
    });

    it('two instances keep their deep-composition preference independent', () => {
      const a = new SessionState();
      const b = new SessionState();
      a.setDeepComposition(false);
      expect(a.deepComposition).toBe(false);
      expect(b.deepComposition).toBe(true);
    });

    it('two instances keep their API keys independent', () => {
      const a = new SessionState();
      const b = new SessionState();
      a.setApiKey('sk_alpha');
      b.setApiKey('sk_beta');
      expect(a.apiKey).toBe('sk_alpha');
      expect(b.apiKey).toBe('sk_beta');
    });
  });
});
