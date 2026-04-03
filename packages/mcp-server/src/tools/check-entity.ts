import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function checkEntityTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.tool(
    'check_entity',
    'Check if a skill hash, agent, or system is known to the ACR network. Use before installing skills to verify safety.',
    {
      entity_type: z.enum(['skill', 'agent', 'system']).describe('Type of entity to look up'),
      entity_id: z.string().describe('The entity identifier: skill SHA-256 hash, agent_id, or system_id'),
    },
    async ({ entity_type, entity_id }) => {
      try {
        let url: string;
        switch (entity_type) {
          case 'skill':
            url = `${resolverUrl}/v1/skill/${entity_id}`;
            break;
          case 'agent':
            url = `${resolverUrl}/v1/agent/${entity_id}`;
            break;
          case 'system':
            url = `${resolverUrl}/v1/system/${encodeURIComponent(entity_id)}/health`;
            break;
        }

        const res = await fetch(url);
        const data = await res.json();

        if (entity_type === 'skill') {
          if (!data.found) {
            return {
              content: [{
                type: 'text' as const,
                text: `Unknown skill. This hash has not been seen in the ACR network. Exercise caution with unfamiliar skills.`,
              }],
            };
          }

          const level = (data.threat_level ?? 'none').toUpperCase();
          let text = `Skill found.\n\nThreat Level: ${level}`;
          if (data.skill_name) text += `\nName: ${data.skill_name}`;
          if (data.agent_count != null) text += `\nAgents using: ${data.agent_count}`;
          if (data.interaction_count != null) text += `\nInteractions: ${data.interaction_count}`;
          if (data.anomaly_rate != null) text += `\nAnomaly rate: ${(data.anomaly_rate * 100).toFixed(1)}%`;

          if (data.threat_level === 'high' || data.threat_level === 'critical') {
            text += `\n\nWARNING: This skill has been flagged. Do not install without explicit user confirmation.`;
          } else if (data.threat_level === 'medium') {
            text += `\n\nCaution: Elevated anomaly signals. Proceed only if the user confirms.`;
          }

          return { content: [{ type: 'text' as const, text }] };
        }

        if (entity_type === 'agent') {
          if (!data.found) {
            return { content: [{ type: 'text' as const, text: `Agent ${entity_id} not found in the network.` }] };
          }
          return {
            content: [{
              type: 'text' as const,
              text: `Agent found.\n\nStatus: ${data.status}\nProvider: ${data.provider_class}\nRegistered: ${data.registered}\nLast active: ${data.last_active}`,
            }],
          };
        }

        // system
        if (!data.found) {
          return { content: [{ type: 'text' as const, text: `System ${entity_id} not found.` }] };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `System found.\n\nHealth: ${data.health_status}\nType: ${data.system_type}\nTotal interactions: ${data.total_interactions}\nDistinct agents: ${data.distinct_agents}\nAnomaly rate: ${((data.anomaly_rate ?? 0) * 100).toFixed(1)}%`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Lookup error: ${msg}` }] };
      }
    },
  );
}
