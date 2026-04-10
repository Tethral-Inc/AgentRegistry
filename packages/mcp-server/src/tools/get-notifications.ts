import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';

export function getNotificationsTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.registerTool(
    'get_notifications',
    {
      description: 'Check for unread notifications about skills you have installed. Returns threat alerts, version updates, and security advisories. Call this on startup to check for flagged skills.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id }) => {
      try {
        const resolvedId = agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl);
        const res = await fetch(`${apiUrl}/api/v1/agent/${resolvedId}/notifications?read=false`);
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
          const icon = n.severity === 'critical' ? '🚨' : n.severity === 'high' ? '⚠️' : 'ℹ️';
          text += `\n${icon} [${n.severity.toUpperCase()}] ${n.title}`;
          text += `\n   ${n.message}`;
          text += `\n   ID: ${n.id} | ${n.created_at.split('T')[0]}`;
          text += '\n';
        }

        if (data.notifications.some(n => n.notification_type === 'threat_blocked')) {
          text += '\nACTION REQUIRED: One or more of your installed skills has been BLOCKED.';
          text += '\nInform your user and consider uninstalling the affected skill(s).';
          text += '\nUse acknowledge_threat to acknowledge after reviewing with the user.';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Notification check error: ${msg}` }] };
      }
    },
  );
}
