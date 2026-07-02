/**
 * Composition → bound-target extraction.
 *
 * Reads an agent's composition record (either of the two sources stored in
 * agent_composition_sources) and returns a Set of candidate target_system_id
 * strings the agent has declared it depends on. The revealed-preference lens
 * set-intersects this with the set of targets the agent has actually called
 * in a window; the delta is the revealed-preference signal.
 *
 * Matching is fuzzy by design: composition authors do not consistently
 * prefix names with the target type. For flat fields we infer the type from
 * the field name (mcps → mcp:, skills → skill:, etc.). For nested
 * components we include both the `name` (human-readable) and `id`
 * (often-but-not-always a hash) as candidate strings, prefixed where we
 * can guess the type. The caller treats the returned Set as a bag of
 * acceptable match candidates for each binding.
 *
 * Note: `tools` in the flat composition usually refers to tools exposed
 * *inside* an MCP server, so we prefix them with `mcp:`. But the same field
 * also carries Claude Code *built-in* tool names (Bash, Read, Task, …), and
 * those are emitted on receipts as `platform:bash` / `agent:subagent` / etc.,
 * NOT `mcp:bash`. We resolve known built-ins to their canonical receipt id
 * via the shared BUILTIN_TOOL_TARGETS table so declared-vs-called can match.
 *
 * Every candidate is run through normalizeSystemId so the declared side uses
 * the same vocabulary as the called side (receipts are normalized on write).
 * Without this, casing ("Bash" vs "bash") and prefix drift make every
 * comparison miss — the "67 bound / 0 called" failure.
 */

import { normalizeSystemId, canonicalTargetForBuiltinTool } from '@acr/shared';

const TARGET_PATTERN = /^(mcp|api|agent|skill|platform):/;

interface Component {
  id?: string;
  name?: string;
}

interface Composition {
  mcps?: string[];
  tools?: string[];
  skills?: string[];
  skill_hashes?: string[];
  skill_components?: Component[];
  mcp_components?: Component[];
  api_components?: Component[];
  tool_components?: Component[];
}

function addCandidate(set: Set<string>, inferredType: string, raw: string | undefined | null): void {
  if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  const typed = TARGET_PATTERN.test(trimmed) ? trimmed : `${inferredType}:${trimmed}`;
  // Normalize so the declared side uses the same vocabulary as receipts
  // (which are normalized on write). Lowercases + applies the seed alias map.
  set.add(normalizeSystemId(typed));
  // Keep the bare name (normalized) as a loose match helper.
  set.add(normalizeSystemId(trimmed));
}

/**
 * Add a candidate from a `tools` / `tool_components` entry. Built-in Claude
 * Code tools resolve to their canonical receipt id (platform:* / agent:*);
 * everything else is treated as an MCP-hosted tool (mcp:*).
 */
function addToolCandidate(set: Set<string>, raw: string | undefined | null): void {
  if (!raw) return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  const builtin = canonicalTargetForBuiltinTool(trimmed);
  if (builtin) {
    set.add(normalizeSystemId(builtin));
    set.add(normalizeSystemId(trimmed));
    return;
  }
  addCandidate(set, 'mcp', trimmed);
}

export function extractBoundTargets(composition: unknown): Set<string> {
  const out = new Set<string>();
  if (!composition || typeof composition !== 'object') return out;
  const c = composition as Composition;

  for (const s of c.mcps ?? []) addCandidate(out, 'mcp', s);
  for (const s of c.tools ?? []) addToolCandidate(out, s);
  for (const s of c.skills ?? []) addCandidate(out, 'skill', s);

  for (const comp of c.mcp_components ?? []) {
    addCandidate(out, 'mcp', comp?.name);
    addCandidate(out, 'mcp', comp?.id);
  }
  for (const comp of c.api_components ?? []) {
    addCandidate(out, 'api', comp?.name);
    addCandidate(out, 'api', comp?.id);
  }
  for (const comp of c.skill_components ?? []) {
    addCandidate(out, 'skill', comp?.name);
    addCandidate(out, 'skill', comp?.id);
  }
  for (const comp of c.tool_components ?? []) {
    addToolCandidate(out, comp?.name);
    addToolCandidate(out, comp?.id);
  }

  return out;
}
