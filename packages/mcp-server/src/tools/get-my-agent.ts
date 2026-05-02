import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl, getApiKey } from '../state.js';
import { getActiveSession, RegistrationFailedError } from '../session-state.js';
import { renderUpgradeBanner } from '../version-check.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { nextActionMeta } from '../utils/next-action.js';
import { appendKeyFragment } from '../utils/dashboard-link.js';

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard.acr.nfkey.ai';

/**
 * Menu of every registered tool, grouped by the task you'd be doing
 * when you'd want that tool. Kept in sync with the full registered set
 * via `tests/unit/tool-menu.test.ts` — CI fails if a new tool is added
 * without landing in a group here.
 *
 * The menu used to be rendered inside `get_my_agent`'s response, but
 * Sprint 2 / F6 stripped this tool to identity-only to remove overlap
 * with `orient_me`. The constant is still exported so the menu test
 * (and the README walkthrough) have one source of truth for the tool
 * grouping.
 */
const TOOL_MENU = `
── Available Tools ──
  Your agent:    get_my_agent · register_agent · update_composition · configure_deep_composition
  Onboarding:    orient_me · whats_new · summarize_my_agent
  Logging:       log_interaction
  Your profile:  get_profile · get_friction_report · get_coverage · get_failure_registry · get_stable_corridors · get_trend · get_interaction_log · get_revealed_preference · get_compensation_signatures · get_composition_diff
  Patterns:      dismiss_pattern
  Watches:       set_watch · list_watches
  Notifications: get_notifications · acknowledge_signal
  Network:       get_network_status · check_environment · check_entity
  Registry:      search_skills · get_skill_tracker · get_skill_versions
  Tier:          get_tier_features`.trimStart();

/**
 * Exported for the tool-menu test. Keep this list mirrored with the
 * menu string above — the test parses the string and asserts set
 * equality with this list. The one source of truth for "what tools does
 * this MCP register?" is the set of `server.registerTool('<name>', ...)`
 * calls under `src/tools/`; the test grep-scrapes them.
 */
export const EXPECTED_TOOL_MENU = TOOL_MENU;

export function getMyAgentTool(server: McpServer) {
  server.registerTool(
    'get_my_agent',
    {
      description: 'Identity card for your ACR agent: agent ID, API key, dashboard link, provider class, status. Pure identity — for "what should I do next?" call `orient_me`; for behavior data call any lens tool directly.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async () => {
      let id: string;
      try {
        id = getAgentId() || await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return {
            content: [{ type: 'text' as const, text: err.userMessage() }],
            isError: true,
          };
        }
        throw err;
      }
      const name = getAgentName();
      const apiUrl = getApiUrl();
      const apiKey = getApiKey();

      try {
        const agentRes = await fetchAuthed(`${apiUrl}/api/v1/agent/${encodeURIComponent(id)}`);
        const agent = agentRes.ok
          ? await agentRes.json() as {
              agent_id: string; name: string | null; provider_class: string;
              status: string; created_at: string; last_active_at: string;
            }
          : null;

        const displayName = agent?.name ?? name ?? id;
        const provider = agent?.provider_class ?? 'unknown';

        let text = renderUpgradeBanner(getActiveSession().versionCheck);
        text += `${displayName} (${provider})\n`;
        text += `ID: ${id}\n`;
        if (apiKey) text += `Key: ${apiKey}\n`;
        text += `Dashboard: ${appendKeyFragment(`${DASHBOARD_URL}/agents/${id}`, apiKey)}\n`;
        if (agent?.status) text += `Status: ${agent.status}\n`;
        if (agent?.last_active_at) text += `Last active: ${agent.last_active_at}\n`;

        text += `\n→ Next step: call \`orient_me\` to see what to do next, or call any lens tool directly.\n`;

        const meta = nextActionMeta({ text: '', tool: 'orient_me', args: {} });
        return {
          content: [{ type: 'text' as const, text }],
          ...(meta && { _meta: meta }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
