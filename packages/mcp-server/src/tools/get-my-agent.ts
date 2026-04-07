import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

export function getMyAgentTool(server: McpServer) {
  server.tool(
    'get_my_agent',
    'Get your agent profile — name, ID, provider, status, and registration date. Zero-config: uses the auto-assigned agent identity.',
    {},
    async () => {
      const id = getAgentId() || await ensureRegistered();
      const name = getAgentName();
      const apiUrl = getApiUrl();

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(id)}`);

        if (!res.ok) {
          // Fallback to local state if the API doesn't have the lookup endpoint yet
          let text = `Agent ID: ${id}\n`;
          if (name) text += `Name: ${name}\n`;
          text += `\n(Agent lookup endpoint not available — showing cached session data)`;
          return { content: [{ type: 'text' as const, text }] };
        }

        const agent = await res.json() as {
          agent_id: string;
          name: string | null;
          provider_class: string;
          status: string;
          operational_domain: string | null;
          created_at: string;
          last_active_at: string;
        };

        let text = '';
        if (agent.name) {
          text += `Name: ${agent.name}\n`;
        }
        text += `Agent ID: ${agent.agent_id}\n`;
        text += `Provider: ${agent.provider_class}\n`;
        text += `Status: ${agent.status}\n`;
        if (agent.operational_domain) {
          text += `Domain: ${agent.operational_domain}\n`;
        }
        text += `Registered: ${agent.created_at}\n`;
        text += `Last active: ${agent.last_active_at}\n`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error fetching agent profile: ${msg}` }] };
      }
    },
  );
}
