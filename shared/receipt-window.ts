/**
 * Canonical receipts-in-window predicate fragments.
 *
 * Every lens counts "the agent's receipts in a window" — and when each lens
 * hand-rolls the predicate, they drift. The 2026-06-26 audit found five
 * irreconcilable answers for one agent/window (profile 1007 / friction 9 /
 * failure-registry 15 / composition-diff 10 / whats_new 18) differing on time
 * column, environmental exclusion, status definition, and grain. PR #13
 * unified them by hand; these constants keep them unified. The db-contract CI
 * job asserts the counts agree on seeded data, so a lens that stops using
 * these (or adds its own twist) fails CI rather than shipping a divergence.
 *
 * Contract:
 *   - time column is `created_at` (receipt write time), never timestamps
 *     supplied by the emitter;
 *   - synthetic environment-probe receipts are excluded from agent-facing
 *     counts (RECEIPT_ENV_EXCLUSION_SQL);
 *   - a failure is any receipt with status != 'success'
 *     (RECEIPT_FAILURE_SQL) — timeout and partial count as failures.
 */

/** Excludes the env-probe's synthetic receipts from agent-facing counts. */
export const RECEIPT_ENV_EXCLUSION_SQL = `(source IS NULL OR source != 'environmental')`;

/** Canonical failure definition. */
export const RECEIPT_FAILURE_SQL = `status != 'success'`;
