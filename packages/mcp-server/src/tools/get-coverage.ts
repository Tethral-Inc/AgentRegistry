import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { getUnreadNotificationCount, renderNotificationHeader } from '../utils/notification-header.js';
import { coverageNextAction, renderNextActionFooter } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';
import { createSnapshot, renderSnapshotFooter } from '../utils/snapshot.js';
import { section } from '../utils/style.js';

export function getCoverageTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_coverage',
    {
      description: "Signal coverage: which fields you populate on your receipts and which you don't. Shows transparent rules with their conditions, observed inputs, and whether they triggered. Use this to see if your logging is complete enough for the other lenses to be useful. Defaults to source='agent' (your log_interaction calls).",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source. 'agent' = your log_interaction calls (default). 'server' = observer-side self-log. 'all' = both."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id, agent_name, source }) => {
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
        const params = new URLSearchParams({ source: source ?? 'agent' });
        const authHeaders = getAuthHeaders();
        const [res, unreadCount] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/coverage?${params}`),
          getUnreadNotificationCount(apiUrl, id, authHeaders),
        ]);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Coverage error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = agent_name || getAgentName() || displayName;

        const signals = data.signals as Record<string, number>;
        const rules = data.rules as Array<{ signal: string; rule: string; observed: Record<string, number>; triggered: boolean }>;

        let text = renderNotificationHeader(unreadCount);
        text += `Coverage Report for ${displayName}\n${'='.repeat(30)}\n`;
        text += `Source: ${source ?? 'agent'}\n`;

        text += `\n${section('Signal Counts')}\n`;
        for (const [key, value] of Object.entries(signals)) {
          text += `  ${key}: ${value}\n`;
        }

        if (rules && rules.length > 0) {
          const triggered = rules.filter((r) => r.triggered);
          const ok = rules.filter((r) => !r.triggered);

          if (triggered.length > 0) {
            text += `\n${section(`Coverage Gaps (${triggered.length})`)}\n`;
            for (const r of triggered) {
              text += `  ${r.signal}: ${r.rule}\n`;
              text += `    observed: ${JSON.stringify(r.observed)}\n`;
            }
          }

          if (ok.length > 0) {
            text += `\n${section(`Covered (${ok.length})`)}\n`;
            for (const r of ok) {
              text += `  ${r.signal}: ${r.rule} — OK\n`;
            }
          }
        }

        text += renderNextActionFooter(
          coverageNextAction({
            rules: (rules ?? []).map((r) => ({ signal: r.signal, triggered: r.triggered })),
          }),
        );
        text += renderDashboardFooter(id, 'coverage', { source: source ?? 'agent' });

        const snapshot = await createSnapshot({
          apiUrl,
          agentId: id,
          lens: 'coverage',
          query: { source: source ?? 'agent' },
          resultText: text,
        });
        text += renderSnapshotFooter(snapshot);

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Coverage error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
