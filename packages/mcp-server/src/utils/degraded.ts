import { section } from './style.js';

/**
 * Degraded-lens contract (client side).
 *
 * Every lens route sets `degraded: true` on its JSON when a backend query
 * threw — as opposed to genuinely returning zero/empty data. Renderers MUST
 * check this BEFORE printing any "OK" / "no data" / "healthy" framing, or a
 * silently-failed query reads as a clean all-clear (the false-green failure
 * class this contract exists to kill).
 */
export function isDegraded(data: Record<string, unknown> | null | undefined): boolean {
  return !!(data && (data as { degraded?: unknown }).degraded);
}

/**
 * Standard notice for a degraded lens response. Render this instead of the
 * normal sections when `isDegraded(data)` is true.
 */
export function renderDegradedNotice(lensLabel: string, data?: Record<string, unknown>): string {
  const reason =
    data && typeof (data as { degraded_reason?: unknown }).degraded_reason === 'string'
      ? (data as { degraded_reason: string }).degraded_reason
      : undefined;
  let text = `\n${section('⚠ Data unavailable')}\n`;
  text += `  ${lensLabel} could not be computed — a backend query failed.\n`;
  text += `  This is NOT an all-clear: treat any zero/empty values as unknown, not healthy.\n`;
  if (reason) text += `  Reason: ${reason}\n`;
  text += `  The failure was logged server-side; retry shortly.\n`;
  return text;
}
