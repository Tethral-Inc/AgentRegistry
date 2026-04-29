/**
 * Empty-state template — consistent rendering when a lens has no data.
 *
 * The audit (Sprint 2 / F10) found that empty states were fragmented:
 * `orient_me`'s NEW state was great (cohort framing + clear next
 * step), `whats_new` silently rendered empty sections, `get_my_agent`
 * showed nothing, and lens tools varied wildly. A new agent's first
 * impression depended entirely on which tool they happened to call
 * first.
 *
 * This helper standardizes empty-state rendering as a three-part
 * template:
 *   1. Cohort baseline (when available) — what success looks like
 *      for this agent's provider class. Fetched lazily so the helper
 *      stays cheap when the lens already prepended it.
 *   2. Concrete next step — the literal call the agent should make.
 *   3. Unlocks line — what they'll see in this lens once data is
 *      flowing. Turns empty states into teaching moments.
 *
 * Design constraint: every lens still owns its own copy. This helper
 * just makes the structure consistent. A lens can opt out of any
 * section by passing the empty string, but should not invent its own
 * empty-state shape.
 */

import { renderCohortBaselineHeader } from './cohort-baseline.js';

export interface EmptyStateInput {
  /** Display name to address the operator. Falls back to "this agent". */
  displayName?: string;
  /** Lens label (e.g. "friction", "trend") used in copy. */
  lensName: string;
  /** API URL to fetch cohort baseline. Skip cohort by passing null. */
  apiUrl: string | null;
  /**
   * What the lens would surface once the agent has data. Single short
   * sentence. Examples:
   *   "per-target wait share, retry waste, chain overhead"
   *   "period-over-period failure rate and latency deltas"
   */
  unlocks: string;
  /**
   * Concrete next step the operator should take. Default is the
   * canonical "log_interaction after every external call"; pass a
   * custom string when the lens needs a different prerequisite (e.g.
   * "register a composition first").
   */
  nextStep?: string;
}

const DEFAULT_NEXT_STEP =
  'call `log_interaction` after every external tool call, API request, or MCP interaction.';

/**
 * Render the standardized empty-state body. Returns the prose only —
 * the caller is still responsible for any header/footer/dashboard
 * link they want around it.
 */
export async function renderEmptyState(input: EmptyStateInput): Promise<string> {
  const name = input.displayName?.trim() || 'this agent';
  const nextStep = input.nextStep ?? DEFAULT_NEXT_STEP;

  let text = '';
  if (input.apiUrl) {
    // Cohort framing: shows the operator what success looks like for
    // their provider class so the empty state isn't just "you have
    // nothing." Returns '' on small cohorts / missing data.
    text += await renderCohortBaselineHeader(input.apiUrl);
  }

  text += `No ${input.lensName} data yet for ${name}.\n\n`;
  text += `→ Next step: ${nextStep}\n`;
  text += `   Once you have ≥10 receipts, this lens will show: ${input.unlocks}.\n`;
  return text;
}
