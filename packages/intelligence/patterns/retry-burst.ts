/**
 * retry_burst
 *
 * Fires when a single target is being retried at a high rate relative
 * to the agent's overall activity — something is reliably failing and
 * the agent keeps hitting it.
 *
 * The signal is target-specific, not agent-wide. We only surface the
 * worst offender (highest retry share) to avoid listing every
 * marginally-retried target. If the operator wants the full breakdown,
 * get_friction_report exposes per-target retry stats.
 *
 * Gates (all must hold):
 *   - The target has at least 10 calls in the period (enough sample).
 *   - Retry count on that target ≥ 5 in the period.
 *   - Retry share on that target (retries / calls) ≥ 30%.
 *
 * Confidence scales with retry share:
 *   - 30%–50% retries → 0.65
 *   - 50%–70% retries → 0.80
 *   - 70%+ retries    → 0.92
 *
 * Metadata carries the offending target + retry counts so the render
 * can point at it ("You've retried api:slack.com 12 times in 2
 * hours").
 */

import type { DetectionInput, PatternDetection } from './types.js';

const MIN_CALLS = 10;
const MIN_RETRIES = 5;
const MIN_RETRY_SHARE = 0.30;

export function detectRetryBurst(
  input: DetectionInput,
): PatternDetection | null {
  // Find worst offender by retry share.
  let worstTarget: { target_system_id: string; calls: number; retries: number; share: number } | null = null;
  for (const t of input.recent_targets) {
    if (t.call_count < MIN_CALLS) continue;
    if (t.retry_count < MIN_RETRIES) continue;
    const share = t.retry_count / t.call_count;
    if (share < MIN_RETRY_SHARE) continue;
    if (!worstTarget || share > worstTarget.share) {
      worstTarget = {
        target_system_id: t.target_system_id,
        calls: t.call_count,
        retries: t.retry_count,
        share,
      };
    }
  }

  if (!worstTarget) return null;

  let confidence: number;
  if (worstTarget.share >= 0.7) confidence = 0.92;
  else if (worstTarget.share >= 0.5) confidence = 0.80;
  else confidence = 0.65;

  const sharePct = (worstTarget.share * 100).toFixed(0);
  return {
    pattern_type: 'retry_burst',
    confidence,
    title: `${worstTarget.target_system_id} retried ${worstTarget.retries}× in 7d (${sharePct}% retry rate)`,
    message: `${worstTarget.retries} retries across ${worstTarget.calls} calls means something is reliably failing there. Check get_failure_registry for the status-code breakdown, or look at peer traffic via get_stable_corridors.`,
    metadata: {
      target_system_id: worstTarget.target_system_id,
      call_count: worstTarget.calls,
      retry_count: worstTarget.retries,
      retry_share: Number(worstTarget.share.toFixed(3)),
    },
  };
}
