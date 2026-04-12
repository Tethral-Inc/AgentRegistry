import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

async function resolveId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('acr_') || nameOrId.startsWith('pseudo_')) return nameOrId;
  const res = await fetch(`${getApiUrl()}/api/v1/agent/${encodeURIComponent(nameOrId)}`);
  if (!res.ok) throw new Error(`Agent "${nameOrId}" not found`);
  return ((await res.json()) as { agent_id: string }).agent_id;
}

export function getStableCorridorsTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_stable_corridors',
    {
      description: 'Stable corridors: interaction paths that are consistently reliable — zero failures, low latency variance, sufficient sample count. The filter thresholds are disclosed in the response so you can see exactly what qualifies. Useful for identifying which targets you can rely on.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'week', 'month']).optional().default('week').describe('Time window'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id, agent_name, scope }) => {
      let id: string;
      try {
        id = agent_name ? await resolveId(agent_name) : (agent_id || getAgentId() || await ensureRegistered());
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/stable-corridors?scope=${scope}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Stable corridors error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        const displayName = agent_name || getAgentName() || id;

        const matches = data.matches as Array<Record<string, unknown>> ?? [];
        const filter = data.filter_applied as Record<string, unknown>;

        let text = `Stable Corridors for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;

        if (filter) {
          text += `\n-- Filter Applied --\n`;
          for (const [key, value] of Object.entries(filter)) {
            text += `  ${key}: ${value}\n`;
          }
        }

        text += `\n-- Matches (${data.match_count ?? matches.length}) --\n`;

        if (matches.length === 0) {
          text += `  No stable corridors found for this period. This means no targets met all filter criteria (zero failures, low variance, sufficient samples).\n`;
        } else {
          for (const m of matches) {
            text += `\n  ${m.target_system_id}\n`;
            text += `    receipts: ${m.receipt_count} | median: ${m.median_duration_ms}ms | p95: ${m.p95_duration_ms}ms\n`;
            text += `    cv: ${typeof m.coefficient_of_variation === 'number' ? (m.coefficient_of_variation as number).toFixed(3) : 'N/A'}\n`;
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Stable corridors error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
