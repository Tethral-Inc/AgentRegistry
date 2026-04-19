import { describe, it, expect } from 'vitest';
import { confidence, PRE_SIGNAL_MAX, DIRECTIONAL_MAX } from '../../packages/mcp-server/src/utils/confidence.js';

describe('confidence()', () => {
  it('labels n=0 as pre-signal', () => {
    expect(confidence(0)).toBe('(pre-signal — 0 samples)');
  });

  it('labels n=9 (PRE_SIGNAL_MAX) as pre-signal', () => {
    expect(confidence(PRE_SIGNAL_MAX)).toBe('(pre-signal — 9 samples)');
  });

  it('labels n=10 as directional (boundary flip)', () => {
    expect(confidence(10)).toBe('(directional — 10 samples)');
  });

  it('labels n=29 (DIRECTIONAL_MAX) as directional', () => {
    expect(confidence(DIRECTIONAL_MAX)).toBe('(directional — 29 samples)');
  });

  it('labels n=30 as significant (boundary flip)', () => {
    expect(confidence(30)).toBe('(significant — 30 samples)');
  });

  it('labels large n as significant', () => {
    expect(confidence(10000)).toBe('(significant — 10000 samples)');
  });

  it('preserves the raw number in the tag', () => {
    for (const n of [0, 1, 5, 17, 42, 999]) {
      expect(confidence(n)).toContain(`${n} samples`);
    }
  });
});
