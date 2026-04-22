/**
 * Environment-variable parsing helpers.
 *
 * The MCP server has historically accreted three different conventions
 * for reading boolean env vars:
 *
 *   - `'true'` / `'false'`         (ACR_MCP_STATELESS)
 *   - default-true opt-out         (ACR_DEEP_COMPOSITION != 'false')
 *   - `'1'`                        (ACR_DISABLE_FETCH_OBSERVE, etc.)
 *
 * `envBool` unifies all three. A new contributor reading `envBool('X',
 * true)` immediately knows: true when X=1/true/yes/on, false when
 * X=0/false/no/off, default when unset or junk. No per-flag lookup in
 * the call site.
 *
 * Keep this module tiny and side-effect-free. It's imported from
 * module-top-level constants, so any I/O here would run before the
 * server starts.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * Parse a boolean env var with a default.
 *
 * Recognised values (case-insensitive, trimmed):
 *   truthy: "1", "true", "yes", "on"
 *   falsy:  "0", "false", "no", "off"
 *
 * Anything else (including missing) → default. The "anything else"
 * branch is intentionally lenient: a user who sets `ACR_X=verbose`
 * thinking they'll get verbose mode shouldn't accidentally toggle an
 * unrelated flag.
 */
export function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return defaultValue;
}

/**
 * Parse an integer env var with a default. Returns the default if the
 * value is missing, empty, or not a finite integer. Does NOT silently
 * accept floats — a caller asking for a port number shouldn't get 3000.5.
 */
export function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return parsed;
}
