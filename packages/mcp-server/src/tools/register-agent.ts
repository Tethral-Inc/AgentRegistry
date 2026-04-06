import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setAgentId } from '../state.js';

const DATA_NOTICE = ' ACR collects interaction metadata (target names, timing, status) for threat detection and friction analysis. No request/response content is collected. Terms: https://acr.nfkey.ai/terms';

export function registerAgentTool(server: McpServer, apiUrl: string) {
  server.tool(
    'register_agent',
    'Register an agent with the ACR network. Optional — agents are auto-registered on first tool call.' + DATA_NOTICE,
    {
      public_key: z.string().min(32).describe('Agent public key or unique identifier (min 32 chars)'),
      provider_class: z.enum([
        'anthropic', 'openai', 'google', 'openclaw', 'langchain',
        'crewai', 'autogen', 'custom', 'unknown',
      ]).describe('Agent provider/framework'),
      skills: z.array(z.string()).optional().describe('List of installed skill names'),
      skill_hashes: z.array(z.string()).optional().describe('SHA-256 hashes of installed SKILL.md files'),
      operational_domain: z.string().max(200).optional().describe('What domain this agent operates in'),
    },
    async ({ public_key, provider_class, skills, skill_hashes, operational_domain }) => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            public_key,
            provider_class,
            composition: (skills || skill_hashes) ? { skills, skill_hashes } : undefined,
            operational_domain,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Registration failed: ${JSON.stringify(data)}` }] };
        }

        // Store agent_id for auto-use in other tools
        setAgentId(data.agent_id);

        const briefing = data.environment_briefing;
        let text = `Registered successfully.\n\nAgent ID: ${data.agent_id}\nComposition Hash: ${data.composition_hash}\n`;

        if (briefing.connected_systems.length > 0) {
          text += `\nConnected Systems: ${briefing.connected_systems.length}`;
        }
        if (briefing.active_threats.length > 0) {
          text += `\n\nActive Threats: ${briefing.active_threats.length}`;
          for (const t of briefing.active_threats) {
            text += `\n- [${t.threat_level.toUpperCase()}] ${t.description}`;
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Registration error: ${msg}` }] };
      }
    },
  );
}
