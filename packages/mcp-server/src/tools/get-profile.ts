import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

export function getProfileTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_profile',
    {
      description: 'Your interaction profile: identity, composition summary, composition delta (MCP-observed vs agent-reported), receipt counts, target counts, and days active. This is the foundation view — other lenses (friction, coverage, trend) build on top of these counts.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/profile`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Profile error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = (data.name as string) || agent_name || getAgentName() || displayName;
        const c = data.counts as Record<string, unknown>;
        const comp = data.composition_summary as Record<string, unknown>;

        let text = `Profile: ${displayName}\n${'='.repeat(30)}\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        if (data.provider_class) text += `Provider: ${data.provider_class}\n`;
        if (data.operational_domain) text += `Domain: ${data.operational_domain}\n`;
        if (data.composition_hash) text += `Composition hash: ${data.composition_hash}\n`;
        text += `Registered: ${data.registered_at}\n`;
        text += `Last active: ${data.last_active_at}\n`;

        text += `\n-- Counts --\n`;
        text += `  Total receipts: ${c.total_receipts}\n`;
        text += `  Last 24h: ${c.receipts_last_24h}\n`;
        text += `  Distinct targets: ${c.distinct_targets}\n`;
        text += `  Distinct categories: ${c.distinct_categories}\n`;
        text += `  Distinct chains: ${c.distinct_chains}\n`;
        text += `  Days active: ${c.days_active}\n`;
        if (c.first_signal_at) text += `  First signal: ${c.first_signal_at}\n`;
        if (c.last_signal_at) text += `  Last signal: ${c.last_signal_at}\n`;

        text += `\n-- Composition --\n`;
        text += `  Skills: ${comp.skill_count ?? 0}\n`;
        text += `  MCPs: ${comp.mcp_count ?? 0}\n`;
        text += `  Tools: ${comp.tool_count ?? 0}\n`;

        const delta = data.composition_delta as Record<string, unknown> | null;
        if (delta) {
          const mcpOnly = delta.mcp_only as string[];
          const agentOnly = delta.agent_only as string[];
          if (mcpOnly.length > 0 || agentOnly.length > 0) {
            text += `\n-- Composition Delta (MCP-observed vs agent-reported) --\n`;
            if (mcpOnly.length > 0) text += `  MCP sees but agent didn't report: ${mcpOnly.join(', ')}\n`;
            if (agentOnly.length > 0) text += `  Agent reported but MCP doesn't see: ${agentOnly.join(', ')}\n`;
          } else {
            text += `\n  Composition sources agree.\n`;
          }
          if (delta.last_observed_at) text += `  Last MCP observation: ${delta.last_observed_at}\n`;
          if (delta.last_reported_at) text += `  Last agent report: ${delta.last_reported_at}\n`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Profile error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
