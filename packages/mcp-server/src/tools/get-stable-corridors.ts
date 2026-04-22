import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { getUnreadNotificationCount, renderNotificationHeader } from '../utils/notification-header.js';
import { stableCorridorsNextAction, renderNextActionFooter } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';

export function getStableCorridorsTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_stable_corridors',
    {
      description: 'Stable corridors: interaction paths that are consistently reliable — zero failures, low latency variance, sufficient sample count. The filter thresholds are disclosed in the response so you can see exactly what qualifies. Useful for identifying which targets you can rely on.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'yesterday', 'week', 'month']).optional().default('week').describe('Time window'),
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source. 'agent' = your log_interaction calls (default). 'server' = observer-side self-log. 'all' = both."),
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
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      try {
        const params = new URLSearchParams({ scope: scope ?? 'week', source: source ?? 'agent' });
        const authHeaders = getAuthHeaders();
        const [res, unreadCount] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/stable-corridors?${params}`),
          getUnreadNotificationCount(apiUrl, id, authHeaders),
        ]);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Stable corridors error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = agent_name || getAgentName() || displayName;

        const matches = data.matches as Array<Record<string, unknown>> ?? [];
        const filter = data.filter_applied as Record<string, unknown>;

        let text = renderNotificationHeader(unreadCount);
        text += `Stable Corridors for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Source: ${source ?? 'agent'}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;

        if (filter) {
          text += `\n-- Filter Applied --\n`;
          for (const [key, value] of Object.entries(filter)) {
            text += `  ${key}: ${value}\n`;
          }
        }

        text += `\n-- Matches (${data.match_count !== undefined ? data.match_count : matches.length}) --\n`;

        if (matches.length === 0) {
          text += `  No stable corridors found for this period. This means no targets met all filter criteria (zero failures, low variance, sufficient samples).\n`;
        } else {
          for (const m of matches) {
            const receiptCount = (m.receipt_count as number) ?? 0;
            text += `\n  ${m.target_system_id}\n`;
            text += `    receipts: ${receiptCount} ${confidence(receiptCount)} | median: ${m.median_duration_ms}ms | p95: ${m.p95_duration_ms}ms\n`;
            text += `    cv: ${typeof m.coefficient_of_variation === 'number' ? (m.coefficient_of_variation as number).toFixed(3) : 'N/A'}\n`;
          }
        }

        text += renderNextActionFooter(
          stableCorridorsNextAction({
            corridors: matches.map((m) => ({
              target: m.target_system_id as string | undefined,
              stability_score: m.coefficient_of_variation as number | undefined,
            })),
          }),
        );
        text += renderDashboardFooter(id, 'stable-corridors', { range: scope, source: source ?? 'agent' });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Stable corridors error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
