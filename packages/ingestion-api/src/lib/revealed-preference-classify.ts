/**
 * Revealed-preference classification.
 *
 * Given the set of composition sources that bind a target and the number
 * of times the agent actually called it in the window, classify the
 * target into one of four buckets:
 *   - bound_uncalled   : declared, never called
 *   - bound_underused  : declared, called 1-2 times (below threshold)
 *   - bound_active     : declared and called meaningfully (>= threshold)
 *   - called_unbound   : called but not declared (composition drift)
 *
 * The threshold is a knob — not a verdict. Low counts may be task-gated
 * (agent hasn't hit the path yet) or genuinely underused. The lens
 * surfaces the signal; the operator interprets.
 */

export const UNDERUSED_THRESHOLD = 3;

export type RevealedPreferenceClassification =
  | 'bound_uncalled'
  | 'bound_underused'
  | 'bound_active'
  | 'called_unbound';

export function classifyRevealedPreference(
  isBound: boolean,
  callCount: number,
): RevealedPreferenceClassification {
  if (!isBound) return 'called_unbound';
  if (callCount === 0) return 'bound_uncalled';
  if (callCount < UNDERUSED_THRESHOLD) return 'bound_underused';
  return 'bound_active';
}
