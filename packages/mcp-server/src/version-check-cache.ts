/**
 * Cross-session memoization for the npm version check.
 *
 * Why: `createAcrServer` fires one version check per process. Under stdio
 * transport that's fine — one check per CLI invocation. Under HTTP
 * transport, every `sessionContext.run` spins up a new `SessionState`,
 * and historically that meant every fresh MCP session re-hit npm. On a
 * shared server with bursty sessions that's a wasted round-trip per
 * session and, worse, a hot dependency on an external service during
 * startup latency.
 *
 * Design:
 *   - The cache sits next to the existing `.acr-state.json` at
 *     `~/.claude/.acr-version-check.json`.
 *   - Cache hit iff `current` matches the running package version AND
 *     `checkedAt` is within `CACHE_TTL_MS`. The version match is the
 *     important part: if the user upgraded, we must re-check.
 *   - Write is fire-and-forget; a read failure returns null and falls
 *     through to a live check.
 *   - 6 hour TTL. Long enough that bursty HTTP sessions don't all
 *     re-hit npm; short enough that a day-old install still catches
 *     new releases within an operator's normal working rhythm.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { VersionCheckResult } from './version-check.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface SerializedCheck {
  current: string;
  latest: string | null;
  upgradeAvailable: boolean;
  checkedAt: string; // ISO
}

function cachePath(): string {
  return join(homedir(), '.claude', '.acr-version-check.json');
}

/**
 * Read the cached version check. Returns null if no cache exists, the
 * cache is malformed, the cache is for a different running version
 * (caller upgraded the package), or the cache is older than the TTL.
 */
export function readCachedVersionCheck(
  current: string,
  now: Date = new Date(),
): VersionCheckResult | null {
  try {
    const raw = readFileSync(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as SerializedCheck;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.current !== current) return null;
    const checkedAt = new Date(parsed.checkedAt);
    if (!Number.isFinite(checkedAt.getTime())) return null;
    if (now.getTime() - checkedAt.getTime() > CACHE_TTL_MS) return null;
    return {
      current: parsed.current,
      latest: parsed.latest,
      upgradeAvailable: parsed.upgradeAvailable,
      checkedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Persist a successful version check. Fire-and-forget — never throws.
 * Only writes when `latest` is non-null (i.e. the check actually
 * reached the registry). Storing a fail result would make the next
 * session inherit the failure for the whole TTL window, which is worse
 * than re-trying.
 */
export function writeCachedVersionCheck(result: VersionCheckResult): void {
  if (result.latest === null) return;
  try {
    const dir = join(homedir(), '.claude');
    mkdirSync(dir, { recursive: true });
    const payload: SerializedCheck = {
      current: result.current,
      latest: result.latest,
      upgradeAvailable: result.upgradeAvailable,
      checkedAt: result.checkedAt.toISOString(),
    };
    writeFileSync(cachePath(), JSON.stringify(payload));
  } catch {
    // Fire-and-forget.
  }
}
