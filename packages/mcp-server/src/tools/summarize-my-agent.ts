import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl, getAuthHeaders } from '../state.js';

async function resolveId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('acr_') || nameOrId.startsWith('pseudo_')) return nameOrId;
  const res = await fetch(`${getApiUrl()}/api/v1/agent/${encodeURIComponent(nameOrId)}`);
  if (!res.ok) throw new Error(`Agent "${nameOrId}" not found`);
  return ((await res.json()) as { agent_id: string }).agent_id;
}

async function fetchJSON(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function summarizeMyAgentTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'summarize_my_agent',
    {
      description: 'Single-read overview of your interaction profile across all available lenses. Fetches profile, friction summary, and coverage in one call. Use this for a quick status check instead of calling each lens individually.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      try {
        id = agent_name ? await resolveId(agent_name) : (agent_id || getAgentId() || await ensureRegistered());
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      // Fetch all three in parallel
      const [profile, friction, coverage] = await Promise.all([
        fetchJSON(`${apiUrl}/api/v1/agent/${id}/profile`),
        fetchJSON(`${apiUrl}/api/v1/agent/${id}/friction?scope=day`),
        fetchJSON(`${apiUrl}/api/v1/agent/${id}/coverage`),
      ]);

      const displayName = (profile?.name as string) || agent_name || getAgentName() || id;

      let text = `Agent Summary: ${displayName}\n${'='.repeat(40)}\n`;

      // Profile section
      if (profile) {
        const c = profile.counts as Record<string, unknown>;
        const comp = profile.composition_summary as Record<string, unknown>;
        text += `\n-- Profile --\n`;
        text += `  ${c.total_receipts} receipts across ${c.distinct_targets} targets over ${c.days_active} day(s)\n`;
        text += `  Last 24h: ${c.receipts_last_24h} receipts\n`;
        text += `  Composition: ${comp?.skill_count ?? 0} skills, ${comp?.mcp_count ?? 0} MCPs, ${comp?.tool_count ?? 0} tools\n`;
      } else {
        text += `\n-- Profile --\n  Not available (agent may not be registered)\n`;
      }

      // Friction section
      if (friction && !friction.error) {
        const s = friction.summary as Record<string, unknown>;
        if (s && (s.total_interactions as number) > 0) {
          text += `\n-- Friction (today) --\n`;
          text += `  ${s.total_interactions} interactions | ${((s.friction_percentage as number) ?? 0).toFixed(1)}% friction\n`;
          text += `  ${s.total_failures} failures (${((s.failure_rate as number) * 100).toFixed(1)}%)\n`;

          const targets = friction.top_targets as Array<Record<string, unknown>>;
          if (targets && targets.length > 0) {
            text += `  Top targets:\n`;
            for (const t of targets.slice(0, 5)) {
              text += `    ${t.target_system_id}: ${t.interaction_count} calls, median ${t.median_duration_ms}ms\n`;
            }
          }
        } else {
          text += `\n-- Friction (today) --\n  No interactions recorded today.\n`;
        }
      } else {
        text += `\n-- Friction (today) --\n  Not available.\n`;
      }

      // Coverage section
      if (coverage && !coverage.error) {
        const rules = coverage.rules as Array<{ signal: string; triggered: boolean }>;
        if (rules) {
          const gaps = rules.filter((r) => r.triggered);
          const covered = rules.filter((r) => !r.triggered);
          text += `\n-- Coverage --\n`;
          text += `  ${covered.length}/${rules.length} signals covered\n`;
          if (gaps.length > 0) {
            text += `  Gaps: ${gaps.map((g) => g.signal).join(', ')}\n`;
          }
        }
      } else {
        text += `\n-- Coverage --\n  Not available.\n`;
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
