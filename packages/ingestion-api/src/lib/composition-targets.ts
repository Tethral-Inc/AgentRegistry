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
 * Note: `tools` in the flat composition typically refers to tools exposed
 * *inside* an MCP server, so we prefix them with `mcp:` — that's how they
 * appear as target_system_id values in receipts.
 */

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
  if (TARGET_PATTERN.test(trimmed)) {
    set.add(trimmed);
  } else {
    set.add(`${inferredType}:${trimmed}`);
  }
  set.add(trimmed);
}

export function extractBoundTargets(composition: unknown): Set<string> {
  const out = new Set<string>();
  if (!composition || typeof composition !== 'object') return out;
  const c = composition as Composition;

  for (const s of c.mcps ?? []) addCandidate(out, 'mcp', s);
  for (const s of c.tools ?? []) addCandidate(out, 'mcp', s);
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
    addCandidate(out, 'mcp', comp?.name);
    addCandidate(out, 'mcp', comp?.id);
  }

  return out;
}
