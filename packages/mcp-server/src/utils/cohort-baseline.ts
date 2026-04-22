/**
 * Cohort baseline prepend — gives brand-new agents useful framing on
 * lens calls before they have ≥10 interactions of their own.
 *
 * Why: every lens (friction, coverage, trend, etc.) renders "pre-signal
 * — thin sample" for the first ~10 interactions. That's honest math but
 * a poor first experience. This helper fetches the typical performance
 * for the caller's provider_class cohort from the public
 * `/baselines/cohort` endpoint and returns a short section the lens can
 * prepend. The caller's own (thin) section still follows — the baseline
 * is framing, not a substitute.
 *
 * Privacy: the cohort endpoint is server-aggregated and requires
 * cohort_size >= 3, so no individual agent leaks through. This client
 * just renders what the server returned.
 *
 * Never throws: fetch failures / missing cohort / empty targets all
 * return the empty string. A baseline is nice-to-have; a lens must
 * still render without it.
 */

import { getActiveSession } from '../session-state.js';

export const THIN_SAMPLE_THRESHOLD = 10;

interface CohortTarget {
  target_system_id: string;
  target_system_type: string | null;
  cohort_size: number;
  total_interactions: number;
  median_duration_ms: number | null;
  p95_duration_ms: number | null;
  failure_rate: number;
  anomaly_rate: number;
}

interface CohortResponse {
  provider_class: string;
  window_days: number;
  cohort_size: number;
  total_interactions: number;
  targets?: CohortTarget[];
  reason?: string;
}

/**
 * Fetch the cohort baseline for the active session's provider_class and
 * render a short prepend-section. Returns '' if the baseline isn't
 * useful (cohort too small, fetch failed, empty targets).
 *
 * The endpoint is public (no auth required) — cohort data is aggregated
 * and never per-agent.
 */
export async function renderCohortBaselineHeader(apiUrl: string): Promise<string> {
  try {
    const providerClass = getActiveSession().providerClass;
    // 'unknown' cohorts are noisy and usually not the caller's actual
    // cohort — skip rather than show misleading framing.
    if (!providerClass || providerClass === 'unknown') return '';

    const url = `${apiUrl}/api/v1/baselines/cohort?provider_class=${encodeURIComponent(providerClass)}`;
    const res = await fetch(url);
    if (!res.ok) return '';
    const data = (await res.json()) as CohortResponse;

    if (!data.targets || data.targets.length === 0) return '';
    if ((data.cohort_size ?? 0) < 3) return '';

    // Show the top 3 busiest targets. More would crowd out the agent's
    // own thin section, which is the actual answer to their question.
    const top = data.targets.slice(0, 3);
    let out = `── Your cohort's typical performance (${data.provider_class}, last ${data.window_days}d) ──\n`;
    out += `Based on ${data.cohort_size} agents in your provider class.\n`;
    for (const t of top) {
      const median = t.median_duration_ms ? `${Math.round(t.median_duration_ms)}ms median` : 'median n/a';
      const p95 = t.p95_duration_ms ? `${Math.round(t.p95_duration_ms)}ms p95` : 'p95 n/a';
      const failPct = (t.failure_rate * 100).toFixed(1);
      out += `  ${t.target_system_id}: ${median}, ${p95}, ${failPct}% failure (n=${t.total_interactions}, cohort=${t.cohort_size})\n`;
    }
    out += `Your own numbers follow — compare against these to see where you sit.\n\n`;
    return out;
  } catch {
    // Baseline is framing, not critical — never block a lens on its
    // absence.
    return '';
  }
}

/**
 * Should the lens prepend a cohort baseline? True when the agent's
 * sample is below the thin-sample threshold. Pass `totalInteractions`
 * from the lens's own count.
 */
export function isThinSample(totalInteractions: number | undefined | null): boolean {
  if (totalInteractions == null) return true;
  return totalInteractions < THIN_SAMPLE_THRESHOLD;
}
