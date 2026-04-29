import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { getActiveSession } from '../session-state.js';
import { renderUpgradeBanner } from '../version-check.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { renderNotificationHeader } from '../utils/notification-header.js';
import { whatsNewNextAction, renderNextActionFooter, nextActionMeta } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';
import { fetchActivePatterns, renderPatternsSection } from '../utils/patterns.js';
import { getAuthHeaders } from '../state.js';

export function whatsNewTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'whats_new',
    {
      description:
        "Time-scoped digest: yesterday's performance, anything that degraded this week, today's activity so far, and unread notification count. Strictly retrospective — for routing (\"what should I do next?\") call `orient_me` instead.",
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
        return renderResolveError(err);
      }

      displayName = agent_name || getAgentName() || displayName;

      // Fetch the four existing endpoints alongside patterns in one
      // parallel batch. fetchActivePatterns returns [] on any failure,
      // so a backend hiccup on /patterns renders as "nothing to notice"
      // without affecting the rest of whats_new.
      const authHeaders = getAuthHeaders();
      const [fetchResults, patterns] = await Promise.all([
        Promise.allSettled([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/friction?scope=yesterday`),
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/trend?scope=week`),
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/notifications?read=false`),
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/friction?scope=day`),
        ]),
        fetchActivePatterns(apiUrl, id, authHeaders),
      ]);
      const [yesterdayRes, weekTrendRes, notifRes, todayRes] = fetchResults;

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

      // ── Things we noticed ── (proactive pattern surfacing).
      // Slots above "Today so far" so it sits in the operator's
      // investigation flow: "here's what degraded → here's what
      // else we noticed → here's today's activity". Empty on the
      // common case so it doesn't clutter the briefing.
      text += renderPatternsSection(patterns);

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

      // whats_new is a digest, not a router. The next-action footer
      // points at the most useful FOLLOW-ON read for what the digest
      // surfaced — unread notifications win, otherwise route to a
      // fresh friction read. Routing decisions ("where should I
      // start?") live in orient_me, not here.
      const weekTargets = (trendData?.per_target as Array<Record<string, unknown>> | undefined) ?? [];
      const degradedCount = weekTargets.filter((t) => {
        const delta = t.failure_rate_delta as number | null | undefined;
        return delta != null && delta > 0;
      }).length;
      const unreadForAction = (notifData?.unread_count as number | undefined) ?? 0;
      const whatsNewItems = Array.from({ length: degradedCount + unreadForAction });

      const action = whatsNewNextAction({ items: whatsNewItems });
      text += renderNextActionFooter(action);
      text += renderDashboardFooter(id, 'overview');

      const meta = nextActionMeta(action);
      return {
        content: [{ type: 'text' as const, text }],
        ...(meta && { _meta: meta }),
      };
    },
  );
}
