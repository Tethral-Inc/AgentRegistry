/**
 * CI guard — every `fetch(\`${apiUrl}/api/v1/...\`)` call in the tool
 * layer must route through `fetchAuthed` (utils/fetch-authed.ts).
 *
 * Why: `fetchAuthed` pulls the active session's API key via
 * `getAuthHeaders()` and injects it. A bare `fetch(apiUrl/...)` silently
 * skips that, producing tier-gated responses that don't know who's
 * asking — the agent sees a stripped view and has no hint why. Worse,
 * the bug is invisible in code review because the call shape looks fine.
 *
 * Allowlist (intentional exceptions) — these endpoints are explicitly
 * public or run before the agent has a key:
 *   • register-agent.ts — pre-registration POST, no key yet.
 *   • get-network-status.ts — network-wide rollup, public by design.
 *
 * The resolver (`${resolverUrl}/v1/...`) is also unauthed by design and
 * is matched by a different URL prefix — this guard only fires on
 * `api/v1/` paths.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = fileURLToPath(new URL('../../packages/mcp-server/src/tools/', import.meta.url));

const ALLOWLIST = new Set<string>([
  'register-agent.ts',
  'get-network-status.ts',
]);

/**
 * Every offending line captured as `${file}:${lineNo} — ${trimmedLine}`.
 * Empty array == guard passes.
 */
function findBareApiFetches(): string[] {
  const offenders: string[] = [];
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    if (ALLOWLIST.has(file)) continue;
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Match `fetch(` (not `fetchAuthed(` — the `\b` prevents a prefix
      // match) when the same line contains an `/api/v1/` path template.
      // This catches both raw-string URLs and `${apiUrl}/api/v1/...`.
      if (!/\bfetch\s*\(/.test(line)) continue;
      if (/\bfetchAuthed\s*\(/.test(line)) continue;
      if (!/\/api\/v1\//.test(line)) continue;
      offenders.push(`${file}:${i + 1} — ${line.trim()}`);
    }
  }
  return offenders;
}

describe('fetch-authed guard', () => {
  it('routes every authenticated ACR API call through fetchAuthed', () => {
    const offenders = findBareApiFetches();
    expect(
      offenders,
      `These tools hit /api/v1/ with a bare fetch() and skip auth:\n  ${offenders.join('\n  ')}\n\n` +
        `Route them through \`fetchAuthed\` from \`utils/fetch-authed.ts\`, ` +
        `or add the file to the allowlist in this test if the endpoint is intentionally public.`,
    ).toEqual([]);
  });

  it('finds at least one fetchAuthed call somewhere (sanity)', () => {
    // Guards against a regex that silently matches nothing. If every
    // tool stops using `/api/v1/` tomorrow this would pass trivially;
    // this sanity check ensures we're actually scanning.
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
    let found = false;
    for (const file of files) {
      const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
      if (/\bfetchAuthed\s*\(/.test(src)) {
        found = true;
        break;
      }
    }
    expect(found, 'No tool uses fetchAuthed — scraper likely broken.').toBe(true);
  });
});
