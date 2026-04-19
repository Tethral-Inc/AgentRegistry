import { describe, it, expect } from 'vitest';
import { scorePatterns } from '../../packages/ingestion-api/src/lib/stability-score.js';

describe('scorePatterns()', () => {
  it('empty input → zero totals and empty result', () => {
    const r = scorePatterns([]);
    expect(r.total_chains).toBe(0);
    expect(r.scored).toEqual([]);
    expect(r.agent_stability).toBe(0);
  });

  it('single pattern → agent_stability = 1 (maximally routine)', () => {
    const r = scorePatterns([
      { pattern_hash: 'a', chain_pattern: ['x', 'y'], frequency: 10 },
    ]);
    expect(r.total_chains).toBe(10);
    expect(r.agent_stability).toBe(1);
    expect(r.scored[0]!.pattern_stability).toBe(1);
    expect(r.scored[0]!.share_of_chains).toBe(1);
  });

  it('two equal patterns → agent_stability near 0 (maximal entropy for n=2)', () => {
    const r = scorePatterns([
      { pattern_hash: 'a', chain_pattern: ['x'], frequency: 50 },
      { pattern_hash: 'b', chain_pattern: ['y'], frequency: 50 },
    ]);
    expect(r.total_chains).toBe(100);
    expect(r.agent_stability).toBe(0);
    expect(r.scored[0]!.pattern_stability).toBe(0.5);
    expect(r.scored[1]!.pattern_stability).toBe(0.5);
  });

  it('dominant pattern with satellites → high stability', () => {
    const r = scorePatterns([
      { pattern_hash: 'a', chain_pattern: ['x'], frequency: 90 },
      { pattern_hash: 'b', chain_pattern: ['y'], frequency: 5 },
      { pattern_hash: 'c', chain_pattern: ['z'], frequency: 5 },
    ]);
    expect(r.total_chains).toBe(100);
    // Dominant pattern → entropy is low → 1 - H/Hmax is high
    expect(r.agent_stability).toBeGreaterThan(0.6);
    expect(r.scored[0]!.pattern_stability).toBe(0.9);
    expect(r.scored[1]!.pattern_stability).toBe(0.05);
  });

  it('many equal patterns → agent_stability near 0', () => {
    const patterns = Array.from({ length: 10 }, (_, i) => ({
      pattern_hash: `p${i}`,
      chain_pattern: [`t${i}`],
      frequency: 1,
    }));
    const r = scorePatterns(patterns);
    expect(r.total_chains).toBe(10);
    expect(r.agent_stability).toBe(0);
  });

  it('agent_stability is in [0, 1]', () => {
    const cases = [
      [{ pattern_hash: 'a', chain_pattern: ['x'], frequency: 1 }],
      [
        { pattern_hash: 'a', chain_pattern: ['x'], frequency: 7 },
        { pattern_hash: 'b', chain_pattern: ['y'], frequency: 3 },
      ],
      [
        { pattern_hash: 'a', chain_pattern: ['x'], frequency: 100 },
        { pattern_hash: 'b', chain_pattern: ['y'], frequency: 1 },
        { pattern_hash: 'c', chain_pattern: ['z'], frequency: 1 },
      ],
    ];
    for (const input of cases) {
      const r = scorePatterns(input);
      expect(r.agent_stability).toBeGreaterThanOrEqual(0);
      expect(r.agent_stability).toBeLessThanOrEqual(1);
    }
  });

  it('pattern_stability always equals frequency / total_chains', () => {
    const r = scorePatterns([
      { pattern_hash: 'a', chain_pattern: ['x'], frequency: 3 },
      { pattern_hash: 'b', chain_pattern: ['y'], frequency: 7 },
    ]);
    expect(r.total_chains).toBe(10);
    expect(r.scored[0]!.pattern_stability).toBe(0.3);
    expect(r.scored[1]!.pattern_stability).toBe(0.7);
  });

  it('score fields are rounded to 3 decimal places', () => {
    const r = scorePatterns([
      { pattern_hash: 'a', chain_pattern: ['x'], frequency: 1 },
      { pattern_hash: 'b', chain_pattern: ['y'], frequency: 2 },
      { pattern_hash: 'c', chain_pattern: ['z'], frequency: 4 },
    ]);
    // total = 7. 1/7 = 0.142857... → 0.143
    expect(r.scored[0]!.pattern_stability).toBe(0.143);
  });
});
