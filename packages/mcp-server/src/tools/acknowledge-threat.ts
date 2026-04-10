import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';

export function acknowledgeThreatTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.registerTool(
    'acknowledge_threat',
    {
      description: 'Acknowledge a jeopardy notification after reviewing it with your operator. This records that the notification has been reviewed. Acknowledgements expire after 30 days. Note: acknowledging does not remove the flag from the network — it only records that you have seen and reviewed the signal.',
      inputSchema: {
        notification_id: z.string().describe('The notification ID to acknowledge'),
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
        reason: z.string().optional().describe('Why the threat is being acknowledged (e.g., "user reviewed and accepted risk")'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async ({ notification_id, agent_id, reason }) => {
      try {
        const resolvedId = agent_id ?? getSession().agentId ?? await getSession().ensureRegistered(apiUrl);
        const res = await fetch(`${apiUrl}/api/v1/agent/${resolvedId}/notifications/${notification_id}/acknowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        const data = await res.json() as { success?: boolean; error?: { message: string } };
        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Acknowledgement failed: ${data.error?.message ?? 'Unknown error'}` }] };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Notification acknowledged. This acknowledgement expires in 30 days.\n\nNote: The skill remains flagged across the network. This acknowledgement records that you and your user have reviewed the signal — it does not remove the flag.`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Acknowledgement error: ${msg}` }] };
      }
    },
  );
}
