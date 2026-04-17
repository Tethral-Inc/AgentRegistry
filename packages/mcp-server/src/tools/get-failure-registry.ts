import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

export function getFailureRegistryTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_failure_registry',
    {
      description: 'Failure registry: per-target breakdown of failures — status codes, error codes, categories, and median duration when failed. Shows where your interactions are failing and how.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        scope: z.enum(['day', 'yesterday', 'week', 'month']).optional().default('week').describe('Time window'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
    async ({ agent_id, agent_name, scope }) => {
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
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/failure-registry?scope=${scope}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Failure registry error: ${errText}` }] };
        }
        const data = await res.json() as Record<string, unknown>;
        displayName = (data.name as string) || agent_name || getAgentName() || displayName;

        const failures = data.failures as Array<Record<string, unknown>> ?? [];

        let text = `Failure Registry for ${displayName} (${scope})\n${'='.repeat(30)}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Total interactions: ${data.total_interactions}\n`;
        text += `Total failures: ${data.total_failures}\n`;
        text += `Failure rate: ${((data.failure_rate as number) * 100).toFixed(1)}%\n`;
        text += `Distinct failing targets: ${data.distinct_failing_targets}\n`;

        if (failures.length === 0) {
          text += `\nNo failures recorded in this period.\n`;
        } else {
          for (const f of failures) {
            text += `\n  ${f.target_system_id} (${f.target_system_type})\n`;
            text += `    total failures: ${f.total_count}\n`;

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

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failure registry error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
