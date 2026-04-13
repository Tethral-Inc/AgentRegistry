import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setAgentId, setAgentName } from '../state.js';
import { defaultSession } from '../session-state.js';
import { writeAcrStateFile } from '../acr-state-file.js';
import { stripSubComponents } from '../strip-sub-components.js';

const DATA_NOTICE = ' ACR collects interaction metadata (target names, timing, status) to build your interaction profile — queryable through behavioral lenses (friction and more) — and to propagate anomaly signal notifications. No request/response content is collected. We do not track the agent owner. Terms: https://acr.nfkey.ai/terms';

// Minimal shape for a composable component — matches shared/schemas/agent.ts
// CompositionSchema. Kept local to the MCP so we don't need to import Zod
// inference types across package boundaries.
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

export function registerAgentTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'register_agent',
    {
      description: 'Register an agent with the ACR network. Optional — agents are auto-registered on first tool call.' + DATA_NOTICE,
      inputSchema: {
        public_key: z.string().min(32).describe('Agent public key or unique identifier (min 32 chars)'),
        provider_class: z.enum([
          'anthropic', 'openai', 'google', 'openclaw', 'langchain',
          'crewai', 'autogen', 'custom', 'unknown',
        ]).describe('Agent provider/framework'),
        name: z.string().max(64).optional().describe('Human-readable name for this agent (e.g. "my-dev-assistant"). Auto-generated if omitted.'),
        skills: z.array(z.string()).optional().describe('List of installed skill names (flat legacy format)'),
        skill_hashes: z.array(z.string()).optional().describe('SHA-256 hashes of installed SKILL.md files (flat legacy format)'),
        operational_domain: z.string().max(200).optional().describe('What domain this agent operates in'),
        skill_components: z.array(ComponentSchema).max(64).optional().describe('Rich nested skill composition. Each skill can declare sub_components (sub-scripts, sub-tools) so ACR can distinguish internal from external friction.'),
        mcp_components: z.array(ComponentSchema).max(64).optional().describe('Rich nested MCP composition. Each MCP can declare sub_components (exposed tools).'),
        api_components: z.array(ComponentSchema).max(64).optional().describe('External APIs the agent calls. Each can declare sub_components (endpoints, sub-APIs).'),
        tool_components: z.array(ComponentSchema).max(64).optional().describe('Tools the agent has bound. Each can declare sub_components.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
    async ({
      public_key, provider_class, name, skills, skill_hashes, operational_domain,
      skill_components, mcp_components, api_components, tool_components,
    }) => {
      try {
        const deep = defaultSession.deepComposition;
        const composition = {
          skills,
          skill_hashes,
          skill_components: stripSubComponents(skill_components, deep),
          mcp_components: stripSubComponents(mcp_components, deep),
          api_components: stripSubComponents(api_components, deep),
          tool_components: stripSubComponents(tool_components, deep),
        };

        const hasComposition = !!(
          skills || skill_hashes
          || skill_components || mcp_components
          || api_components || tool_components
        );

        const res = await fetch(`${apiUrl}/api/v1/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            public_key,
            provider_class,
            name,
            composition: hasComposition ? composition : undefined,
            // Agent-invoked registration is agent_reported. The MCP's own
            // observation is reported separately in Phase 2 when host
            // integration provides it.
            composition_source: 'agent_reported',
            operational_domain,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Registration failed: ${errText}` }] };
        }

        const data = await res.json();

        // Store agent_id and name for auto-use in other tools
        setAgentId(data.agent_id);
        if (data.name) setAgentName(data.name);
        writeAcrStateFile(data.agent_id, apiUrl);

        const briefing = data.environment_briefing;
        let text = `Registered successfully.\n\nName: ${data.name}\nAgent ID: ${data.agent_id}\nComposition Hash: ${data.composition_hash}\n`;

        const systems = briefing?.connected_systems ?? [];
        if (systems.length > 0) {
          text += `\nConnected Systems: ${systems.length}`;
        }
        const signals = briefing?.skill_signals ?? [];
        if (signals.length > 0) {
          text += `\n\nSkills with anomaly signals: ${signals.length}`;
          for (const s of signals) {
            text += `\n- ${s.skill_name || s.skill_hash?.substring(0, 16) + '...'} — ${s.anomaly_signal_count ?? 0} signals, ${s.agent_count ?? 0} reporters`;
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
