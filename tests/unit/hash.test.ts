import { describe, it, expect } from 'vitest';
import {
  sha256,
  hashSkillFile,
  computeCompositionHash,
  generateAgentId,
  generateReceiptId,
} from '@acr/shared';

describe('sha256', () => {
  it('produces deterministic hex output', () => {
    const a = sha256('hello');
    const b = sha256('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});

describe('hashSkillFile', () => {
  it('normalizes CRLF to LF', () => {
    const withCRLF = 'line1\r\nline2\r\n';
    const withLF = 'line1\nline2';
    expect(hashSkillFile(withCRLF)).toBe(hashSkillFile(withLF));
  });

  it('trims whitespace', () => {
    expect(hashSkillFile('  content  ')).toBe(hashSkillFile('content'));
  });
});

describe('computeCompositionHash', () => {
  it('is deterministic regardless of input order', () => {
    const a = computeCompositionHash(['hash1', 'hash2', 'hash3']);
    const b = computeCompositionHash(['hash3', 'hash1', 'hash2']);
    expect(a).toBe(b);
  });

  it('produces different hashes for different compositions', () => {
    const a = computeCompositionHash(['hash1', 'hash2']);
    const b = computeCompositionHash(['hash1', 'hash3']);
    expect(a).not.toBe(b);
  });
});

describe('generateAgentId', () => {
  it('produces acr_ prefixed IDs', () => {
    const id = generateAgentId('pubkey123', Date.now());
    expect(id).toMatch(/^acr_[a-f0-9]{12}$/);
  });

  it('is deterministic for same inputs', () => {
    const ts = 1711978987442;
    const a = generateAgentId('key', ts);
    const b = generateAgentId('key', ts);
    expect(a).toBe(b);
  });
});

describe('generateReceiptId', () => {
  it('produces rcpt_ prefixed IDs', () => {
    const id = generateReceiptId('acr_abc123def456', 'mcp:github', Date.now());
    expect(id).toMatch(/^rcpt_[a-f0-9]{12}$/);
  });

  it('is deterministic for same inputs', () => {
    const ts = 1711978987442;
    const a = generateReceiptId('agent1', 'target1', ts);
    const b = generateReceiptId('agent1', 'target1', ts);
    expect(a).toBe(b);
  });
});
