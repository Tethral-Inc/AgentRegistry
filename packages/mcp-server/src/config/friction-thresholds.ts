/**
 * Friction-report verdict thresholds — centralized and named.
 *
 * The per-target "you vs the network" verdict logic used to live inline
 * in `get-friction-report.ts` as a tower of magic numbers. An operator
 * reading the output has no way to reverse-engineer why a target got
 * flagged "likely your config" vs "network-wide." Naming the thresholds
 * here, and rendering them alongside each verdict, makes the math
 * inspectable without running a debugger.
 *
 * Calibration notes live in `docs/friction-verdict-thresholds.md`.
 *
 * A verdict is only issued when BOTH sides have enough sample:
 *   - Local: at least LOCAL_MIN_INTERACTIONS interactions with the target.
 *   - Network: at least NETWORK_MIN_AGENTS agents AND at least
 *     NETWORK_MIN_INTERACTIONS interactions total.
 *
 * Below those floors we surface the raw numbers without a verdict so the
 * operator sees the data but isn't misled by a 1-agent "network."
 */

/* ------------------------------ sample size ------------------------------ */

/** Minimum local interactions before a comparative verdict fires. */
export const LOCAL_MIN_INTERACTIONS = 10;

/** Minimum distinct agents on the network side before a verdict fires. */
export const NETWORK_MIN_AGENTS = 3;

/** Minimum total network interactions before a verdict fires. */
export const NETWORK_MIN_INTERACTIONS = 50;

/* ---------------------------- verdict bands ------------------------------ */
/**
 * "Likely your config/network" — the network is mostly fine but you're
 * failing disproportionately. Requires all of:
 *   - network failure rate strictly below NETWORK_HEALTHY_PCT
 *   - your failure rate at least LOCAL_CONFIG_FLOOR_PCT (absolute floor
 *     so a single failure out of 10 doesn't trigger the "your config"
 *     verdict when the network is at 0.5%)
 *   - your failure rate more than CONFIG_RATIO× the network rate.
 */
export const NETWORK_HEALTHY_PCT = 5;
export const LOCAL_CONFIG_FLOOR_PCT = 5;
export const CONFIG_RATIO = 2;

/**
 * "Better than the network" — inverse case: you're failing less than
 * half as often. yoursPct > 0 guards against a divide-by-zero "better"
 * verdict when you have literally no failures.
 */
export const BETTER_RATIO = 2;

/**
 * "Network-wide issue" — the target is broken for most agents, not just
 * you. Requires both local and network failure rates ≥ NETWORK_WIDE_PCT.
 */
export const NETWORK_WIDE_PCT = 20;

/* --------------------------- verdict strings ----------------------------- */

export const VERDICT_LIKELY_CONFIG = 'likely your config/network — most agents succeed here';
export const VERDICT_BETTER_THAN_NETWORK = 'better than the network on this target';
export const VERDICT_NETWORK_WIDE = 'network-wide issue — this target is failing for many agents';
export const VERDICT_CONSISTENT = 'consistent with the network';

/* ----------------------------- verdict math ------------------------------ */

export interface VerdictInput {
  /** Your failure rate as a fraction in [0, 1]. */
  localFailRate: number;
  /** Network failure rate as a fraction in [0, 1]. */
  networkFailRate: number;
}

export interface VerdictResult {
  /** Human-readable verdict string. */
  verdict: string;
  /** Which threshold clause fired, for rendering the math. */
  clause: 'likely_config' | 'better' | 'network_wide' | 'consistent';
  /** Thresholds used, in percentages, for rendering alongside. */
  math: {
    yoursPct: number;
    netPct: number;
    // The specific rule that fired, as a short inline expression.
    rule: string;
  };
}

/**
 * Render a verdict from local + network failure rates. Caller is
 * responsible for having already checked sample-size floors via
 * `hasEnoughSampleForVerdict`.
 *
 * Ordering matters: the "likely your config" clause is evaluated first
 * because its precondition (net healthy + you elevated) would otherwise
 * be caught by "consistent" under some rate combinations.
 */
export function renderVerdict(input: VerdictInput): VerdictResult {
  const yoursPct = input.localFailRate * 100;
  const netPct = input.networkFailRate * 100;

  if (
    netPct < NETWORK_HEALTHY_PCT &&
    yoursPct >= LOCAL_CONFIG_FLOOR_PCT &&
    yoursPct > netPct * CONFIG_RATIO
  ) {
    return {
      verdict: VERDICT_LIKELY_CONFIG,
      clause: 'likely_config',
      math: {
        yoursPct,
        netPct,
        rule: `net<${NETWORK_HEALTHY_PCT}% AND yours≥${LOCAL_CONFIG_FLOOR_PCT}% AND yours>${CONFIG_RATIO}×net`,
      },
    };
  }
  if (yoursPct > 0 && netPct > yoursPct * BETTER_RATIO) {
    return {
      verdict: VERDICT_BETTER_THAN_NETWORK,
      clause: 'better',
      math: {
        yoursPct,
        netPct,
        rule: `net>${BETTER_RATIO}×yours`,
      },
    };
  }
  if (netPct >= NETWORK_WIDE_PCT && yoursPct >= NETWORK_WIDE_PCT) {
    return {
      verdict: VERDICT_NETWORK_WIDE,
      clause: 'network_wide',
      math: {
        yoursPct,
        netPct,
        rule: `both≥${NETWORK_WIDE_PCT}%`,
      },
    };
  }
  return {
    verdict: VERDICT_CONSISTENT,
    clause: 'consistent',
    math: {
      yoursPct,
      netPct,
      rule: 'none of the above thresholds crossed',
    },
  };
}

/**
 * Sample-size gate. Returns true iff both local and network samples are
 * big enough that a comparative verdict is honest.
 */
export function hasEnoughSampleForVerdict(input: {
  localInteractionCount: number;
  networkAgentCount: number;
  networkInteractionCount: number | null;
}): { enough: boolean; missing: 'local' | 'network' | null } {
  const enoughLocal = input.localInteractionCount >= LOCAL_MIN_INTERACTIONS;
  const enoughNetwork =
    input.networkAgentCount >= NETWORK_MIN_AGENTS &&
    (input.networkInteractionCount == null || input.networkInteractionCount >= NETWORK_MIN_INTERACTIONS);
  if (!enoughLocal) return { enough: false, missing: 'local' };
  if (!enoughNetwork) return { enough: false, missing: 'network' };
  return { enough: true, missing: null };
}
