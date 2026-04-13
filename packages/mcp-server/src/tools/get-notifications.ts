import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAuthHeaders } from '../state.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';

export function getNotificationsTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.registerTool(
    'get_notifications',
    {
      description: 'Check for unread anomaly signal notifications about components in your composition. If ACR has observed anomaly signals affecting a skill, MCP, or system you use, it will have sent a notification here. Also delivers version updates. Call this on startup. ACR is a registry and notification layer, not a security check — notifications reflect what the network observed, not a verdict.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id }) => {
      try {
        const resolvedId = agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl);
        const res = await fetch(`${apiUrl}/api/v1/agent/${resolvedId}/notifications?read=false`, { headers: getAuthHeaders() });
        const data = await res.json() as {
          notifications: Array<{
            id: string; skill_hash: string; notification_type: string;
            severity: string; title: string; message: string; created_at: string;
          }>;
          unread_count: number;
        };

        if (data.unread_count === 0) {
          return { content: [{ type: 'text' as const, text: 'No unread notifications.' }] };
        }

        let text = `You have ${data.unread_count} unread notification(s):\n`;
        for (const n of data.notifications) {
          text += `\n[${n.severity}] ${n.title}`;
          text += `\n   ${n.message}`;
          text += `\n   ID: ${n.id} | ${n.created_at.split('T')[0]}`;
          text += '\n';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Notification check error: ${msg}` }] };
      }
    },
  );
}
