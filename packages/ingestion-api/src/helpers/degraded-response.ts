import type { Context } from 'hono';

/**
 * Fail-safe response for a degraded lens.
 *
 * A lens whose backing query threw must not return an evaluable payload:
 * clients that predate the `degraded` flag render zeros / empty arrays as
 * a clean bill of health ("Covered — OK", "no failures", "no drift").
 * The only response every published client handles honestly is a non-200 —
 * their shared `!res.ok` path surfaces it as an error instead of a verdict.
 *
 * The body still carries the degraded fields so current and future clients
 * can render a proper "data unavailable — not an all-clear" message.
 */
export function degraded503(c: Context, agentId: string | null, reason: string) {
  return c.json(
    {
      ...(agentId ? { agent_id: agentId } : {}),
      error: 'lens_degraded',
      degraded: true,
      degraded_reason: reason,
    },
    503,
  );
}
