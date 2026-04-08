import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SessionState } from '../session-state.js';

export function acknowledgeThreatTool(server: McpServer, apiUrl: string, getSession: () => SessionState) {
  server.tool(
    'acknowledge_threat',
    'Acknowledge a threat notification after reviewing it with the user. This records that the threat has been reviewed. Acknowledgements expire after 30 days.',
    {
      notification_id: z.string().describe('The notification ID to acknowledge'),
      agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
      reason: z.string().optional().describe('Why the threat is being acknowledged (e.g., "user reviewed and accepted risk")'),
    },
    { readOnlyHint: false, destructiveHint: false },
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
            text: `Threat acknowledged. This acknowledgement expires in 30 days.\n\nNote: The skill remains blocked globally. This acknowledgement records that you and your user have reviewed the threat.`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Acknowledgement error: ${msg}` }] };
      }
    },
  );
}
