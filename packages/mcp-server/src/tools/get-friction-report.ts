import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';

export function getFrictionReportTool(server: McpServer, apiUrl: string) {
  server.tool(
    'get_friction_report',
    "Get a friction analysis report showing what's costing this agent the most time and money. Shows which external systems are the biggest bottlenecks. This is a read-only query of your own data.",
    {
      agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
      scope: z.enum(['session', 'day', 'week']).optional().default('day').describe('Time window for the report'),
    },
    async ({ agent_id, scope }) => {
      const id = agent_id || getAgentId() || await ensureRegistered();
      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=${scope}`);
        const data = await res.json();

        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        const s = data.summary;

        if (s.total_interactions === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No interactions recorded for scope "${scope}". Start logging interactions to see friction data.`,
            }],
          };
        }

        let text = `Friction Report (${scope})\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n\n`;
        text += `Total interactions: ${s.total_interactions}\n`;
        text += `Total wait time: ${(s.total_wait_time_ms / 1000).toFixed(1)}s\n`;
        text += `Friction: ${s.friction_percentage.toFixed(2)}% of active time spent waiting\n`;
        text += `Failures: ${s.total_failures} (${(s.failure_rate * 100).toFixed(1)}% failure rate)\n`;

        if (data.top_targets && data.top_targets.length > 0) {
          text += `\nTop Bottlenecks:\n`;
          for (const t of data.top_targets) {
            const pct = (t.proportion_of_total * 100).toFixed(1);
            text += `\n  ${t.target_system_id}\n`;
            text += `    ${pct}% of wait time | ${t.interaction_count} calls | median ${t.median_duration_ms}ms\n`;
            if (t.failure_count > 0) {
              text += `    ${t.failure_count} failures\n`;
            }
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Friction report error: ${msg}` }] };
      }
    },
  );
}
