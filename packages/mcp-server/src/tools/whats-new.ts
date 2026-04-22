import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { getActiveSession } from '../session-state.js';
import { renderUpgradeBanner } from '../version-check.js';
import { renderNotificationHeader } from '../utils/notification-header.js';
import { whatsNewNextAction, renderNextActionFooter } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';

export function whatsNewTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'whats_new',
    {
      description:
        "Morning briefing: yesterday's performance summary, anything that degraded this week, today's activity so far, and unread notifications. One call to orient yourself at the start of a session.",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      const authHeaders = getAuthHeaders();
      displayName = agent_name || getAgentName() || displayName;

      // Fetch all four endpoints in parallel
      const [yesterdayRes, weekTrendRes, notifRes, todayRes] = await Promise.allSettled([
        fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=yesterday`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/v1/agent/${id}/trend?scope=week`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/v1/agent/${id}/notifications?read=false`, { headers: authHeaders }),
        fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=day`, { headers: authHeaders }),
      ]);

      async function safeJson(settled: PromiseSettledResult<Response>): Promise<Record<string, unknown> | null> {
        if (settled.status === 'rejected') return null;
        const res = settled.value;
        if (!res.ok) return null;
        try { return await res.json() as Record<string, unknown>; } catch { return null; }
      }

      const [yesterdayData, trendData, notifData, todayData] = await Promise.all([
        safeJson(yesterdayRes),
        safeJson(weekTrendRes),
        safeJson(notifRes),
        safeJson(todayRes),
      ]);

      // The notification header at the very top uses the same unread count
      // whats_new already fetches in parallel — zero extra round trip.
      const unreadCount = notifData
        ? ((notifData.unread_count as number | undefined) ?? null)
        : null;

      let text = renderUpgradeBanner(getActiveSession().versionCheck);
      text += renderNotificationHeader(unreadCount);
      text += `What's New — ${displayName}\n${'='.repeat(30)}\n`;

      // ── Yesterday ──
      text += `\n── Yesterday ──\n`;
      if (!yesterdayData) {
        text += `  unavailable\n`;
      } else {
        const s = yesterdayData.summary as Record<string, unknown> | undefined;
        if (!s || (s.total_interactions as number) === 0) {
          text += `  No activity recorded yesterday\n`;
        } else {
          const totalInteractions = s.total_interactions as number;
          const failureRate = ((s.failure_rate as number ?? 0) * 100).toFixed(1);
          const totalWaitS = ((s.total_wait_time_ms as number ?? 0) / 1000).toFixed(1);
          text += `  ${totalInteractions} interactions | ${failureRate}% failures | ${totalWaitS}s total wait\n`;

          const topTargets = yesterdayData.top_targets as Array<Record<string, unknown>> ?? [];
          if (topTargets.length > 0) {
            const top = topTargets[0];
            const pct = ((top.proportion_of_total as number ?? 0) * 100).toFixed(1);
            const absS = s.total_wait_time_ms
              ? (((top.proportion_of_total as number) * (s.total_wait_time_ms as number)) / 1000).toFixed(1)
              : null;
            text += `  Top cost: ${top.target_system_id} — ${pct}% of wait`;
            if (absS != null) text += ` (${absS}s)`;
            text += `\n`;
          }
        }
      }

      // ── Degraded this week ──
      text += `\n── Degraded this week ──\n`;
      if (!trendData) {
        text += `  unavailable\n`;
      } else {
        const targets = trendData.per_target as Array<Record<string, unknown>> ?? [];
        const degraded = targets.filter((t) => {
          const delta = t.failure_rate_delta as number | null;
          return delta != null && delta > 0;
        }).sort((a, b) => ((b.failure_rate_delta as number) - (a.failure_rate_delta as number)));

        if (degraded.length === 0) {
          text += `  Nothing degraded this week\n`;
        } else {
          for (const t of degraded.slice(0, 5)) {
            const deltaPp = ((t.failure_rate_delta as number) * 100).toFixed(1);
            text += `  ${t.target}: failure rate +${deltaPp}pp vs prior week\n`;
          }
        }
      }

      // ── Today so far ──
      text += `\n── Today so far ──\n`;
      if (!todayData) {
        text += `  unavailable\n`;
      } else {
        const s = todayData.summary as Record<string, unknown> | undefined;
        if (!s || (s.total_interactions as number) === 0) {
          text += `  No activity yet today\n`;
        } else {
          const totalInteractions = s.total_interactions as number;
          const failureRate = ((s.failure_rate as number ?? 0) * 100).toFixed(1);
          text += `  ${totalInteractions} interactions | ${failureRate}% failures\n`;
        }
      }

      // ── Notifications ──
      text += `\n── Notifications ──\n`;
      if (!notifData) {
        text += `  unavailable\n`;
      } else {
        const unread = notifData.unread_count as number ?? 0;
        if (unread === 0) {
          text += `  No unread notifications\n`;
        } else {
          text += `  ${unread} unread — call get_notifications to read them\n`;
        }
      }

      // Build a whats-new items summary the next-action heuristic expects.
      // We treat degraded targets + unread notifications as items worth
      // acknowledging — if there's nothing, whatsNewNextAction routes to
      // get_friction_report for a fresh read.
      const weekTargets = (trendData?.per_target as Array<Record<string, unknown>> | undefined) ?? [];
      const degradedCount = weekTargets.filter((t) => {
        const delta = t.failure_rate_delta as number | null | undefined;
        return delta != null && delta > 0;
      }).length;
      const unreadForAction = (notifData?.unread_count as number | undefined) ?? 0;
      const whatsNewItems = Array.from({ length: degradedCount + unreadForAction });

      text += renderNextActionFooter(whatsNewNextAction({ items: whatsNewItems }));
      text += renderDashboardFooter(id, 'overview');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
