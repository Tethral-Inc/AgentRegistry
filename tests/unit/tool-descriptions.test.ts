/**
 * CI guard — tool descriptions must be non-empty, reasonably detailed,
 * and free of references to tools that no longer exist.
 *
 * Why: descriptions are the first signal the host LLM sees. A stub
 * description ("TODO", "blah") or a description that references a
 * removed tool (e.g. `get_failure_trend` was renamed to `get_trend`)
 * turns the tool surface into a liar — the agent reads the menu, picks
 * a tool that doesn't exist, and hits InputValidationError or worse.
 *
 * We scan the source of every `src/tools/*.ts` file and pull out each
 * `registerTool('<name>', { description: '...', ... })` pair by regex —
 * the same scrape technique `tool-menu.test.ts` uses. Descriptions
 * shorter than the floor, containing placeholder text, or referencing
 * a name not in the registered set, fail the build.
 *
 * The floor is 40 chars — a number picked by looking at the shortest
 * real description today and dropping a bit below it so future edits
 * don't have to update the floor every time. If you legitimately need
 * a 20-char description, raise the floor on real data, don't special-
 * case this file.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = fileURLToPath(new URL('../../packages/mcp-server/src/tools/', import.meta.url));

const MIN_DESCRIPTION_LENGTH = 40;

/**
 * Placeholder / stub text that should never make it into a released
 * description. Match is case-insensitive and only against whole words
 * — we don't want to flag the substring `todo` inside `todoList`.
 */
const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|TBD|placeholder|lorem ipsum)\b/i;

type ToolDef = { name: string; description: string; file: string };

/**
 * Scrape each tool's `name` and `description` out of the tool files.
 * Tolerates concatenation (`description: 'Foo.' + DATA_NOTICE`) by
 * resolving the concat expression only when it references an
 * all-caps const defined at module scope in the same file. Anything
 * more dynamic than that falls through as "empty" and the floor test
 * catches it.
 */
function collectToolDefs(): ToolDef[] {
  const defs: ToolDef[] = [];
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));

  for (const file of files) {
    const src = readFileSync(join(TOOLS_DIR, file), 'utf8');

    // Build a map of SCREAMING_SNAKE_CASE module consts → their string
    // value, so description-concatenation against a const can be
    // resolved. Handles single-line string consts AND multi-line
    // template literals without ${} substitutions — the latter are
    // how large descriptions are authored (see get-revealed-preference.ts).
    const constMap = new Map<string, string>();
    const constRe = /^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`])((?:\\.|(?!\2)[\s\S])*)\2\s*;?$/gm;
    let cm: RegExpExecArray | null;
    while ((cm = constRe.exec(src)) !== null) {
      const value = cm[3]!;
      // Multi-line template literals with ${} substitutions are
      // dynamic — skip them. The floor test will fail on the tool
      // that uses them, which is the correct behavior.
      if (cm[2] === '`' && value.includes('${')) continue;
      constMap.set(cm[1]!, value);
    }

    // Match: server.registerTool('name', { description: '...', ... }
    // We allow the description value to span concatenation like
    // `'foo' + DATA_NOTICE`. The regex captures the raw value
    // expression up to the first `,` at the same brace depth.
    const toolRe = /server\.registerTool\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*,\s*\{([\s\S]*?)\n\s*\}\s*,/g;
    let tm: RegExpExecArray | null;
    while ((tm = toolRe.exec(src)) !== null) {
      const name = tm[1]!;
      const body = tm[2]!;
      // Pull out the description property. Descriptions can be a
      // literal or a concatenation; capture everything up to the
      // next top-level property or end of object.
      const descMatch = body.match(/description:\s*([\s\S]*?),\s*\n\s*(?:inputSchema|annotations|_meta|title|inputSchema)/);
      const raw = descMatch ? descMatch[1]!.trim() : '';
      defs.push({ name, description: resolveDescription(raw, constMap), file });
    }
  }

  return defs;
}

/**
 * Resolve a description expression to its runtime string value.
 * Handles:
 *   - string literals
 *   - template literals with no ${} substitutions
 *   - concatenation chains of the above and SCREAMING_SNAKE_CASE consts
 *     defined at module scope in the same file
 * Anything else returns the original expression (so the test sees
 * something non-empty) — the real value check on that tool is the
 * PLACEHOLDER_RE + MIN_DESCRIPTION_LENGTH checks.
 */
function resolveDescription(expr: string, constMap: Map<string, string>): string {
  if (!expr) return '';
  const parts = expr.split('+').map((p) => p.trim());
  let out = '';
  for (const p of parts) {
    // String literal or template literal without substitutions.
    const lit = p.match(/^(['"`])((?:\\.|(?!\1).)*)\1$/);
    if (lit) {
      if (lit[1] === '`' && lit[2]!.includes('${')) return expr; // dynamic
      out += lit[2]!;
      continue;
    }
    // Reference to a module-level const.
    if (/^[A-Z_][A-Z0-9_]*$/.test(p) && constMap.has(p)) {
      out += constMap.get(p)!;
      continue;
    }
    // Unknown expression — bail and return the raw input.
    return expr;
  }
  return out;
}

describe('tool descriptions', () => {
  const defs = collectToolDefs();

  it('detects every registered tool (sanity floor)', () => {
    // If the regex breaks and finds nothing, every subsequent test
    // trivially passes. This guard ensures the scraper is doing its job.
    expect(defs.length).toBeGreaterThanOrEqual(20);
  });

  it('every tool has a description', () => {
    const missing = defs.filter((d) => !d.description).map((d) => `${d.file}:${d.name}`);
    expect(missing, `Tools missing description: ${missing.join(', ')}`).toEqual([]);
  });

  it(`every tool description is at least ${MIN_DESCRIPTION_LENGTH} chars`, () => {
    const tooShort = defs
      .filter((d) => d.description.length < MIN_DESCRIPTION_LENGTH)
      .map((d) => `${d.file}:${d.name} (${d.description.length} chars: "${d.description}")`);
    expect(tooShort, `Descriptions too short:\n  ${tooShort.join('\n  ')}`).toEqual([]);
  });

  it('no description contains placeholder text', () => {
    const placeholders = defs
      .filter((d) => PLACEHOLDER_RE.test(d.description))
      .map((d) => `${d.file}:${d.name} — "${d.description}"`);
    expect(placeholders, `Descriptions with placeholders:\n  ${placeholders.join('\n  ')}`).toEqual([]);
  });

  it('no description references a tool that is not registered', () => {
    const registered = new Set(defs.map((d) => d.name));
    // Tool names in ACR always start with one of a small set of verb
    // prefixes (`get_`, `log_`, `check_`, `register_`, etc.). By
    // scoping the reference-detection to tokens starting with those
    // prefixes, we avoid the sea of false positives from field names
    // (`chain_position`), classification labels (`bound_uncalled`),
    // and provider values (`agent_reported`) — none of which start
    // with a verb.
    //
    // Derive the prefix set from the registered tool names themselves
    // so adding a new verb class (e.g. a future `analyze_*`) doesn't
    // require updating this test.
    const verbPrefixes = new Set<string>();
    for (const name of registered) {
      const firstUnderscore = name.indexOf('_');
      if (firstUnderscore > 0) verbPrefixes.add(name.slice(0, firstUnderscore));
    }
    const prefixAlternation = [...verbPrefixes].join('|');
    const toolShapedRe = new RegExp(`\\b((?:${prefixAlternation})_[a-z][a-z0-9_]*)\\b`, 'g');

    const stale: string[] = [];
    for (const d of defs) {
      let m: RegExpExecArray | null;
      while ((m = toolShapedRe.exec(d.description)) !== null) {
        const tok = m[1]!;
        if (registered.has(tok)) continue;
        stale.push(`${d.file}:${d.name} references "${tok}" (tool-shaped but not registered)`);
      }
      toolShapedRe.lastIndex = 0;
    }
    expect(stale, `Stale tool references in descriptions:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
