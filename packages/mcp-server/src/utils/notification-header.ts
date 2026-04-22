/**
 * Unread-notification header helper.
 *
 * Every lens tool prepends a one-line header surfacing the count of
 * unread anomaly-signal notifications. The header is silent (empty
 * string) when there are zero unread — that's the common case, and we
 * don't want to add noise on every call.
 *
 * The fetch is best-effort: a failed probe just renders nothing. A lens
 * call must never error because the notification-count lookup failed.
 */

/**
 * Fetch unread-notification count for an agent. Swallows all errors and
 * returns null on any failure (network, parse, auth). Callers render
 * conditionally on a positive integer.
 */
export async function getUnreadNotificationCount(
  apiUrl: string,
  agentId: string,
  authHeaders: Record<string, string>,
): Promise<number | null> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/agent/${encodeURIComponent(agentId)}/notifications?read=false`,
      { headers: authHeaders },
    );
    if (!res.ok) return null;
    const data = await res.json() as { unread_count?: number };
    const n = data.unread_count;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Render the one-line unread-notification header. Silent (empty string)
 * when count is 0, null, or invalid — so the caller can unconditionally
 * concatenate this at the top of its output.
 *
 * Singular / plural chosen honestly: "1 new signal" vs "N new signals".
 */
export function renderNotificationHeader(count: number | null): string {
  if (count == null || count <= 0) return '';
  const label = count === 1 ? 'signal' : 'signals';
  return `!  ${count} new ${label} since your last call — call get_notifications\n\n`;
}
