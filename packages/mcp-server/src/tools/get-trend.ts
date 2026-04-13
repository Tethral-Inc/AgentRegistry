import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl , getAuthHeaders } from '../state.js';

async function resolveId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('acr_') || nameOrId.startsWith('pseudo_')) return nameOrId;
  const res = await fetch(`${getApiUrl()}/api/v1/agent/${encodeURIComponent(nameOrId)}`);
  if (!res.ok) throw new Error(`Agent "${nameOrId}" not found`);
  return ((await res.json()) as { agent_id: string }).agent_id;
}

export function getTrendTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_trend',
    {
      description: 'Trend: per-target latency and failure rate changes over time. Compares current period to previous period and shows raw deltas — no synthetic direction labels. You see the numbers and decide what matters.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'week']).optional().default('day').describe('Time window (compares current to previous)'),
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
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/trend?scope=${scope}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Trend error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        const displayName = (data.name as string) || agent_name || getAgentName() || id;

        const targets = data.per_target as Array<Record<string, unknown>> ?? [];
        const rules = data.inclusion_rules as Record<string, unknown>;

        let text = `Trend for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Current: ${data.current_period}\n`;
        text += `Previous: ${data.comparison_period}\n`;

        if (rules) {
          text += `Inclusion: ${rules.target_included_if}\n`;
        }

        if (targets.length === 0) {
          text += `\nNo targets with data in both periods.\n`;
        } else {
          for (const t of targets) {
            const curr = t.current as Record<string, unknown>;
            const prev = t.previous as Record<string, unknown> | null;

            text += `\n  ${t.target}\n`;
            text += `    current:  median ${curr.median_duration_ms}ms | failure ${((curr.failure_rate as number) * 100).toFixed(1)}% | ${curr.receipt_count} receipts\n`;

            if (prev) {
              text += `    previous: median ${prev.median_duration_ms}ms | failure ${((prev.failure_rate as number) * 100).toFixed(1)}% | ${prev.receipt_count} receipts\n`;
              if (t.latency_change_ratio != null) {
                text += `    latency delta: ${((t.latency_change_ratio as number) * 100).toFixed(1)}%\n`;
              }
              if (t.failure_rate_delta != null) {
                text += `    failure rate delta: ${((t.failure_rate_delta as number) * 100).toFixed(1)} pp\n`;
              }
            } else {
              text += `    previous: no data\n`;
            }
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Trend error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
