/**
 * Delta rendering helpers for the `get_trend` output.
 *
 * The server returns two per-target delta fields:
 *   - `latency_change_ratio` — historical name, actually `(curr - prev) / prev`,
 *     i.e. a *fraction* in [-1, +∞). A value of 0.12 means "current is 12%
 *     slower than previous." We render that as `+12.0%` with an explicit sign
 *     so the operator can distinguish "got slower" from "got faster" at a
 *     glance.
 *   - `failure_rate_delta` — raw subtraction of two rates in [0, 1]. A value
 *     of 0.05 means "5 more failures per 100 calls than before." We render
 *     that in percentage points (`pp`) because percent-of-a-percent is
 *     unreadable and the operator needs the absolute shift in rate.
 *
 * The explicit sign rule: strictly positive values get a `+`, strictly
 * negative ones keep their `-`, zero gets neither. We never round away a
 * sign — a 0.001% shift still renders with its true direction so operators
 * don't mistake near-zero for exactly-zero.
 */

/**
 * Format a server-returned latency fraction as a signed percentage.
 *
 * Examples:
 *   formatLatencyChangeFraction(0.12)   -> "+12.0%"
 *   formatLatencyChangeFraction(-0.034) -> "-3.4%"
 *   formatLatencyChangeFraction(0)      -> "0.0%"
 */
export function formatLatencyChangeFraction(fraction: number): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Format a server-returned failure-rate delta as signed percentage points.
 *
 * Examples:
 *   formatFailureRateDelta(0.05)   -> "+5.0 pp"
 *   formatFailureRateDelta(-0.012) -> "-1.2 pp"
 *   formatFailureRateDelta(0)      -> "0.0 pp"
 */
export function formatFailureRateDelta(delta: number): string {
  const pp = delta * 100;
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)} pp`;
}
