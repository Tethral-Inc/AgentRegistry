import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

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
          device_class: string | null;
          platform: string | null;
          arch: string | null;
          client_type: string | null;
          transport_type: string | null;
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
        // Environment context
        if (agent.platform || agent.device_class || agent.transport_type) {
          text += `\nEnvironment:\n`;
          if (agent.device_class) text += `  Device: ${agent.device_class}\n`;
          if (agent.platform) text += `  Platform: ${agent.platform}\n`;
          if (agent.arch) text += `  Arch: ${agent.arch}\n`;
          if (agent.client_type) text += `  Client: ${agent.client_type}\n`;
          if (agent.transport_type) text += `  Transport: ${agent.transport_type}\n`;
        }
        text += `\nRegistered: ${agent.created_at}\n`;
        text += `Last active: ${agent.last_active_at}\n`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error fetching agent profile: ${msg}` }] };
      }
    },
  );
}
