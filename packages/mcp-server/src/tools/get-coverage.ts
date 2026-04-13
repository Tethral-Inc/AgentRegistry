import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl , getAuthHeaders } from '../state.js';

async function resolveId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('acr_') || nameOrId.startsWith('pseudo_')) return nameOrId;
  const res = await fetch(`${getApiUrl()}/api/v1/agent/${encodeURIComponent(nameOrId)}`);
  if (!res.ok) throw new Error(`Agent "${nameOrId}" not found`);
  return ((await res.json()) as { agent_id: string }).agent_id;
}

export function getCoverageTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_coverage',
    {
      description: 'Signal coverage: which fields you populate on your receipts and which you don\'t. Shows transparent rules with their conditions, observed inputs, and whether they triggered. Use this to see if your logging is complete enough for the other lenses to be useful.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      try {
        id = agent_name ? await resolveId(agent_name) : (agent_id || getAgentId() || await ensureRegistered());
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/coverage`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Coverage error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        const displayName = agent_name || getAgentName() || id;

        const signals = data.signals as Record<string, number>;
        const rules = data.rules as Array<{ signal: string; rule: string; observed: Record<string, number>; triggered: boolean }>;

        let text = `Coverage Report for ${displayName}\n${'='.repeat(30)}\n`;

        text += `\n-- Signal Counts --\n`;
        for (const [key, value] of Object.entries(signals)) {
          text += `  ${key}: ${value}\n`;
        }

        if (rules && rules.length > 0) {
          const triggered = rules.filter((r) => r.triggered);
          const ok = rules.filter((r) => !r.triggered);

          if (triggered.length > 0) {
            text += `\n-- Coverage Gaps (${triggered.length}) --\n`;
            for (const r of triggered) {
              text += `  ${r.signal}: ${r.rule}\n`;
              text += `    observed: ${JSON.stringify(r.observed)}\n`;
            }
          }

          if (ok.length > 0) {
            text += `\n-- Covered (${ok.length}) --\n`;
            for (const r of ok) {
              text += `  ${r.signal}: ${r.rule} — OK\n`;
            }
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Coverage error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
