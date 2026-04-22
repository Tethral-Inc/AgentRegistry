/**
 * composition_staleness
 *
 * Fires when the agent's declared composition (mcp_components ∪
 * api_components) hasn't been updated in ≥4 days AND the agent has
 * been calling targets the declared set doesn't cover.
 *
 * Why two gates: 4 days on its own is just "no update" — not a
 * problem. The signal is the *delta* between what the agent says it
 * uses and what the receipts actually show. That's the gap that stops
 * targeted notifications from reaching operators.
 *
 * Confidence scales with the size of the undeclared set:
 *   - 1 undeclared target   → 0.55 (below surface threshold — sub-
 *     signal, may be a one-off tool call)
 *   - 2 undeclared targets  → 0.70
 *   - 3+ undeclared targets → 0.85
 *
 * The metadata carries the undeclared-target list so the render can
 * name them specifically ("you've called X, Y, Z that aren't in your
 * composition").
 */

import type { DetectionInput, PatternDetection } from './types.js';

const STALENESS_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function detectCompositionStaleness(
  input: DetectionInput,
  now: Date = new Date(),
): PatternDetection | null {
  if (!input.composition_updated_at) return null;
  const ageDays = (now.getTime() - input.composition_updated_at.getTime()) / DAY_MS;
  if (ageDays < STALENESS_DAYS) return null;

  // Find targets the agent has actually called that aren't in the
  // declared composition. We only look at meaningful usage (≥3 calls)
  // to avoid flagging one-off exploratory calls.
  const undeclared = input.recent_targets
    .filter((t) => t.call_count >= 3)
    .map((t) => t.target_system_id)
    .filter((id) => !input.declared_targets.has(id));

  if (undeclared.length === 0) return null;

  let confidence: number;
  if (undeclared.length >= 3) confidence = 0.85;
  else if (undeclared.length === 2) confidence = 0.70;
  else confidence = 0.55;

  const roundedAge = Math.floor(ageDays);
  const list = undeclared.slice(0, 5).join(', ');
  const more = undeclared.length > 5 ? ` (+${undeclared.length - 5} more)` : '';

  return {
    pattern_type: 'composition_staleness',
    confidence,
    title: `Composition hasn't updated in ${roundedAge} days — ${undeclared.length} undeclared target${undeclared.length === 1 ? '' : 's'}`,
    message: `You've been calling ${list}${more} but none are in your declared composition. Targeted notifications only fire for declared components. Run update_composition.`,
    metadata: {
      composition_age_days: roundedAge,
      undeclared_targets: undeclared,
    },
  };
}
