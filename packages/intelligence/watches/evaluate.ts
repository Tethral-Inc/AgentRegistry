/**
 * Watch evaluation — pure decision function.
 *
 * Takes a watch row + the current metric value and decides whether
 * the watch should fire a fresh notification. Three outcomes:
 *   - 'match_new'     : crossing the threshold for the first time, or
 *                       since cooldown expired. Write a notification
 *                       and update last_matched_at.
 *   - 'match_ongoing' : still in breach, but we already notified for
 *                       this crossing recently. Update
 *                       last_evaluated_at, don't write a notification.
 *                       Persistent breaches shouldn't spam.
 *   - 'no_match'      : metric is not in breach. Update last_evaluated_at.
 *
 * Cooldown window is 24h. The operator gets one notification per
 * crossing per day; a breach that clears and re-crosses within 24h is
 * deliberately quiet because we don't have hysteresis yet and a
 * bouncing metric would otherwise generate noise.
 */

export type WatchCondition = 'above' | 'below';

export interface WatchLike {
  threshold: number;
  condition: WatchCondition;
  last_matched_at: Date | null;
}

export type EvaluationOutcome = 'match_new' | 'match_ongoing' | 'no_match';

export const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Return whether the metric value crosses the watch's threshold.
 * Strict inequality — a value exactly at the threshold doesn't fire.
 */
export function crossesThreshold(metricValue: number, watch: WatchLike): boolean {
  if (!Number.isFinite(metricValue)) return false;
  if (watch.condition === 'above') return metricValue > watch.threshold;
  return metricValue < watch.threshold;
}

export function evaluateWatch(
  metricValue: number | null,
  watch: WatchLike,
  now: Date,
): EvaluationOutcome {
  if (metricValue == null || !Number.isFinite(metricValue)) return 'no_match';

  if (!crossesThreshold(metricValue, watch)) return 'no_match';

  if (watch.last_matched_at) {
    const sinceLast = now.getTime() - watch.last_matched_at.getTime();
    if (sinceLast < COOLDOWN_MS) return 'match_ongoing';
  }
  return 'match_new';
}
