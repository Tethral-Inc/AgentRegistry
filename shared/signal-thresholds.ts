/**
 * Shared elevation predicate for skill anomaly signals.
 *
 * A skill is broadcast network-wide ("Skills with elevated anomaly signals"
 * in check_environment, network-status, the registration briefing, and the
 * threat feeds) only when the signal clears a noise floor. Before this
 * predicate existed, every read path used `anomaly_signal_count > 0`, so a
 * skill with 4 anomaly flags over 4 total interactions (100% "rate" at
 * noise-level volume) was pushed to every agent on the network as an
 * elevated signal — the opposite of HIBP-style credibility.
 *
 * One predicate, imported everywhere: reporters and volume floors must not
 * drift between read paths, or two surfaces will disagree about which
 * skills are elevated.
 */

/** Minimum distinct reporting agents before a skill signal is elevated. */
export const SKILL_SIGNAL_MIN_REPORTERS = 3;

/** Minimum total observed interactions before a rate is meaningful. */
export const SKILL_SIGNAL_MIN_INTERACTIONS = 20;

/**
 * SQL fragment over skill_hashes columns. Compose into WHERE clauses:
 *   `WHERE ${ELEVATED_SKILL_SIGNAL_SQL}`
 */
export const ELEVATED_SKILL_SIGNAL_SQL =
  `anomaly_signal_count > 0 AND agent_count >= ${SKILL_SIGNAL_MIN_REPORTERS} ` +
  `AND interaction_count >= ${SKILL_SIGNAL_MIN_INTERACTIONS}`;
