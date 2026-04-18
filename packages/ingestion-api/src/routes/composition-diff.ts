import { Hono } from 'hono';
import { query, createLogger, normalizeSystemId, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'composition-diff' });
const app = new Hono();

/**
 * GET /agent/{id}/composition-diff — declared-vs-actual composition.
 *
 * Compares the agent's declared composition (from register_agent /
 * update_composition, stored in agent_composition_sources) against the
 * targets the agent is actually interacting with (from interaction_receipts
 * over a configurable window, default 7d).
 *
 * Three categories returned:
 *   - declared_and_used      : declared components observed in receipts
 *   - declared_but_unused    : declared components that never show up
 *   - used_but_undeclared    : targets hit in receipts with no matching
 *                              declaration (likely a gap in update_composition)
 *
 * This is the "what you said you'd use vs what you actually use" lens.
 * It's a pure join of existing tables — no new signals required, cheap to
 * compute. The intended use is driving the next update_composition call
 * and spotting shadow dependencies.
 *
 * Query param: `window_days` (default 7, max 30).
 */

type DeclaredComponent = {
  kind: 'mcp' | 'api' | 'skill' | 'tool';
  id: string;
  name?: string;
  /** Normalized system_id this declaration is expected to produce receipts as. */
  expected_target: string;
};

/**
 * Map a declared composition object (as stored in agent_composition_sources)
 * into the canonical `{type}:{name}` IDs receipts use. Supports both the
 * legacy flat fields (mcps, tools, skills, skill_hashes) and the newer
 * structured component arrays (skill_components, mcp_components,
 * api_components, tool_components).
 */
function declaredComponentsFromComposition(composition: Record<string, unknown>): DeclaredComponent[] {
  const out: DeclaredComponent[] = [];

  const pushIfNew = (comp: DeclaredComponent) => {
    if (!out.some((c) => c.expected_target === comp.expected_target)) {
      out.push(comp);
    }
  };

  // --- Legacy flat fields ---
  const mcps = composition.mcps;
  if (Array.isArray(mcps)) {
    for (const m of mcps) {
      if (typeof m !== 'string' || !m) continue;
      pushIfNew({
        kind: 'mcp',
        id: m,
        name: m,
        expected_target: normalizeSystemId(`mcp:${m}`),
      });
    }
  }

  const tools = composition.tools;
  if (Array.isArray(tools)) {
    for (const t of tools) {
      if (typeof t !== 'string' || !t) continue;
      // tools are usually exposed under an MCP namespace (`mcp:github/list_repos`)
      // but receipts typically log the MCP, not the tool. Store them as
      // `tool:` for now — most won't match a target, which is OK.
      pushIfNew({
        kind: 'tool',
        id: t,
        name: t,
        expected_target: normalizeSystemId(`tool:${t}`),
      });
    }
  }

  const skills = composition.skills;
  if (Array.isArray(skills)) {
    for (const s of skills) {
      if (typeof s !== 'string' || !s) continue;
      pushIfNew({
        kind: 'skill',
        id: s,
        name: s,
        expected_target: normalizeSystemId(`skill:${s}`),
      });
    }
  }

  const skillHashes = composition.skill_hashes;
  if (Array.isArray(skillHashes)) {
    for (const h of skillHashes) {
      if (typeof h !== 'string' || !h) continue;
      pushIfNew({
        kind: 'skill',
        id: h,
        expected_target: normalizeSystemId(`skill:${h}`),
      });
    }
  }

  // --- Structured component arrays ---
  const pushComponents = (arr: unknown, kind: DeclaredComponent['kind']) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (!c || typeof c !== 'object') continue;
      const obj = c as Record<string, unknown>;
      const id = typeof obj.id === 'string' ? obj.id : null;
      const name = typeof obj.name === 'string' ? obj.name : undefined;
      if (!id) continue;
      // Prefer `name` for the target (MCPs are usually referenced by human
      // name in receipts); fall back to id.
      const targetKey = name ?? id;
      pushIfNew({
        kind,
        id,
        name,
        expected_target: normalizeSystemId(`${kind}:${targetKey}`),
      });
    }
  };

  pushComponents(composition.mcp_components, 'mcp');
  pushComponents(composition.api_components, 'api');
  pushComponents(composition.skill_components, 'skill');
  pushComponents(composition.tool_components, 'tool');

  return out;
}

app.get('/agent/:agent_id/composition-diff', async (c) => {
  const identifier = c.req.param('agent_id');
  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;

  const windowParam = c.req.query('window_days');
  let windowDays = 7;
  if (windowParam) {
    const n = Number.parseInt(windowParam, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return c.json(makeError('INVALID_INPUT', 'window_days must be a positive integer'), 400);
    }
    windowDays = Math.min(n, 30);
  }

  // Load declared composition — prefer agent_reported, fall back to mcp_observed.
  const declaredRows = await query<{
    source: string;
    composition: string | Record<string, unknown>;
    updated_at: string;
  }>(
    `SELECT source AS "source",
            composition AS "composition",
            updated_at::text AS "updated_at"
     FROM agent_composition_sources
     WHERE agent_id = $1
     ORDER BY (source = 'agent_reported') DESC, updated_at DESC
     LIMIT 1`,
    [agentId],
  ).catch((err) => {
    log.warn({ err, agentId }, 'composition-diff: declared-composition load failed');
    return [] as Array<{ source: string; composition: string | Record<string, unknown>; updated_at: string }>;
  });

  let declaredComposition: Record<string, unknown> = {};
  let declaredSource: string | null = null;
  let declaredUpdatedAt: string | null = null;
  if (declaredRows.length > 0) {
    const row = declaredRows[0];
    declaredSource = row.source;
    declaredUpdatedAt = row.updated_at;
    if (typeof row.composition === 'string') {
      try {
        declaredComposition = JSON.parse(row.composition) as Record<string, unknown>;
      } catch {
        declaredComposition = {};
      }
    } else if (row.composition && typeof row.composition === 'object') {
      declaredComposition = row.composition as Record<string, unknown>;
    }
  }

  const declared = declaredComponentsFromComposition(declaredComposition);
  const declaredIndex = new Map<string, DeclaredComponent>();
  for (const d of declared) declaredIndex.set(d.expected_target, d);

  // Load actual targets from receipts in the window.
  const actualRows = await query<{
    target_system_id: string;
    target_system_type: string;
    interaction_count: number;
    last_seen: string;
  }>(
    `SELECT target_system_id AS "target_system_id",
            target_system_type AS "target_system_type",
            COUNT(*)::int AS "interaction_count",
            MAX(request_timestamp_ms)::text AS "last_seen"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND request_timestamp_ms >= $2
     GROUP BY target_system_id, target_system_type
     ORDER BY COUNT(*) DESC`,
    [agentId, Date.now() - windowDays * 86400000],
  ).catch((err) => {
    log.warn({ err, agentId }, 'composition-diff: receipts load failed');
    return [] as Array<{ target_system_id: string; target_system_type: string; interaction_count: number; last_seen: string }>;
  });

  const actualIndex = new Map<string, { target_system_id: string; target_system_type: string; interaction_count: number; last_seen: string }>();
  for (const r of actualRows) actualIndex.set(r.target_system_id, r);

  // Classify.
  const declared_and_used: Array<{ kind: string; id: string; name?: string; target: string; interaction_count: number }> = [];
  const declared_but_unused: Array<{ kind: string; id: string; name?: string; target: string }> = [];
  for (const d of declared) {
    const hit = actualIndex.get(d.expected_target);
    if (hit) {
      declared_and_used.push({
        kind: d.kind,
        id: d.id,
        name: d.name,
        target: d.expected_target,
        interaction_count: hit.interaction_count,
      });
    } else {
      declared_but_unused.push({ kind: d.kind, id: d.id, name: d.name, target: d.expected_target });
    }
  }

  const used_but_undeclared: Array<{ target: string; target_type: string; interaction_count: number }> = [];
  for (const r of actualRows) {
    if (!declaredIndex.has(r.target_system_id)) {
      used_but_undeclared.push({
        target: r.target_system_id,
        target_type: r.target_system_type,
        interaction_count: r.interaction_count,
      });
    }
  }

  return c.json({
    agent_id: agentId,
    window_days: windowDays,
    declared_source: declaredSource,
    declared_updated_at: declaredUpdatedAt,
    counts: {
      declared_total: declared.length,
      used_total: actualRows.length,
      declared_and_used: declared_and_used.length,
      declared_but_unused: declared_but_unused.length,
      used_but_undeclared: used_but_undeclared.length,
    },
    declared_and_used,
    declared_but_unused,
    used_but_undeclared,
  });
});

export { app as compositionDiffRoute };
