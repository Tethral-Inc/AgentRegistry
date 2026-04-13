import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl, getApiKey, getAuthHeaders } from '../state.js';

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard-john-lunsfords-projects.vercel.app';

export function getMyAgentTool(server: McpServer) {
  server.registerTool(
    'get_my_agent',
    {
      description: 'Get your agent profile — name, ID, provider, status, and registration date. Zero-config: uses the auto-assigned agent identity.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async () => {
      const id = getAgentId() || await ensureRegistered();
      const name = getAgentName();
      const apiUrl = getApiUrl();
      const apiKey = getApiKey();

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(id)}`, {
          headers: getAuthHeaders(),
        });

        const agent = res.ok
          ? await res.json() as {
              agent_id: string; name: string | null; provider_class: string;
              status: string; created_at: string; last_active_at: string;
            }
          : null;

        let text = `Your ACR Agent\n${'═'.repeat(30)}\n`;
        text += `Name: ${agent?.name ?? name ?? id}\n`;
        text += `Agent ID: ${id}\n`;
        if (agent?.provider_class) text += `Provider: ${agent.provider_class}\n`;
        if (agent?.status) text += `Status: ${agent.status}\n`;

        if (apiKey) {
          text += `\nAPI Key: ${apiKey.substring(0, 16)}...${apiKey.substring(apiKey.length - 4)}\n`;
          text += `(Full key stored in ~/.claude/.acr-state.json)\n`;
        }

        text += `\nDashboard: ${DASHBOARD_URL}/agents/${id}\n`;

        text += `\nAvailable lenses:\n`;
        text += `  get_friction_report — where time and tokens are lost\n`;
        text += `  get_profile — full interaction profile with composition delta\n`;
        text += `  summarize_my_agent — one-read overview across all lenses\n`;
        text += `  get_coverage — signal completeness of your logging\n`;
        text += `  get_failure_registry — per-target failure breakdown\n`;
        text += `  get_stable_corridors — reliably fast interaction paths\n`;
        text += `  get_trend — latency and failure rate changes over time\n`;
        text += `  get_interaction_log — recent interaction history\n`;
        text += `  get_network_status — network-wide observatory\n`;

        if (agent?.created_at) text += `\nRegistered: ${agent.created_at}\n`;
        if (agent?.last_active_at) text += `Last active: ${agent.last_active_at}\n`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );
}
