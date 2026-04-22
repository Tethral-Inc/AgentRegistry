/**
 * lens_call_spike
 *
 * Fires when the operator is calling lens tools (get_friction_report,
 * get_trend, get_failure_registry, etc.) substantially more this week
 * than they did the week before. That pattern usually means "something
 * changed and I'm investigating" — the MCP can volunteer what else
 * changed in the same window to shortcut the investigation.
 *
 * We want to avoid false positives from:
 *   - New agents (no prior-week baseline): require prior_period ≥ 3.
 *   - Small absolute numbers (going from 1 call to 3 is not a spike):
 *     require this_period ≥ 5.
 *
 * Confidence scales with the spike multiplier:
 *   - 2×–3× prior period → 0.65
 *   - 3×–5× prior period → 0.80
 *   - 5×+ prior period   → 0.90
 *
 * Metadata carries the raw counts so the render can be specific
 * ("lens calls 3× last week — what changed?").
 */

import type { DetectionInput, PatternDetection } from './types.js';

const MIN_PRIOR = 3;
const MIN_CURRENT = 5;

export function detectLensCallSpike(
  input: DetectionInput,
): PatternDetection | null {
  const { this_period, prior_period } = input.lens_calls;
  if (this_period < MIN_CURRENT) return null;
  if (prior_period < MIN_PRIOR) return null;

  const ratio = this_period / prior_period;
  if (ratio < 2) return null;

  let confidence: number;
  if (ratio >= 5) confidence = 0.90;
  else if (ratio >= 3) confidence = 0.80;
  else confidence = 0.65;

  const roundedRatio = ratio >= 10 ? Math.round(ratio) : Number(ratio.toFixed(1));
  return {
    pattern_type: 'lens_call_spike',
    confidence,
    title: `Lens calls up ${roundedRatio}× this week (${prior_period} → ${this_period})`,
    message: `That usually means you're investigating something. get_trend shows what changed in failure rate and latency; get_failure_registry shows what's breaking by error code.`,
    metadata: {
      this_period,
      prior_period,
      ratio: Number(ratio.toFixed(2)),
    },
  };
}
