import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { getUnreadNotificationCount, renderNotificationHeader } from '../utils/notification-header.js';
import { failureRegistryNextAction, renderNextActionFooter } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';

export function getFailureRegistryTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_failure_registry',
    {
      description: 'Failure registry: per-target breakdown of failures — status codes, error codes, categories, and median duration when failed. Shows where your interactions are failing and how.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'yesterday', 'week', 'month']).optional().default('week').describe('Time window'),
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source. 'agent' = your log_interaction calls (default). 'server' = observer-side self-log. 'all' = both."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
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
        const params = new URLSearchParams({ scope: scope ?? 'week', source: source ?? 'agent' });
        const authHeaders = getAuthHeaders();
        const [res, unreadCount] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/failure-registry?${params}`),
          getUnreadNotificationCount(apiUrl, id, authHeaders),
        ]);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Failure registry error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = (data.name as string) || agent_name || getAgentName() || displayName;

        const failures = data.failures as Array<Record<string, unknown>> ?? [];

        let text = renderNotificationHeader(unreadCount);
        text += `Failure Registry for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Source: ${source ?? 'agent'}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Total interactions: ${data.total_interactions}\n`;
        text += `Total failures: ${data.total_failures}\n`;
        const totalInteractions = (data.total_interactions as number) ?? 0;
        text += `Failure rate: ${((data.failure_rate as number) * 100).toFixed(1)}% ${confidence(totalInteractions)}\n`;
        text += `Distinct failing targets: ${data.distinct_failing_targets}\n`;

        if (failures.length === 0) {
          // Explicit health marker so the operator sees at a glance
          // that the empty output is good news, not a missing-data
          // problem. The next-action footer still fires below.
          text += `\n✓ Healthy — no failures recorded in this period.\n`;
        } else {
          for (const f of failures) {
            const totalCount = (f.total_count as number) ?? 0;
            text += `\n  ${f.target_system_id} (${f.target_system_type})\n`;
            text += `    total failures: ${totalCount} ${confidence(totalCount)}\n`;

            const statuses = f.statuses as Record<string, number>;
            if (statuses && Object.keys(statuses).length > 0) {
              text += `    statuses: ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
            }
            const errors = f.error_codes as Record<string, number>;
            if (errors && Object.keys(errors).length > 0) {
              text += `    error codes: ${Object.entries(errors).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
            }
            const cats = f.categories as Record<string, number>;
            if (cats && Object.keys(cats).length > 0) {
              text += `    categories: ${Object.entries(cats).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
            }
            if (f.median_duration_when_failed_ms != null) {
              text += `    median duration when failed: ${f.median_duration_when_failed_ms}ms\n`;
            }
          }
        }

        // Build the by_error_code summary the next-action heuristic expects.
        // Failure-registry doesn't pre-aggregate by error code across targets,
        // so we synthesize from per-target breakdowns.
        const byErrorCode: Array<{ error_code?: string; count?: number; top_target?: string }> = [];
        for (const f of failures) {
          const errors = f.error_codes as Record<string, number> | undefined;
          if (!errors) continue;
          for (const [code, count] of Object.entries(errors)) {
            byErrorCode.push({ error_code: code, count, top_target: f.target_system_id as string });
          }
        }
        byErrorCode.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

        text += renderNextActionFooter(
          failureRegistryNextAction({
            total_failures: data.total_failures as number | undefined,
            by_error_code: byErrorCode,
          }),
        );
        text += renderDashboardFooter(id, 'failure-registry', { range: scope, source: source ?? 'agent' });

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failure registry error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
