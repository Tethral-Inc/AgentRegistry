/**
 * Maturity prefix helper for presenter tools.
 *
 * Every presenter tool (get_friction_report, get_failure_registry,
 * get_healthy_corridors, etc.) should include a maturity prefix at the
 * start of its output so operators know how much to trust the findings.
 * This is the "progression, not a gate" pattern made visible — users see
 * the meter fill up as their profile matures.
 *
 * The prefix is computed from the profile_state returned by the /profile
 * endpoint. It's deterministic, pure, and rhetorically consistent with
 * the attribution invariant (subject is the profile, not the user).
 */

export type MaturityState = 'warmup' | 'calibrating' | 'stable_candidate';

export interface ProfileStateForPrefix {
  maturity_state: MaturityState;
  total_receipts: number;
  distinct_targets: number;
  days_active: number;
}

/**
 * Render a one- or two-line maturity prefix. Always returns a non-empty
 * string ending with two newlines so the next section reads cleanly.
 */
export function renderMaturityPrefix(profile: ProfileStateForPrefix): string {
  const { maturity_state, total_receipts, distinct_targets, days_active } = profile;

  switch (maturity_state) {
    case 'warmup':
      return (
        `Your profile is still warming up — ${total_receipts} receipt(s) across ${distinct_targets} target(s). ` +
        `Findings below will firm up once you reach roughly 50 receipts and 3 targets.\n\n`
      );
    case 'calibrating':
      return (
        `Your profile is calibrating — ${total_receipts} receipts across ${distinct_targets} targets over ${days_active} day(s). ` +
        `These are early signals; take them with appropriate uncertainty.\n\n`
      );
    case 'stable_candidate':
      return (
        `Your profile is stable — ${total_receipts} receipts across ${distinct_targets} targets over ${days_active} day(s). ` +
        `Findings below are based on enough data to be reliable.\n\n`
      );
    default:
      // Unknown maturity — render a neutral prefix rather than omit it.
      return `Your profile has ${total_receipts} receipts across ${distinct_targets} targets.\n\n`;
  }
}
