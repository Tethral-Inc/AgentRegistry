/**
 * CI guard — every tool registered via `server.registerTool(...)` under
 * `src/tools/` must appear in `get_my_agent`'s TOOL_MENU.
 *
 * Why: operators read TOOL_MENU to learn the full tool surface. A tool
 * that lands in the codebase but never appears in the menu is invisible
 * to anyone not grepping the source — which defeats the point of having
 * a "menu" at all. This test fails the build when the two drift.
 *
 * The single source of truth for "what tools exist?" is the set of
 * `server.registerTool('<name>', ...)` calls — we scrape those and
 * compare against the exported menu string.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXPECTED_TOOL_MENU } from '../../packages/mcp-server/src/tools/get-my-agent.ts';

const TOOLS_DIR = fileURLToPath(new URL('../../packages/mcp-server/src/tools/', import.meta.url));

/**
 * Grep-scrape registered tool names out of every `src/tools/*.ts` file.
 * The pattern `server.registerTool('<name>'` is unambiguous enough that
 * a regex is less brittle than any AST-walking alternative.
 */
function collectRegisteredTools(): Set<string> {
  const found = new Set<string>();
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const src = readFileSync(join(TOOLS_DIR, f), 'utf8');
    // Matches: server.registerTool(\n    'tool_name',
    const re = /server\.registerTool\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      found.add(m[1]);
    }
  }
  return found;
}

/** Parse tool names out of the grouped TOOL_MENU string. */
function collectMenuTools(menu: string): Set<string> {
  const found = new Set<string>();
  // Each group is `<Label>: tool1 · tool2 · tool3`. Tool names are
  // lowercase underscore-separated ids; split on the word boundary.
  const re = /\b([a-z][a-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  // Skip group labels — label tokens end with `:` in the menu so we
  // strip anything preceding a `:` on each line.
  const lines = menu.split('\n');
  for (const line of lines) {
    const afterColon = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    while ((m = re.exec(afterColon)) !== null) {
      found.add(m[1]);
    }
    re.lastIndex = 0;
  }
  // Remove non-tool tokens that happen to look like tool names.
  // The menu header ("Available Tools") and group labels are filtered
  // by the colon-slice above, but defensively drop common words.
  const denylist = ['available', 'tools'];
  for (const d of denylist) found.delete(d);
  return found;
}

describe('get_my_agent TOOL_MENU', () => {
  const registered = collectRegisteredTools();
  const menu = collectMenuTools(EXPECTED_TOOL_MENU);

  it('includes every registered tool', () => {
    const missing = [...registered].filter((t) => !menu.has(t)).sort();
    expect(missing, `Tools missing from TOOL_MENU: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not reference tools that are not registered', () => {
    const extra = [...menu].filter((t) => !registered.has(t)).sort();
    expect(extra, `TOOL_MENU references non-existent tools: ${extra.join(', ')}`).toEqual([]);
  });

  it('detects at least 20 registered tools (sanity)', () => {
    // Floor check: if the regex breaks and finds nothing, the "missing"
    // test above trivially passes (empty set ⊆ anything). This guard
    // ensures the scraper is actually finding tools.
    expect(registered.size).toBeGreaterThanOrEqual(20);
  });
});
