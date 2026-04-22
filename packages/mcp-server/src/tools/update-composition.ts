import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveSession, RegistrationFailedError } from '../session-state.js';
import { stripSubComponents } from '../strip-sub-components.js';
import { ensureRegistered, getAgentId } from '../state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { diffLine, section, truncHash } from '../utils/style.js';

/**
 * Best-effort fetch of the current composition summary. Returns null
 * on any failure — rendering a diff is nice-to-have, but the mutation
 * itself must not block on this read. Operators who fire a blind update
 * still get a sensible response even if the profile read 500s.
 */
async function fetchCurrentCompositionSummary(
  apiUrl: string,
  agentId: string,
): Promise<{ hash?: string; skills: number; mcps: number; tools: number } | null> {
  try {
    const res = await fetchAuthed(`${apiUrl}/api/v1/agent/${agentId}/profile`);
    if (!res.ok) return null;
    const data = await res.json() as {
      composition_hash?: string;
      composition_summary?: { skill_count?: number; mcp_count?: number; tool_count?: number };
    };
    const s = data.composition_summary ?? {};
    return {
      hash: data.composition_hash,
      skills: s.skill_count ?? 0,
      mcps: s.mcp_count ?? 0,
      tools: s.tool_count ?? 0,
    };
  } catch {
    return null;
  }
}

/** Render `+N` / `-N` / `unchanged` for a count delta. */
function fmtDelta(before: number, after: number): string {
  if (before === after) return 'unchanged';
  const diff = after - before;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

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

export function updateCompositionTool(server: McpServer, apiUrl: string) {
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
      let resolvedAgentId: string;
      try {
        resolvedAgentId = agent_id ?? getAgentId() ?? await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return {
            content: [{ type: 'text' as const, text: err.userMessage() }],
            isError: true,
          };
        }
        throw err;
      }

      try {
        const session = getActiveSession();
        const deep = session.deepComposition;
        const effectiveComposition = {
          ...composition,
          skill_components: stripSubComponents(composition.skill_components, deep),
          mcp_components: stripSubComponents(composition.mcp_components, deep),
          api_components: stripSubComponents(composition.api_components, deep),
          tool_components: stripSubComponents(composition.tool_components, deep),
        };

        // Read the current composition before updating so the response
        // can render a before→after diff. If the read fails we still
        // perform the update — rendering a diff is nice-to-have, not a
        // hard prerequisite.
        const before = await fetchCurrentCompositionSummary(apiUrl, resolvedAgentId);

        const res = await fetchAuthed(`${apiUrl}/api/v1/composition/update`, {
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

        // Counts derived from what the caller *sent*. For the "after"
        // view we trust the submitted payload — the server echoes the
        // composition hash and we already sent the full composition.
        const afterSkills = (composition.skills?.length ?? 0)
          + (composition.skill_hashes?.length ?? 0)
          + (composition.skill_components?.length ?? 0);
        const afterMcps = (composition.mcps?.length ?? 0)
          + (composition.mcp_components?.length ?? 0);
        const afterTools = (composition.tools?.length ?? 0)
          + (composition.tool_components?.length ?? 0);

        const hashBefore = before?.hash;
        const hashAfter = data.composition_hash;
        const hashChanged = hashBefore && hashAfter && hashBefore !== hashAfter;

        let text = 'Composition updated successfully.\n\n';
        text += `${section('Diff')}\n`;
        if (before) {
          text += diffLine(
            'Hash  ',
            truncHash(hashBefore),
            truncHash(hashAfter),
            hashChanged ? 'changed' : (hashBefore && hashAfter ? 'unchanged' : undefined),
          ) + '\n';
          text += diffLine('Skills', before.skills, afterSkills, fmtDelta(before.skills, afterSkills)) + '\n';
          text += diffLine('MCPs  ', before.mcps, afterMcps, fmtDelta(before.mcps, afterMcps)) + '\n';
          text += diffLine('Tools ', before.tools, afterTools, fmtDelta(before.tools, afterTools)) + '\n';
        } else {
          // Couldn't read the before state. Render what we know now and
          // flag that the "before" column is missing so the operator
          // knows the absence is a read failure, not a no-op.
          text += `  Hash:   ${truncHash(hashAfter)}\n`;
          text += `  Skills: ${afterSkills}\n`;
          text += `  MCPs:   ${afterMcps}\n`;
          text += `  Tools:  ${afterTools}\n`;
          text += `  (Previous composition could not be read — diff is after-only.)\n`;
        }

        if (before && hashBefore === hashAfter) {
          text += '\nComposition unchanged. The payload matched what ACR already has on file.\n';
        }

        text += `\nAgent: ${resolvedAgentId} (identity preserved)\n`;

        if (!deep) {
          text += '\n(Deep composition is disabled. Sub-components, if provided, were stripped before sending.)\n';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Composition update error: ${msg}` }] };
      }
    },
  );
}
