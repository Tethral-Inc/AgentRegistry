import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl, getApiKey, getAuthHeaders } from '../state.js';

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard.acr.nfkey.ai';

const TOOL_MENU = `
── Available Tools ──
  Your agent:   get_my_agent · register_agent · update_composition · configure_deep_composition
  Logging:      log_interaction
  Your profile: get_friction_report · summarize_my_agent · get_profile · get_coverage · get_failure_registry · get_stable_corridors · get_trend · get_interaction_log · whats_new
  Notifications: get_notifications · acknowledge_threat
  Network:      get_network_status · check_environment · check_entity
  Registry:     search_skills · get_skill_tracker · get_skill_versions`.trimStart();

async function fetchJsonSafe(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getMyAgentTool(server: McpServer) {
  server.registerTool(
    'get_my_agent',
    {
      description: 'Get your agent identity, API key, dashboard link, a health snapshot (friction, notifications, coverage), and a grouped menu of all available tools. Zero-config: uses the auto-assigned agent identity.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async () => {
      const id = getAgentId() || await ensureRegistered();
      const name = getAgentName();
      const apiUrl = getApiUrl();
      const apiKey = getApiKey();
      const authHeaders = getAuthHeaders();

      try {
        // Fetch agent record + health data in parallel
        const [agentRes, frictionData, notifData, coverageData, profileData] = await Promise.all([
          fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(id)}`, { headers: authHeaders }),
          fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/friction?scope=week`, authHeaders),
          fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/notifications?read=false`, authHeaders),
          fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/coverage`, authHeaders),
          fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/profile`, authHeaders),
        ]);

        const agent = agentRes.ok
          ? await agentRes.json() as {
              agent_id: string; name: string | null; provider_class: string;
              status: string; created_at: string; last_active_at: string;
            }
          : null;

        const displayName = agent?.name ?? name ?? id;
        const provider = agent?.provider_class ?? 'unknown';

        // Identity block
        let text = `${displayName} (${provider})\n`;
        text += `ID: ${id}\n`;
        if (apiKey) text += `Key: ${apiKey}\n`;
        text += `Dashboard: ${DASHBOARD_URL}/agents/${id}\n`;
        if (agent?.status) text += `Status: ${agent.status}\n`;
        if (agent?.last_active_at) text += `Last active: ${agent.last_active_at}\n`;

        // Health card
        const flags: string[] = [];

        // Friction flags
        if (frictionData && !frictionData.error) {
          const targets = frictionData.top_targets as Array<Record<string, unknown>> ?? [];
          const networkFailureRates = new Map<string, number>();
          for (const t of targets) {
            if (t.network_failure_rate != null) {
              networkFailureRates.set(t.target_system_id as string, t.network_failure_rate as number);
            }
          }
          for (const t of targets) {
            const prop = t.proportion_of_wait as number ?? t.proportion_of_total as number ?? 0;
            const failRate = t.failure_rate as number ?? 0;
            if (prop > 0.3 && failRate > 0) {
              const pct = (prop * 100).toFixed(0);
              const failPct = (failRate * 100).toFixed(1);
              let flag = `⚠  ${t.target_system_id} — ${pct}% of wait time, ${failPct}% failure rate`;
              const netFail = t.network_failure_rate as number ?? 0;
              if (failRate > 0.5 && netFail > 0.3) {
                flag += ' (network-wide — not your code)';
              }
              flags.push(flag);
            }
          }

        }

        // Composition empty check from profile endpoint
        if (profileData && !profileData.error) {
          const compositionSummary = profileData.composition_summary as Record<string, unknown> | null;
          if (compositionSummary) {
            const skills = (compositionSummary.skill_count as number) ?? 0;
            const mcps = (compositionSummary.mcp_count as number) ?? 0;
            const tools = (compositionSummary.tool_count as number) ?? 0;
            if (skills === 0 && mcps === 0 && tools === 0) {
              flags.push('!  Composition empty — targeted notifications disabled. Call update_composition.');
            }
          }
        }

        // Coverage gaps
        if (coverageData && !coverageData.error) {
          const rules = coverageData.rules as Array<{ signal: string; triggered: boolean }> ?? [];
          const gaps = rules.filter((r) => r.triggered).map((r) => r.signal);
          if (gaps.length > 0) {
            flags.push(`!  Coverage gaps: ${gaps.join(', ')} — some lens data unavailable`);
          }
        }

        // Notification count
        if (notifData && !notifData.error) {
          const unread = notifData.unread_count as number ?? 0;
          if (unread > 0) {
            flags.push(`!  ${unread} unread notification(s) — call get_notifications`);
          }
        }

        text += '\n── Health ──\n';
        if (flags.length === 0) {
          text += '  ✓  No issues detected this week\n';
        } else {
          for (const f of flags.slice(0, 3)) {
            text += `  ${f}\n`;
          }
        }

        text += `\n${TOOL_MENU}\n`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }
    },
  );
}
