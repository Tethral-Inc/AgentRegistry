/**
 * Background check for a newer published version of @tethral/acr-mcp.
 *
 * Why this exists: MCP installs are long-running processes and users
 * rarely update them. Without a check, a user could run a pre-probes
 * build for months without knowing that transport-boundary observation,
 * error-code breakdowns, or new lenses have shipped. This module hits
 * the public npm registry once per process, compares against the
 * baked-in package version, and stashes the result on the session so
 * natural entry-point tools (`getting_started`, `whats_new`,
 * `get_my_agent`) can surface an upgrade hint.
 *
 * Design constraints:
 *  - Non-blocking: must never affect MCP startup. Uses background async.
 *  - Silent: any failure (network, DNS, parse, timeout) is swallowed.
 *  - Un-observed: uses the unwrapped fetch so the version check itself
 *    does not become a receipt.
 *  - Bounded: 2s AbortSignal timeout + 8KB body cap.
 *  - Once per process: result is cached in-memory on the session.
 *  - Opt-out: `ACR_DISABLE_VERSION_CHECK=1` skips entirely.
 */

import { envBool } from './utils/env.js';

const PACKAGE_NAME = '@tethral/acr-mcp';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
const REQUEST_TIMEOUT_MS = 2000;
const BODY_CAP_BYTES = 8 * 1024;

export interface VersionCheckResult {
  /** Version currently running (from build-time inject). */
  current: string;
  /** Latest version found on the npm registry, or null if the check failed. */
  latest: string | null;
  /** True when latest is present AND strictly greater than current. */
  upgradeAvailable: boolean;
  /** Wall-clock time the check completed. */
  checkedAt: Date;
}

/**
 * Parse a semver "major.minor.patch" (ignoring pre-release / build metadata)
 * into a comparable numeric triple. Returns null for strings that do not
 * parse cleanly — the caller is expected to treat a null as "skip the
 * comparison" rather than guess.
 */
export function parseSemver(version: string): [number, number, number] | null {
  if (typeof version !== 'string') return null;
  // Strip any leading "v" and drop pre-release / build metadata for the
  // coarse comparison. Production releases on this package do not carry
  // pre-release tags, so this is sufficient; if we ever ship a beta, the
  // comparison correctly treats "2.4.1-beta" as equal to "2.4.1", which
  // won't prompt anyone to downgrade.
  const cleaned = version.replace(/^v/i, '').split(/[-+]/, 1)[0] ?? version;
  const parts = cleaned.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return [nums[0] as number, nums[1] as number, nums[2] as number];
}

/**
 * True iff `candidate` is strictly greater than `baseline` under coarse
 * semver comparison. Returns false on any parse failure — we prefer
 * quiet no-ops over a mis-rendered "upgrade available" banner.
 */
export function isNewerVersion(candidate: string, baseline: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(baseline);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/**
 * Fire the registry check. All failures return a result with
 * `latest: null, upgradeAvailable: false`. The caller is not expected
 * to surface anything in that case.
 *
 * The `fetchImpl` parameter lets callers inject `getUnwrappedFetch()`
 * so the check itself bypasses the fetch observer. In tests, pass a
 * stub returning a Response.
 */
export async function checkLatestVersion(
  current: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VersionCheckResult> {
  const checkedAt = new Date();
  const fail = (): VersionCheckResult => ({
    current,
    latest: null,
    upgradeAvailable: false,
    checkedAt,
  });

  if (envBool('ACR_DISABLE_VERSION_CHECK', false)) return fail();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl(REGISTRY_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return fail();

    // Cap body read. npm's /latest document is small (~1KB) — anything
    // larger means something is wrong and we'd rather drop than parse.
    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming body (older fetch runtime). Fall back to text(),
      // still bounded by content-length caps at the fetch layer.
      const text = await res.text();
      if (text.length > BODY_CAP_BYTES) return fail();
      const parsed = JSON.parse(text) as { version?: unknown };
      const latest = typeof parsed.version === 'string' ? parsed.version : null;
      return {
        current,
        latest,
        upgradeAvailable: latest !== null && isNewerVersion(latest, current),
        checkedAt,
      };
    }

    let received = 0;
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > BODY_CAP_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          return fail();
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8').decode(merged);
    const parsed = JSON.parse(text) as { version?: unknown };
    const latest = typeof parsed.version === 'string' ? parsed.version : null;
    return {
      current,
      latest,
      upgradeAvailable: latest !== null && isNewerVersion(latest, current),
      checkedAt,
    };
  } catch {
    return fail();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Render an upgrade banner suitable for prepending to a tool's text
 * output. Returns an empty string when no upgrade is available so the
 * caller can do `banner + body` unconditionally.
 */
export function renderUpgradeBanner(result: VersionCheckResult | null): string {
  if (!result || !result.upgradeAvailable || !result.latest) return '';
  return (
    `⚠ Upgrade available: ${PACKAGE_NAME} ${result.current} → ${result.latest}\n` +
    `  Update with: npx -y ${PACKAGE_NAME}@latest  (or pin @${result.latest})\n` +
    `  Disable this check: ACR_DISABLE_VERSION_CHECK=1\n\n`
  );
}
