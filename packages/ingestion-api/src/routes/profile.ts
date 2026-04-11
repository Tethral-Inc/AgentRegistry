import { Hono } from 'hono';
import { query, queryOne, createLogger, makeError } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'profile' });
const app = new Hono();

/**
 * GET /agent/{id}/profile — Raw interaction profile counts.
 *
 * Returns observed facts about the agent's registered composition and the
 * raw counts that describe its interaction history. No synthetic labels,
 * no derived state, no narrative guidance. Clients are responsible for
 * their own interpretation.
 *
 * Free tier. Available to any registered agent.
 */

app.get('/agent/:agent_id/profile', async (c) => {
  const identifier = c.req.param('agent_id');
  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  // Agent registration data — provider, transport, dates.
  const agent = await queryOne<{
    agent_id: string;
    name: string | null;
    provider_class: string | null;
    composition_hash: string | null;
    operational_domain: string | null;
    created_at: string;
    last_active_at: string;
  }>(
    `SELECT agent_id AS "agent_id",
            name AS "name",
            provider_class AS "provider_class",
            composition_hash AS "composition_hash",
            operational_domain AS "operational_domain",
            created_at::text AS "created_at",
            last_active_at::text AS "last_active_at"
     FROM agents WHERE agent_id = $1 LIMIT 1`,
    [agentId],
  ).catch(() => null);

  if (!agent) {
    return c.json(makeError('NOT_FOUND', `Agent ${identifier} not found in the network`), 404);
  }

  // Aggregate counts across the agent's full lifetime + 24h slice.
  const totals = await query<{
    total_receipts: number;
    distinct_targets: number;
    distinct_categories: number;
    distinct_chains: number;
    receipts_24h: number;
    days_active: number;
    first_seen: string | null;
    last_seen: string | null;
  }>(
    `SELECT
       COUNT(*)::int AS "total_receipts",
       COUNT(DISTINCT target_system_id)::int AS "distinct_targets",
       COUNT(DISTINCT interaction_category)::int AS "distinct_categories",
       COUNT(DISTINCT chain_id) FILTER (WHERE chain_id IS NOT NULL)::int AS "distinct_chains",
       COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '24 hours')::int AS "receipts_24h",
       COUNT(DISTINCT DATE(created_at))::int AS "days_active",
       MIN(created_at)::text AS "first_seen",
       MAX(created_at)::text AS "last_seen"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1`,
    [agentId],
  ).catch(() => []);

  const t = totals[0] ?? {
    total_receipts: 0,
    distinct_targets: 0,
    distinct_categories: 0,
    distinct_chains: 0,
    receipts_24h: 0,
    days_active: 0,
    first_seen: null as string | null,
    last_seen: null as string | null,
  };

  // Composition view — what skills / mcps / tools are tracked for this agent.
  const composition = await queryOne<{
    skill_count: number;
    mcp_count: number;
    tool_count: number;
  }>(
    `SELECT
       COALESCE(jsonb_array_length(composition->'skills'), 0)::int AS "skill_count",
       COALESCE(jsonb_array_length(composition->'mcps'), 0)::int AS "mcp_count",
       COALESCE(jsonb_array_length(composition->'tools'), 0)::int AS "tool_count"
     FROM agents WHERE agent_id = $1 LIMIT 1`,
    [agentId],
  ).catch(() => null);

  // Composition delta: compare what the MCP observed vs what the agent
  // self-reported. The comparison itself is a signal. Only surfaced when
  // both sources are present.
  const sourceRows = await query<{
    source: string;
    composition: string;
    updated_at: string;
  }>(
    `SELECT source AS "source",
            composition::text AS "composition",
            updated_at::text AS "updated_at"
     FROM agent_composition_sources
     WHERE agent_id = $1`,
    [agentId],
  ).catch(() => []);

  let compositionDelta: {
    mcp_only: string[];
    agent_only: string[];
    last_observed_at: string | null;
    last_reported_at: string | null;
  } | null = null;

  if (sourceRows.length === 2) {
    const mcpRow = sourceRows.find((r) => r.source === 'mcp_observed');
    const agentRow = sourceRows.find((r) => r.source === 'agent_reported');
    if (mcpRow && agentRow) {
      try {
        const mcpComp = JSON.parse(mcpRow.composition) as Record<string, unknown>;
        const agentComp = JSON.parse(agentRow.composition) as Record<string, unknown>;

        // Build a flat set of component ids from each source. The flat
        // legacy fields (skills, mcps, tools, skill_hashes) are strings.
        // The richer *_components fields are arrays of objects with ids.
        const flattenIds = (comp: Record<string, unknown>): Set<string> => {
          const ids = new Set<string>();
          for (const key of ['skills', 'mcps', 'tools', 'skill_hashes']) {
            const arr = comp[key];
            if (Array.isArray(arr)) {
              for (const v of arr) if (typeof v === 'string') ids.add(v);
            }
          }
          for (const key of ['skill_components', 'mcp_components', 'api_components', 'tool_components']) {
            const arr = comp[key];
            if (Array.isArray(arr)) {
              for (const v of arr) {
                if (v && typeof v === 'object' && 'id' in v) {
                  ids.add(String((v as { id: unknown }).id));
                }
              }
            }
          }
          return ids;
        };

        const mcpIds = flattenIds(mcpComp);
        const agentIds = flattenIds(agentComp);
        const mcpOnly = [...mcpIds].filter((id) => !agentIds.has(id));
        const agentOnly = [...agentIds].filter((id) => !mcpIds.has(id));

        compositionDelta = {
          mcp_only: mcpOnly,
          agent_only: agentOnly,
          last_observed_at: mcpRow.updated_at,
          last_reported_at: agentRow.updated_at,
        };
      } catch (err) {
        // Parse failure is non-fatal; just omit the delta
        log.warn({ err, agentId }, 'Failed to compute composition delta');
      }
    }
  }

  c.header('Cache-Control', 'private, max-age=30');

  return c.json({
    agent_id: agent.agent_id,
    name: agent.name ?? agentName,
    provider_class: agent.provider_class,
    operational_domain: agent.operational_domain,
    composition_hash: agent.composition_hash,
    composition_summary: composition ?? { skill_count: 0, mcp_count: 0, tool_count: 0 },
    registered_at: agent.created_at,
    last_active_at: agent.last_active_at,
    counts: {
      total_receipts: t.total_receipts,
      receipts_last_24h: t.receipts_24h,
      distinct_targets: t.distinct_targets,
      distinct_categories: t.distinct_categories,
      distinct_chains: t.distinct_chains,
      days_active: t.days_active,
      first_signal_at: t.first_seen,
      last_signal_at: t.last_seen,
    },
    composition_delta: compositionDelta,
    tier: 'free',
  });
});

export { app as profileRoute };
