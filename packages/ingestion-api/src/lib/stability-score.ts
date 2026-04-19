/**
 * Stability scoring for compensation-signature analysis.
 *
 * The goal: express how *stereotyped* an agent's chain-shape behavior
 * is, on a continuum. Not a binary "compensation detected" verdict —
 * a score in [0, 1] that the operator interprets alongside the raw
 * pattern list.
 *
 * Two scores:
 *
 * 1) Per-pattern stability: what share of this agent's chains follow
 *    this exact target sequence? A pattern that accounts for 80% of
 *    chains in the window is highly stable; one that appears twice
 *    out of 100 chains is not.
 *
 *      pattern_stability = frequency / total_chains
 *
 * 2) Agent-level stability: how concentrated is the agent's
 *    distribution across patterns? One pattern doing all the work →
 *    score near 1. Fifty equally-weighted patterns → score near 0.
 *    Computed as 1 minus normalized Shannon entropy.
 *
 *      H = -Σ (p_i * log2(p_i))
 *      H_max = log2(n_patterns)      // entropy of a uniform distribution
 *      agent_stability = 1 - H / H_max   // or 1 if only one pattern
 *
 * Rationale for 1 - normalized entropy (not, e.g., Herfindahl): it
 * scales to 0..1 regardless of pattern count, so agents with very
 * different catalog sizes can be compared. Operator still sees the
 * raw frequencies — the score is a lens, not a verdict.
 *
 * Interpretation cues (not thresholds — just reading aids):
 *   1.0        : one pattern does everything (maximally routine)
 *   0.7..0.9   : a dominant pattern with a few satellites
 *   0.4..0.6   : diverse chain shapes, flexible workflow
 *   0.0..0.3   : highly exploratory / chain-shape still forming
 *
 * Compensation reading: a persistent *low* agent_stability with a
 * long tail of rare patterns is one reading of ongoing compensation.
 * A suddenly *growing* rare pattern that displaces a previously
 * dominant one is another. Both are continuum signals, not alarms.
 */

export interface PatternInput {
  pattern_hash: string;
  chain_pattern: string[];
  frequency: number;
}

export interface ScoredPattern extends PatternInput {
  pattern_stability: number;   // frequency / total_chains, in [0, 1]
  share_of_chains: number;     // alias; kept separately for readability
}

export function scorePatterns(patterns: PatternInput[]): {
  scored: ScoredPattern[];
  total_chains: number;
  agent_stability: number;
} {
  const total = patterns.reduce((sum, p) => sum + p.frequency, 0);
  if (total === 0) {
    return { scored: [], total_chains: 0, agent_stability: 0 };
  }

  const scored: ScoredPattern[] = patterns.map((p) => {
    const share = p.frequency / total;
    return {
      ...p,
      pattern_stability: round3(share),
      share_of_chains: round3(share),
    };
  });

  // Agent-level stability from entropy. Single-pattern agent → 1 by
  // convention (entropy 0, H_max also 0 so we short-circuit).
  let agent_stability: number;
  if (scored.length <= 1) {
    agent_stability = 1;
  } else {
    let H = 0;
    for (const p of scored) {
      const share = p.share_of_chains;
      if (share > 0) H += -share * Math.log2(share);
    }
    const H_max = Math.log2(scored.length);
    agent_stability = H_max > 0 ? round3(1 - H / H_max) : 1;
  }

  return { scored, total_chains: total, agent_stability };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
