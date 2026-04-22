import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';

export function acknowledgeThreatTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'acknowledge_threat',
    {
      description: 'Acknowledge an anomaly signal notification after reviewing it with your operator. This records that the notification has been reviewed. Acknowledgements expire after 30 days. Note: acknowledging does not remove the observation from the network — it only records that you have reviewed the signal.',
      inputSchema: {
        notification_id: z.string().describe('The notification ID to acknowledge'),
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
        reason: z.string().optional().describe('Why the threat is being acknowledged (e.g., "user reviewed and accepted risk")'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async ({ notification_id, agent_id, reason }) => {
      let resolvedId: string;
      try {
        resolvedId = agent_id ?? getAgentId() ?? await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return {
            content: [{ type: 'text' as const, text: err.userMessage() }],
            isError: true,
          };
        }
        throw err;
      }

      try {
        const res = await fetchAuthed(`${apiUrl}/api/v1/agent/${resolvedId}/notifications/${notification_id}/acknowledge`, {
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
            text: `Notification acknowledged. This acknowledgement expires in 30 days.\n\nNote: The anomaly signals remain visible across the network. This acknowledgement records that you and your operator have reviewed the observation.`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Acknowledgement error: ${msg}` }] };
      }
    },
  );
}
