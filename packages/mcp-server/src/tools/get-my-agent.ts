import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl, getApiKey, getAuthHeaders } from '../state.js';

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard.acr.nfkey.ai';

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

        const displayName = agent?.name ?? name ?? id;
        const provider = agent?.provider_class ?? 'unknown';

        let text = `${displayName} (${provider})\n`;
        text += `ID: ${id}\n`;
        if (apiKey) text += `Key: ${apiKey.substring(0, 16)}...${apiKey.substring(apiKey.length - 4)} (full key in ~/.claude/.acr-state.json)\n`;
        text += `Dashboard: ${DASHBOARD_URL}/agents/${id}\n`;
        text += `\nLenses: get_friction_report · get_profile · summarize_my_agent · get_coverage · get_failure_registry · get_stable_corridors · get_trend · get_interaction_log · get_network_status`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );
}
