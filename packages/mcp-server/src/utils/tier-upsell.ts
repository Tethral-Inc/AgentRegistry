/**
 * Contextual tier upsell.
 *
 * Free-tier callers used to see paid-only sections silently omitted
 * with no explanation — leaving them to conclude "ACR doesn't surface
 * X" when in fact "ACR surfaces X on the paid tier." The audit
 * (Sprint 2 / F8) called for explicit "paid unlocks: <specific
 * thing>" copy in lens output, scoped to what the user's data
 * actually suggests would be valuable. Generic "upgrade for X"
 * footers are noise; data-driven upsells earn the screen real estate.
 *
 * The contract:
 *   - input: the lens response (typed loosely — heuristics here only
 *     read what's safe to peek at)
 *   - output: zero or one short upsell line, computed from the data
 *
 * Honors `ACR_NO_UPSELL=1` so users who've decided can suppress all
 * upsells without having to opt out per-tool.
 */

import { envBool } from './env.js';

/**
 * The features the paid tier unlocks on the friction lens. Sources:
 * README §"Lenses at a glance" + the friction route's tier-gated
 * sections.
 */
export const PAID_FRICTION_FEATURES = [
  'population baselines (vs_baseline / volatility)',
  'retry overhead breakdown',
  'directional pair analysis',
  'population drift',
  'population comparison',
] as const;

/**
 * True when the user (or their config) has opted out of upsell copy
 * across the surface. We check this once per render so a chatty lens
 * doesn't repeat the env lookup per-section.
 */
function suppressUpsells(): boolean {
  return envBool('ACR_NO_UPSELL', false);
}

interface FrictionUpsellInput {
  tier?: string | null;
  retry_overhead?: { total_retries?: number } | null;
  chain_analysis?: { chain_count?: number; total_chain_overhead_ms?: number } | null;
  directional_pairs?: unknown[] | null;
  population_drift?: { targets?: unknown[] } | null;
  top_targets?: Array<{ failure_rate?: number; retry_count?: number }> | null;
}

/**
 * Compute the friction-lens upsell line. Returns '' when:
 *   - the user is on a paid tier (nothing to sell), OR
 *   - ACR_NO_UPSELL is set, OR
 *   - the data offers no signal that a paid feature would help.
 *
 * The line is data-driven: high retries → mention retry overhead;
 * many chains → mention directional analysis; etc. We pick the most
 * compelling single line rather than listing all paid features.
 */
export function frictionTierUpsell(input: FrictionUpsellInput): string {
  if (suppressUpsells()) return '';
  const tier = (input.tier ?? 'free').toLowerCase();
  if (tier !== 'free') return '';

  const targets = input.top_targets ?? [];

  // High aggregate retries → directional analysis is the right pitch.
  // Threshold matches the per-target retry threshold the next-action
  // helper uses, applied across targets.
  const totalRetries = targets.reduce((sum, t) => sum + (t.retry_count ?? 0), 0);
  if (totalRetries >= 5) {
    return `\n[Paid tier] Retry overhead breakdown would attribute these ${totalRetries} retries to specific targets and quantify the wasted seconds. See \`get_tier_features\`.\n`;
  }

  // Multiple distinct chains → directional pair analysis is the pitch.
  const chainCount = input.chain_analysis?.chain_count ?? 0;
  if (chainCount >= 3) {
    return `\n[Paid tier] Directional pair analysis would show which preceded_by → next-call pairs amplify your latency (e.g. "openai → stripe" runs 2.3× slower than standalone). See \`get_tier_features\`.\n`;
  }

  // Many failures across multiple targets → population baselines pitch.
  const failingTargets = targets.filter((t) => (t.failure_rate ?? 0) > 0).length;
  if (failingTargets >= 2) {
    return `\n[Paid tier] Population baselines would tell you whether your failure rates are normal for these targets across the network or specifically yours. See \`get_tier_features\`.\n`;
  }

  // Default: no specific pitch, no upsell. Don't show generic ones —
  // the audit explicitly called those out as noise.
  return '';
}

/**
 * Render the full feature comparison for `get_tier_features`. Static
 * content; the tool is just a convenient surface for the README's
 * paid-tier matrix without forcing the operator to context-switch.
 */
export function renderTierFeaturesReport(): string {
  let text = `ACR Tier Features\n${'='.repeat(20)}\n\n`;

  text += `── Free tier ──\n`;
  text += `  Lenses: friction (summary, top targets), failure registry, stable corridors,\n`;
  text += `          trend, coverage, revealed preference, compensation signatures.\n`;
  text += `  Network: full network status dashboard, threat feed, notifications.\n`;
  text += `  Logging: unlimited log_interaction, full agent identity + dashboard access.\n\n`;

  text += `── Paid tier (additional) ──\n`;
  for (const feature of PAID_FRICTION_FEATURES) {
    text += `  • Friction lens: ${feature}\n`;
  }
  text += `\n`;

  text += `Suppress contextual upsell lines: ACR_NO_UPSELL=1\n`;
  text += `Upgrade: see https://acr.nfkey.ai for current pricing.\n`;
  return text;
}
