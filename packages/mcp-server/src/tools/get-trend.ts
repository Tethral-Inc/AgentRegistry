import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { formatLatencyChangeFraction, formatFailureRateDelta } from '../utils/format-delta.js';
import { getUnreadNotificationCount, renderNotificationHeader } from '../utils/notification-header.js';
import { trendNextAction, renderNextActionFooter, nextActionMeta } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';
import { createSnapshot, renderSnapshotFooter } from '../utils/snapshot.js';
import { renderEmptyState } from '../utils/empty-state.js';
import { isDegraded, renderDegradedNotice, renderIfDegraded503 } from '../utils/degraded.js';

export function getTrendTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_trend',
    {
      description: 'Trend: per-target latency and failure rate changes over time. Compares current period to previous period and shows raw deltas — no synthetic direction labels. You see the numbers and decide what matters.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'yesterday', 'week']).optional().default('week').describe('Time window (compares current to previous)'),
        source: z.enum(['agent', 'server', 'all']).optional().default('all').describe("Signal source. 'all' = every capture path incl. the host-side hook (default). 'agent' = log_interaction self-reports only. 'server' = MCP observer self-log only."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id, agent_name, scope, source }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        return renderResolveError(err);
      }

      try {
        const params = new URLSearchParams({ scope: scope ?? 'week', source: source ?? 'all' });
        const authHeaders = getAuthHeaders();
        const [res, unreadCount] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/trend?${params}`),
          getUnreadNotificationCount(apiUrl, id, authHeaders),
        ]);
        if (!res.ok) {
          const degradedText = await renderIfDegraded503('Trend', res);
          if (degradedText) return { content: [{ type: 'text' as const, text: degradedText }] };
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Trend error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = (data.name as string) || agent_name || getAgentName() || displayName;

        const targets = data.per_target as Array<Record<string, unknown>> ?? [];
        const rules = data.inclusion_rules as Record<string, unknown>;
        const currentPeriod = data.current_period as { start: string; end: string } | undefined;
        const previousPeriod = data.comparison_period as { start: string; end: string } | undefined;

        let text = renderNotificationHeader(unreadCount);
        text += `Trend for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Source: ${source ?? 'all'}\n`;
        if (currentPeriod) text += `Current: ${currentPeriod.start} to ${currentPeriod.end}\n`;
        if (previousPeriod) text += `Previous: ${previousPeriod.start} to ${previousPeriod.end}\n`;

        // A degraded payload means a window query threw — the empty/zero
        // per-target set below is NOT a real reading, so don't render it as
        // "No trend data yet" or as clean deltas.
        if (isDegraded(data)) {
          text += renderDegradedNotice('Trend', data);
          text += renderDashboardFooter(id, 'trend', { range: scope, source: source ?? 'all' });
          return { content: [{ type: 'text' as const, text }] };
        }

        if (targets.length === 0) {
          // Standardized empty-state (F10) — replaces the bare
          // "No targets..." line with cohort framing + next step + unlocks.
          text += '\n';
          text += await renderEmptyState({
            displayName,
            lensName: 'trend',
            apiUrl,
            unlocks: 'period-over-period failure rate and latency deltas per target',
          });
        } else {
          for (const t of targets) {
            const curr = t.current as Record<string, unknown>;
            const prev = t.previous as Record<string, unknown> | null;

            const currN = (curr.receipt_count as number) ?? 0;
            const prevN = (prev?.receipt_count as number) ?? 0;
            text += `\n  ${t.target}\n`;
            text += `    current:  median ${curr.median_duration_ms}ms | failure ${((curr.failure_rate as number) * 100).toFixed(1)}% | ${currN} receipts ${confidence(currN)}\n`;

            if (prev) {
              text += `    previous: median ${prev.median_duration_ms}ms | failure ${((prev.failure_rate as number) * 100).toFixed(1)}% | ${prevN} receipts ${confidence(prevN)}\n`;
              // Delta confidence is the weaker of the two periods — a big
              // delta against a pre-signal baseline is still pre-signal.
              const deltaN = Math.min(currN, prevN);
              if (t.latency_change_ratio != null) {
                text += `    latency delta: ${formatLatencyChangeFraction(t.latency_change_ratio as number)} ${confidence(deltaN)}\n`;
              }
              if (t.failure_rate_delta != null) {
                text += `    failure rate delta: ${formatFailureRateDelta(t.failure_rate_delta as number)} ${confidence(deltaN)}\n`;
              }
            } else {
              text += `    previous: no data\n`;
            }
          }
        }

        if (rules) {
          text += `\n── How targets are included ──\n`;
          text += `  ${rules.target_included_if}\n`;
          if (rules.previous_window != null) text += `  Previous window: ${rules.previous_window}\n`;
        }

        const action = trendNextAction({
          per_target: targets.map((t) => ({
            target: t.target as string | undefined,
            latency_change_ratio: t.latency_change_ratio as number | null | undefined,
            failure_rate_delta: t.failure_rate_delta as number | null | undefined,
          })),
        });
        text += renderNextActionFooter(action);
        text += renderDashboardFooter(id, 'trend', { range: scope, source: source ?? 'all' });

        const snapshot = await createSnapshot({
          apiUrl,
          agentId: id,
          lens: 'trend',
          query: { scope, source: source ?? 'all' },
          resultText: text,
        });
        text += renderSnapshotFooter(snapshot);

        const meta = nextActionMeta(action);
        return {
          content: [{ type: 'text' as const, text }],
          ...(meta && { _meta: meta }),
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Trend error: ${err instanceof Error ? err.message : 'Unknown'}` }],
          isError: true,
        };
      }
    },
  );
}
