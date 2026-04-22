import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { setAgentId, setAgentName, setApiKey } from '../state.js';
import { getActiveSession } from '../session-state.js';
import { writeAcrStateFile } from '../acr-state-file.js';
import { stripSubComponents } from '../strip-sub-components.js';
import { signRegistration } from '../utils/pop-client.js';
import { diffLine, section, truncHash } from '../utils/style.js';

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
      description: 'Register an agent with the ACR network. Optional — agents are auto-registered on first tool call. The MCP owns the Ed25519 keypair used for proof-of-possession; the agent never handles keys directly.' + DATA_NOTICE,
      inputSchema: {
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
      provider_class, name, skills, skill_hashes, operational_domain,
      skill_components, mcp_components, api_components, tool_components,
    }) => {
      try {
        const session = getActiveSession();
        const deep = session.deepComposition;
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

        // PoP: MCP owns the Ed25519 keypair. The agent never sees it —
        // removing public_key from the tool input also removes any way
        // for a prompt-injection attacker to convince the agent to
        // register against a different key.
        const { publicKey, privateKey } = session.ensureKeypair(apiUrl);
        const timestampMs = Date.now();
        const signature = signRegistration(privateKey, publicKey, timestampMs);

        const res = await fetch(`${apiUrl}/api/v1/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            public_key: publicKey,
            registration_timestamp_ms: timestampMs,
            signature,
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

        setAgentId(data.agent_id);
        if (data.name) setAgentName(data.name);
        if (data.api_key) setApiKey(data.api_key);
        writeAcrStateFile({
          agent_id: data.agent_id,
          api_url: apiUrl,
          api_key: data.api_key,
          public_key: publicKey,
          private_key: privateKey,
        });

        // The server tells us whether this was a fresh record or a
        // rebind of an existing agent. Missing flag → treat as initial
        // (older servers didn't set it, and the only alternative is
        // no-op rendering which is worse).
        const isReRegistration = (data as { reregistered?: boolean }).reregistered === true;
        const action = isReRegistration ? 'Re-registered' : 'Registered';

        // Counts of what the caller submitted. This is the "after"
        // state — for an initial registration the "before" is all
        // zeros; for a re-registration we don't have the old counts
        // without a second round trip, so we render the submission
        // counts and flag the re-registration shape explicitly.
        const skillCount = (skills?.length ?? 0)
          + (skill_hashes?.length ?? 0)
          + (skill_components?.length ?? 0);
        const mcpCount = mcp_components?.length ?? 0;
        const toolCount = tool_components?.length ?? 0;
        const apiCount = api_components?.length ?? 0;

        let text = `${action} successfully.\n\n`;
        text += `Name: ${data.name}\n`;
        text += `Agent ID: ${data.agent_id}\n`;

        text += `\n${section(isReRegistration ? 'Diff (submitted)' : 'Initial state')}\n`;
        if (isReRegistration) {
          text += `  Hash:   ${truncHash(data.composition_hash)}   (updated)\n`;
          text += `  Skills: ${skillCount} submitted\n`;
          text += `  MCPs:   ${mcpCount} submitted\n`;
          text += `  Tools:  ${toolCount} submitted\n`;
          text += `  APIs:   ${apiCount} submitted\n`;
          text += `  (Previous composition not fetched — call get_profile for the server-side view.)\n`;
        } else {
          text += diffLine('Hash  ', '—', truncHash(data.composition_hash)) + '\n';
          text += diffLine('Skills', 0, skillCount, skillCount > 0 ? `+${skillCount}` : 'none submitted') + '\n';
          text += diffLine('MCPs  ', 0, mcpCount, mcpCount > 0 ? `+${mcpCount}` : 'none submitted') + '\n';
          text += diffLine('Tools ', 0, toolCount, toolCount > 0 ? `+${toolCount}` : 'none submitted') + '\n';
          text += diffLine('APIs  ', 0, apiCount, apiCount > 0 ? `+${apiCount}` : 'none submitted') + '\n';
        }

        const briefing = data.environment_briefing;
        const systems = briefing?.connected_systems ?? [];
        if (systems.length > 0) {
          text += `\nConnected Systems: ${systems.length}\n`;
        }
        const signals = briefing?.skill_signals ?? [];
        if (signals.length > 0) {
          text += `\nSkills with anomaly signals: ${signals.length}\n`;
          for (const s of signals) {
            text += `- ${s.skill_name || truncHash(s.skill_hash)} — ${s.anomaly_signal_count ?? 0} signals, ${s.agent_count ?? 0} reporters\n`;
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
