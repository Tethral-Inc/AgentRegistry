/**
 * Sample-size confidence tag. Attach to any per-target or per-pair stat
 * that could be misread as authoritative. Keeps raw numbers; annotates
 * interpretation. Thresholds are deliberate: <10 = pre-signal (may vanish
 * next window), 10-29 = directional (real pattern, thin floor), >=30 =
 * significant (ask whether it persists).
 */

export const PRE_SIGNAL_MAX = 9;
export const DIRECTIONAL_MAX = 29;

export function confidence(n: number): string {
  if (n < 10) return `(pre-signal — ${n} samples)`;
  if (n < 30) return `(directional — ${n} samples)`;
  return `(significant — ${n} samples)`;
}
