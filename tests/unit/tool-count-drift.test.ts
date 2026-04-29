/**
 * CI guard — the tool count claimed in three places must agree.
 *
 * Why: the audit found three independent representations of "how many
 * tools does this MCP have?" — package.json description ("29 tools"),
 * README header ("## Tools (25)"), and the actual count of files in
 * src/tools/. They drifted independently across the v2.7.0 rename
 * and v2.11.0 deletion, leaving a published package whose own front
 * page lied. This test makes that drift fail the build.
 *
 * The single source of truth is the count of registered tools — same
 * scrape technique tool-menu.test.ts uses.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = fileURLToPath(new URL('../../packages/mcp-server/src/tools/', import.meta.url));
const README_PATH = fileURLToPath(new URL('../../packages/mcp-server/README.md', import.meta.url));
const PKG_PATH = fileURLToPath(new URL('../../packages/mcp-server/package.json', import.meta.url));

function countRegisteredTools(): number {
  const tools = new Set<string>();
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const src = readFileSync(join(TOOLS_DIR, f), 'utf8');
    const re = /server\.registerTool\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      tools.add(m[1]!);
    }
  }
  return tools.size;
}

describe('tool count drift guard', () => {
  const actual = countRegisteredTools();

  it('detects at least 20 tools (scraper sanity)', () => {
    expect(actual).toBeGreaterThanOrEqual(20);
  });

  it('package.json description matches actual tool count', () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { description: string };
    // Match "N tools" / "N+ tools" anywhere in the description.
    const m = pkg.description.match(/(\d+)\s+tools\b/i);
    expect(m, `package.json description must mention "<N> tools" (current: ${pkg.description})`).not.toBeNull();
    const claimed = parseInt(m![1]!, 10);
    expect(claimed, `package.json claims ${claimed} tools, actual is ${actual}`).toBe(actual);
  });

  it('README "## Tools (N)" header matches actual tool count', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    // Match "## Tools (N)" — the canonical section header.
    const m = readme.match(/^##\s+Tools\s*\((\d+)\)/m);
    expect(m, 'README must have a "## Tools (N)" header').not.toBeNull();
    const claimed = parseInt(m![1]!, 10);
    expect(claimed, `README claims ${claimed} tools, actual is ${actual}`).toBe(actual);
  });

  it('README tool-table rows match the registered tool set', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    // README tool tables use markdown rows like:
    //   | `tool_name` | description |
    // We pull every backticked id from inside table rows and assert
    // the set matches what's registered. Drift here was the
    // proximate cause of v2.11.0's missing `set_watch`/`list_watches`
    // entries.
    const tableRows = readme.match(/^\|\s+`([a-z_][a-z0-9_]*)`\s+\|/gm) ?? [];
    const documented = new Set<string>();
    for (const row of tableRows) {
      const m = row.match(/`([a-z_][a-z0-9_]*)`/);
      if (m) documented.add(m[1]!);
    }
    // Pull the registered set the same way as the count test.
    const registered = new Set<string>();
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const src = readFileSync(join(TOOLS_DIR, f), 'utf8');
      const re = /server\.registerTool\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        registered.add(m[1]!);
      }
    }
    const missing = [...registered].filter((t) => !documented.has(t)).sort();
    const extra = [...documented].filter((t) => !registered.has(t)).sort();
    expect(missing, `README tool tables missing: ${missing.join(', ')}`).toEqual([]);
    expect(extra, `README tool tables reference non-existent: ${extra.join(', ')}`).toEqual([]);
  });
});
