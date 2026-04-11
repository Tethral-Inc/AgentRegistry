import { describe, it, expect } from 'vitest';
import { CorrelationWindow } from '../../packages/mcp-server/src/middleware/correlation-window.js';

describe('CorrelationWindow', () => {
  describe('record + findPrecededBy', () => {
    it('returns null when window is empty', () => {
      const window = new CorrelationWindow();
      const result = window.findPrecededBy('chain_1', Date.now());
      expect(result).toBeNull();
    });

    it('returns null when currentChainId is null', () => {
      const window = new CorrelationWindow();
      const now = Date.now();
      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now,
      });

      const result = window.findPrecededBy(null, now);
      expect(result).toBeNull();
    });

    it('returns null when no entry matches the chain_id', () => {
      const window = new CorrelationWindow();
      const now = Date.now();
      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now,
      });

      const result = window.findPrecededBy('chain_2', now);
      expect(result).toBeNull();
    });

    it('returns the target of a matching recent entry', () => {
      const window = new CorrelationWindow();
      const now = Date.now();
      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now - 1_000,
      });

      const result = window.findPrecededBy('chain_1', now);
      expect(result).toBe('mcp:github');
    });

    it('returns the most recent matching entry when multiple exist for the same chain', () => {
      const window = new CorrelationWindow();
      const now = Date.now();
      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now - 30_000,
      });
      window.record({
        receipt_id: 'rcpt_b',
        chain_id: 'chain_1',
        target_system_id: 'api:stripe.com',
        created_at_ms: now - 5_000,
      });

      const result = window.findPrecededBy('chain_1', now);
      expect(result).toBe('api:stripe.com');
    });
  });

  describe('eviction', () => {
    it('evicts entries older than the window on insert', () => {
      const window = new CorrelationWindow(60_000);
      const now = Date.now();

      // Old entry, should be evicted
      window.record({
        receipt_id: 'rcpt_old',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now - 120_000,
      });

      // New entry triggers eviction of the old one
      window.record({
        receipt_id: 'rcpt_new',
        chain_id: 'chain_2',
        target_system_id: 'api:stripe.com',
        created_at_ms: now,
      });

      expect(window.size()).toBe(1);
    });

    it('evicts entries older than the window on lookup', () => {
      const window = new CorrelationWindow(60_000);
      const now = Date.now();

      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now - 120_000, // 2 minutes ago
      });

      // Lookup at current time should trigger eviction and find nothing
      const result = window.findPrecededBy('chain_1', now);
      expect(result).toBeNull();
      expect(window.size()).toBe(0);
    });

    it('keeps entries younger than the window', () => {
      const window = new CorrelationWindow(60_000);
      const now = Date.now();

      window.record({
        receipt_id: 'rcpt_recent',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now - 30_000, // 30 seconds ago
      });

      expect(window.size()).toBe(1);

      const result = window.findPrecededBy('chain_1', now);
      expect(result).toBe('mcp:github');
    });
  });

  describe('hard cap safety net', () => {
    it('drops oldest entries when over the max entries limit', () => {
      const window = new CorrelationWindow(60_000, 3);
      const now = Date.now();

      window.record({ receipt_id: 'rcpt_1', chain_id: 'chain_1', target_system_id: 'target_1', created_at_ms: now - 5_000 });
      window.record({ receipt_id: 'rcpt_2', chain_id: 'chain_2', target_system_id: 'target_2', created_at_ms: now - 4_000 });
      window.record({ receipt_id: 'rcpt_3', chain_id: 'chain_3', target_system_id: 'target_3', created_at_ms: now - 3_000 });
      window.record({ receipt_id: 'rcpt_4', chain_id: 'chain_4', target_system_id: 'target_4', created_at_ms: now - 2_000 });

      expect(window.size()).toBe(3);

      // Newest should still be findable
      expect(window.findPrecededBy('chain_4', now)).toBe('target_4');
      // Oldest was dropped
      expect(window.findPrecededBy('chain_1', now)).toBeNull();
    });
  });

  describe('clear', () => {
    it('empties the window', () => {
      const window = new CorrelationWindow();
      const now = Date.now();

      window.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now,
      });

      expect(window.size()).toBe(1);

      window.clear();
      expect(window.size()).toBe(0);
      expect(window.findPrecededBy('chain_1', now)).toBeNull();
    });
  });

  describe('multi-session isolation', () => {
    it('windows are independent instances, not shared state', () => {
      const windowA = new CorrelationWindow();
      const windowB = new CorrelationWindow();
      const now = Date.now();

      windowA.record({
        receipt_id: 'rcpt_a',
        chain_id: 'chain_1',
        target_system_id: 'mcp:github',
        created_at_ms: now,
      });

      expect(windowA.size()).toBe(1);
      expect(windowB.size()).toBe(0);
      expect(windowB.findPrecededBy('chain_1', now)).toBeNull();
    });
  });
});
