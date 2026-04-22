/**
 * Next-action footer derivation.
 *
 * Every lens tool ends with a concrete "→ Next action:" line so the
 * operator never hits a dead end. The line is data-driven — it reads
 * the same response the lens just rendered and picks the most useful
 * follow-up tool. The goal is not a clever recommender; it's an honest
 * routing decision that a human would otherwise make after reading.
 *
 * When a lens is clearly healthy (no red flags in the data), the next
 * action explicitly says "nothing to do this period — call X when Y."
 * That's more honest than pretending there's always something to chase.
 *
 * Keep heuristics simple and keep the threshold math obvious — an
 * operator should be able to look at the lens output and agree with
 * the recommendation just by scanning.
 */

export interface NextAction {
  /**
   * Short imperative next step. Concatenated as `→ Next action: <text>`.
   * Include a tool name (backticks optional) so the operator can act.
   */
  text: string;
}

/* --------------------------------- friction --------------------------------- */

export interface FrictionSummary {
  total_interactions?: number;
  top_targets?: Array<{
    target_system_id?: string;
    proportion_of_wait?: number;
    proportion_of_total?: number;
    failure_rate?: number;
    network_failure_rate?: number;
    retry_count?: number;
  }>;
  failure_breakdown?: Array<{ error_code?: string; count?: number }>;
}

/**
 * Friction report routes to:
 *   - failure registry, when a single target dominates failures
 *   - skill tracker, when retries spike on one target
 *   - network status, when failures look network-wide
 *   - "stay the course" when nothing is red.
 */
export function frictionNextAction(s: FrictionSummary | null | undefined): NextAction {
  if (!s || !s.total_interactions) {
    return { text: 'call `log_interaction` after external calls so the lens has data to show.' };
  }
  const targets = s.top_targets ?? [];

  // Network-wide failure signal wins — don't send the operator chasing
  // their own code when the whole network is red.
  const networkyTarget = targets.find(
    (t) => (t.failure_rate ?? 0) > 0.5 && (t.network_failure_rate ?? 0) > 0.3,
  );
  if (networkyTarget?.target_system_id) {
    return {
      text: `call \`get_network_status\` — ${networkyTarget.target_system_id} is failing across multiple agents, not just you.`,
    };
  }

  // High retry concentration on a single target — skill/MCP tracker
  // usually has something useful there.
  const retryHot = targets.find((t) => (t.retry_count ?? 0) >= 3);
  if (retryHot?.target_system_id) {
    return {
      text: `call \`get_skill_tracker\` to see if ${retryHot.target_system_id} has a known version with better retry behavior.`,
    };
  }

  // Single target eats >30% of wait with >0% failures — look up in
  // failure registry for known error-code remediations.
  const waitHog = targets.find(
    (t) => (t.proportion_of_wait ?? 0) > 0.3 && (t.failure_rate ?? 0) > 0,
  );
  if (waitHog?.target_system_id) {
    return {
      text: `call \`get_failure_registry\` for ${waitHog.target_system_id} — it accounts for >30% of your wait time.`,
    };
  }

  return { text: 'nothing to chase this period. Re-run this lens tomorrow to spot drift.' };
}

/* --------------------------------- trend ---------------------------------- */

export interface TrendSummary {
  per_target?: Array<{
    target?: string;
    latency_change_ratio?: number | null;
    failure_rate_delta?: number | null;
  }>;
}

/**
 * Trend routes to:
 *   - friction report, when any target got measurably slower or more failure-prone
 *   - stable corridors, otherwise — if trend is flat, stability is the story.
 */
export function trendNextAction(s: TrendSummary | null | undefined): NextAction {
  const targets = s?.per_target ?? [];
  const degraded = targets.find(
    (t) => (t.latency_change_ratio ?? 0) > 0.2 || (t.failure_rate_delta ?? 0) > 0.05,
  );
  if (degraded?.target) {
    return {
      text: `call \`get_friction_report\` — ${degraded.target} degraded period-over-period.`,
    };
  }
  return { text: 'call `get_stable_corridors` to see which paths you can trust this week.' };
}

/* -------------------------------- coverage -------------------------------- */

export interface CoverageSummary {
  rules?: Array<{ signal?: string; triggered?: boolean }>;
}

export function coverageNextAction(s: CoverageSummary | null | undefined): NextAction {
  const triggered = (s?.rules ?? []).filter((r) => r.triggered).map((r) => r.signal).filter(Boolean);
  if (triggered.length > 0) {
    return {
      text: `call \`log_interaction\` consistently — gaps in ${triggered.slice(0, 2).join(', ')} mean some lenses won't have signal yet.`,
    };
  }
  return { text: 'coverage looks complete. Call `get_friction_report` to read the lenses you just unlocked.' };
}

/* --------------------------- failure-registry ---------------------------- */

export interface FailureRegistrySummary {
  total_failures?: number;
  by_error_code?: Array<{ error_code?: string; count?: number; top_target?: string }>;
}

export function failureRegistryNextAction(s: FailureRegistrySummary | null | undefined): NextAction {
  const total = s?.total_failures ?? 0;
  if (total === 0) {
    return { text: 'no failures this window. Call `get_trend` to spot degradations before they turn into failures.' };
  }
  const top = (s?.by_error_code ?? [])[0];
  if (top?.error_code && top.top_target) {
    return {
      text: `call \`get_skill_tracker\` for ${top.top_target} — ${top.error_code} is the dominant failure mode.`,
    };
  }
  return { text: 'call `get_friction_report` to see whether these failures concentrate in a specific target.' };
}

/* -------------------------- stable-corridors ----------------------------- */

export interface StableCorridorsSummary {
  corridors?: Array<{ target?: string; stability_score?: number }>;
}

export function stableCorridorsNextAction(s: StableCorridorsSummary | null | undefined): NextAction {
  const corridors = s?.corridors ?? [];
  if (corridors.length === 0) {
    return { text: 'no stable corridors yet — log more interactions so patterns can emerge.' };
  }
  return { text: 'call `get_trend` to see whether these corridors held up period-over-period.' };
}

/* ---------------------------- network-status ----------------------------- */

export interface NetworkStatusSummary {
  degraded_systems?: Array<{ system_id?: string; failure_rate?: number }>;
}

export function networkStatusNextAction(s: NetworkStatusSummary | null | undefined): NextAction {
  const degraded = s?.degraded_systems ?? [];
  if (degraded.length === 0) {
    return { text: 'network looks healthy. Call `get_friction_report` for agent-local issues.' };
  }
  return { text: 'call `check_entity` on the top degraded system to see its history.' };
}

/* ------------------------- revealed-preference --------------------------- */

export interface RevealedPreferenceSummary {
  signals?: Array<{ type?: string; target?: string }>;
}

export function revealedPreferenceNextAction(s: RevealedPreferenceSummary | null | undefined): NextAction {
  const n = (s?.signals ?? []).length;
  if (n === 0) {
    return { text: 'no revealed-preference signals yet. Keep logging — the lens needs repeated behavior to speak.' };
  }
  return { text: 'call `get_stable_corridors` to see whether your actual routing matches what you believe is stable.' };
}

/* --------------------------- compensation --------------------------- */

export interface CompensationSummary {
  signatures?: unknown[];
}

export function compensationNextAction(s: CompensationSummary | null | undefined): NextAction {
  const n = (s?.signatures ?? []).length;
  if (n === 0) {
    return { text: 'no compensation signatures detected this window. Call `get_failure_registry` to see raw failures.' };
  }
  return { text: 'call `get_friction_report` — compensation activity usually concentrates in a small set of friction targets.' };
}

/* ------------------------------- whats-new ------------------------------- */

export interface WhatsNewSummary {
  items?: unknown[];
}

export function whatsNewNextAction(s: WhatsNewSummary | null | undefined): NextAction {
  const n = (s?.items ?? []).length;
  if (n === 0) {
    return { text: 'nothing new. Call `get_friction_report` for a fresh read of this week\'s behavior.' };
  }
  return { text: 'call `get_notifications` to see the items worth acknowledging.' };
}

/* ------------------------------- summarize ------------------------------- */

export interface SummarizeSummary {
  friction?: FrictionSummary | null;
  coverage?: CoverageSummary | null;
}

export function summarizeNextAction(s: SummarizeSummary | null | undefined): NextAction {
  // Summarize is a cross-lens snapshot — the next action is whichever
  // lens underneath surfaced the strongest signal. We defer to friction
  // first because it's where the shadow tax shows up; coverage next.
  const friction = frictionNextAction(s?.friction ?? null);
  if (!friction.text.startsWith('nothing')) return friction;
  return coverageNextAction(s?.coverage ?? null);
}

/* ------------------------------- get_my_agent ---------------------------- */

export interface MyAgentSummary {
  friction?: FrictionSummary | null;
  coverage?: CoverageSummary | null;
  unread_notifications?: number | null;
}

export function myAgentNextAction(s: MyAgentSummary | null | undefined): NextAction {
  if ((s?.unread_notifications ?? 0) > 0) {
    return { text: 'call `get_notifications` — unread signals are waiting.' };
  }
  return summarizeNextAction(s ?? null);
}

/* ------------------------------- renderer -------------------------------- */

/**
 * Render the standardized next-action footer line. Caller supplies the
 * NextAction returned by a per-lens heuristic. Blank lines around so it
 * reads as its own section.
 */
export function renderNextActionFooter(action: NextAction | null | undefined): string {
  if (!action || !action.text) return '';
  return `\n→ Next action: ${action.text}\n`;
}
