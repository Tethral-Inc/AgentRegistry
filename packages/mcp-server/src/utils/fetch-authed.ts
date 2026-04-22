/**
 * fetch-authed — standard authed fetch for ACR `${apiUrl}/api/v1/...` calls.
 *
 * Every tool that hits an authenticated ACR API path should route through
 * this helper. It does two jobs:
 *   1. Auto-injects `getAuthHeaders()` so the server tier-gates the
 *      response correctly for the caller's agent.
 *   2. Merges caller-supplied headers on top (e.g. `Content-Type` on POST).
 *
 * Callers receive a native `Response` and keep handling `res.ok` /
 * `res.json()` themselves — this helper owns auth and nothing else.
 * Error handling, schema validation, and rendering stay with the caller
 * because each lens wants different error copy.
 *
 * What DOES NOT belong here:
 *   - Resolver lookups (`${resolverUrl}/v1/...`) — those are public,
 *     read-only, and unauthed by design.
 *   - The pre-registration POST in `register-agent` — by definition the
 *     agent has no API key yet at that point.
 *   - Network-wide rollups on `${apiUrl}/api/v1/network/status` — that
 *     endpoint is deliberately public so an unregistered agent can probe
 *     the environment before registering.
 *
 * A CI grep-guard (tests/unit/no-bare-fetch-api.test.ts) fails the build
 * if a new `fetch(`${apiUrl}/api/v1/...` call lands in `src/tools/`
 * without going through this helper (or appearing on the explicit
 * allowlist of public endpoints).
 */
import { getAuthHeaders } from '../state.js';

/**
 * Merge two HeadersInit values into a plain record. Later keys win.
 */
function mergeHeaders(
  base: Record<string, string>,
  extra: HeadersInit | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (!extra) return out;
  if (extra instanceof Headers) {
    extra.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) out[k] = v;
    return out;
  }
  Object.assign(out, extra);
  return out;
}

/**
 * Perform an authenticated fetch against an ACR API endpoint. Returns the
 * raw `Response`; the caller inspects `res.ok` / parses the body.
 *
 * Auth headers come from the active session via `getAuthHeaders()`. Any
 * `init.headers` the caller passes are merged on top, so `Content-Type`
 * and friends work as expected.
 */
export async function fetchAuthed(url: string, init?: RequestInit): Promise<Response> {
  const headers = mergeHeaders(getAuthHeaders(), init?.headers);
  return fetch(url, { ...init, headers });
}
