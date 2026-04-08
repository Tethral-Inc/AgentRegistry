import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';

export function updateCompositionTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.tool(
    'update_composition',
    'Update your agent skill composition without re-registering. Use this after installing or removing skills to keep your composition current. Preserves your agent identity.',
    {
      agent_id: z.string().optional().describe('Your agent ID (uses current session agent if omitted)'),
      composition: z.object({
        skills: z.array(z.string()).optional().describe('Skill names'),
        skill_hashes: z.array(z.string()).optional().describe('SHA-256 hashes of each SKILL.md content'),
        mcps: z.array(z.string()).optional().describe('MCP server names'),
        tools: z.array(z.string()).optional().describe('Tool names'),
      }).describe('Your current skill/tool composition'),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ agent_id, composition }) => {
      try {
        const resolvedAgentId = agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl);

        const res = await fetch(`${apiUrl}/api/v1/composition/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: resolvedAgentId,
            composition,
          }),
        });

        const data = await res.json() as { composition_hash?: string; error?: { message: string } };

        if (!res.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `Composition update failed: ${data.error?.message ?? `HTTP ${res.status}`}`,
            }],
          };
        }

        const skillCount = (composition.skills?.length ?? 0) + (composition.skill_hashes?.length ?? 0);
        const toolCount = (composition.mcps?.length ?? 0) + (composition.tools?.length ?? 0);

        return {
          content: [{
            type: 'text' as const,
            text: `Composition updated successfully.\n\nComposition hash: ${data.composition_hash}\nSkills: ${skillCount}\nTools/MCPs: ${toolCount}\n\nYour agent identity (${resolvedAgentId}) is preserved.`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Composition update error: ${msg}` }] };
      }
    },
  );
}
