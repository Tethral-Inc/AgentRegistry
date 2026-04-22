import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';

const TOOL_DESCRIPTION = `Query the revealed-preference lens: what the agent *declared* in its composition vs what it *actually called* during the window. Only ACR can see both — so this is the view no self-report and no server log can produce alone.

The lens classifies every target into one of four buckets:
  • bound_uncalled  — declared in composition, never called. Dead weight in the context window.
  • bound_underused — declared, called fewer than 3 times. Possibly low-value, possibly just task-gated.
  • bound_active    — declared and called meaningfully. Healthy signal.
  • called_unbound  — called without being declared. Composition drift — your declared environment doesn't match reality.

When both composition sources are present (mcp_observed + agent_reported), the summary reports binding_source_disagreements — targets one source lists and the other doesn't. A disagreement on a target the agent actually calls is a strong integrity signal.

Defaults to scope=yesterday (complete prior day). A live "today" window always undercounts the agent's steady state. Source defaults to 'agent' so the called-set is the agent's real traffic, not observer self-log.`;

export function getRevealedPreferenceTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_revealed_preference',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['yesterday', 'day', 'week', 'month']).optional().default('yesterday').describe('Time window. Default yesterday — a complete prior day. Use week/month for slow-moving bindings.'),
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source for the called-set. 'agent' (default) = log_interaction calls. 'server' = observer self-log. 'all' = both."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.75 },
    },
    async ({ agent_id, agent_name, scope, source }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }

      try {
        const params = new URLSearchParams({
          scope: scope ?? 'yesterday',
          source: source ?? 'agent',
        });
        const res = await fetchAuthed(`${apiUrl}/api/v1/agent/${id}/revealed-preference?${params}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Revealed-preference error: ${errText}` }] };
        }
        const data = await res.json();

        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        displayName = data.name || agent_name || getAgentName() || displayName;
        const s = data.summary;
        const scopeLabel = scope ?? 'yesterday';

        if (s.bound_targets === 0 && s.called_targets === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No bindings and no calls recorded for ${displayName} (scope "${scopeLabel}", source "${source ?? 'agent'}"). Register with composition fields populated, and emit log_interaction after each external call. If you're only emitting server self-log, pass source='all' or source='server'.`,
            }],
          };
        }

        let text = `Revealed-Preference Report for ${displayName} (${scopeLabel})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Source: ${source ?? 'agent'}\n\n`;

        text += `── Summary ──\n`;
        text += `  Bound targets (declared): ${s.bound_targets}\n`;
        text += `  Called targets (actual): ${s.called_targets}\n`;
        text += `  ■ bound_uncalled  : ${s.bound_uncalled}\n`;
        text += `  ■ bound_underused : ${s.bound_underused}\n`;
        text += `  ■ bound_active    : ${s.bound_active}\n`;
        text += `  ■ called_unbound  : ${s.called_unbound}\n`;
        if (s.binding_source_disagreements > 0) {
          text += `  ⚠ source disagreements: ${s.binding_source_disagreements} (targets only one composition source declares)\n`;
        }

        const byClass: Record<string, typeof data.targets> = {
          bound_uncalled: [],
          called_unbound: [],
          bound_underused: [],
          bound_active: [],
        };
        for (const t of data.targets) {
          byClass[t.classification]?.push(t);
        }

        function renderGroup(label: string, key: string, note: string) {
          const items = byClass[key] ?? [];
          if (items.length === 0) return;
          text += `\n── ${label} (${items.length}) ──\n`;
          text += `  ${note}\n`;
          for (const t of items) {
            text += `  • ${t.target_system_id} ${confidence(t.call_count)}`;
            if (t.binding_sources.length > 0) {
              text += `  [bound by: ${t.binding_sources.join(', ')}]`;
            }
            if (t.last_called) text += `  (last ${t.last_called})`;
            text += `\n`;
          }
        }

        renderGroup('Bound but uncalled', 'bound_uncalled', 'Declared in composition, never called in this window.');
        renderGroup('Called but unbound', 'called_unbound', 'Called without being declared — your composition does not describe reality.');
        renderGroup('Bound but underused', 'bound_underused', 'Declared, called fewer than 3 times — possibly low-value, possibly just task-gated.');
        renderGroup('Bound and active', 'bound_active', 'Declared and used meaningfully — healthy.');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Revealed-preference error: ${msg}` }] };
      }
    },
  );
}
