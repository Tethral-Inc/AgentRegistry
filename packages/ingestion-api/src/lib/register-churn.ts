/**
 * Per-IP register churn defense — pure decision logic.
 *
 * The register endpoint is intentionally public (no API key required) so
 * free users can onboard without an OAuth/payment wall. The tradeoff is
 * that /register is an anonymous JWT + api_key minting machine. To keep
 * the cost bounded without closing the door on legitimate callers, we
 * count successful registrations per (ip, bucket_hour) and reject once
 * one IP exceeds a threshold.
 *
 * This file is the pure decision layer — the SQL lives in the handler.
 * Keeping the threshold logic out of the handler lets us unit-test the
 * limiter without a database fixture.
 *
 * Known blindspot: distributed-IP spray (botnet / proxy rotation) defeats
 * this. Mitigation at that point is a CDN-level filter, not more SQL.
 */

// Default ceiling on distinct successful registrations per IP per hour.
// 100 is deliberately generous — CI runners batch-creating test agents
// need headroom, and false positives lock legitimate users out of
// onboarding entirely. Tighten later if abuse is observed in logs.
export const DEFAULT_REGISTER_CHURN_THRESHOLD = 100;

/**
 * Parse REGISTER_CHURN_THRESHOLD_PER_IP_HOUR from env.
 * Returns the default on missing / non-numeric / non-positive input.
 */
export function parseRegisterChurnThreshold(envValue: string | undefined): number {
  if (!envValue) return DEFAULT_REGISTER_CHURN_THRESHOLD;
  const n = Number.parseInt(envValue, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REGISTER_CHURN_THRESHOLD;
  return n;
}

/**
 * True when the current IP's registration count meets or exceeds the
 * threshold. The comparison is `>=` so the threshold is the *first
 * rejected* count — threshold=100 means "accept the 100th, reject the
 * 101st." This reads more naturally in logs than off-by-one boundaries.
 */
export function shouldRejectRegistration(
  currentCount: number,
  threshold: number,
): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return false;
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return currentCount >= threshold;
}

/**
 * Extract the client IP from the usual proxy headers. Returns 'unknown'
 * when neither is present — caller should skip the churn check in that
 * case rather than attribute traffic to a sentinel bucket.
 */
export function extractClientIp(
  forwardedFor: string | undefined,
  realIp: string | undefined,
): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  if (first && first.length > 0) return first;
  if (realIp && realIp.length > 0) return realIp;
  return 'unknown';
}
