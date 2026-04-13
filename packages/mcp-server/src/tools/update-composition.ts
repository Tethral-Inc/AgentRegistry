import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';
import { stripSubComponents } from '../strip-sub-components.js';

// Component schema — matches shared/schemas/agent.ts CompositionSchema.
// Kept local so we don't need to cross package boundaries for the Zod type.
const ComponentSchema = z.object({
  id: z.string().max(128),
  name: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
  sub_components: z.array(z.object({
    id: z.string().max(128),
    name: z.string().max(128).optional(),
    version: z.string().max(64).optional(),
    type: z.string().max(32).optional(),
  })).max(64).optional(),
});

export function updateCompositionTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.registerTool(
    'update_composition',
    {
      description: 'Update your agent composition without re-registering. Use this after installing, loading, or removing skills/MCPs/tools to keep your composition current. Preserves your agent identity. Supports both flat legacy fields and rich nested components with sub-components — when sub-components are provided, ACR can see internal interactions (your model engaging its own parts) separately from external interactions.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your agent ID (uses current session agent if omitted)'),
        composition: z.object({
          // Flat legacy fields — backwards compat
          skills: z.array(z.string()).optional().describe('Skill names (flat legacy format)'),
          skill_hashes: z.array(z.string()).optional().describe('SHA-256 hashes of each SKILL.md content (flat legacy format)'),
          mcps: z.array(z.string()).optional().describe('MCP server names (flat legacy format)'),
          tools: z.array(z.string()).optional().describe('Tool names (flat legacy format)'),
          // Rich nested fields — preferred for new clients
          skill_components: z.array(ComponentSchema).max(64).optional().describe('Rich nested skill composition. Each skill can declare sub_components.'),
          mcp_components: z.array(ComponentSchema).max(64).optional().describe('Rich nested MCP composition with sub_components.'),
          api_components: z.array(ComponentSchema).max(64).optional().describe('External APIs the agent calls with sub_components.'),
          tool_components: z.array(ComponentSchema).max(64).optional().describe('Tools bound to the agent with sub_components.'),
        }).describe('Your current composition'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.4 },
    },
    async ({ agent_id, composition }) => {
      try {
        const resolvedAgentId = agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl);

        const session = getSession();
        const deep = session.deepComposition;
        const effectiveComposition = {
          ...composition,
          skill_components: stripSubComponents(composition.skill_components, deep),
          mcp_components: stripSubComponents(composition.mcp_components, deep),
          api_components: stripSubComponents(composition.api_components, deep),
          tool_components: stripSubComponents(composition.tool_components, deep),
        };

        const res = await fetch(`${apiUrl}/api/v1/composition/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: resolvedAgentId,
            composition: effectiveComposition,
            composition_source: 'agent_reported',
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

        const skillCount = (composition.skills?.length ?? 0)
          + (composition.skill_hashes?.length ?? 0)
          + (composition.skill_components?.length ?? 0);
        const toolCount = (composition.mcps?.length ?? 0)
          + (composition.tools?.length ?? 0)
          + (composition.mcp_components?.length ?? 0)
          + (composition.tool_components?.length ?? 0);

        const deepNote = session.deepComposition
          ? ''
          : '\n\n(Deep composition is disabled. Sub-components, if provided, were stripped before sending.)';

        return {
          content: [{
            type: 'text' as const,
            text: `Composition updated successfully.\n\nComposition hash: ${data.composition_hash}\nSkills: ${skillCount}\nTools/MCPs: ${toolCount}\n\nYour agent identity (${resolvedAgentId}) is preserved.${deepNote}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Composition update error: ${msg}` }] };
      }
    },
  );
}
