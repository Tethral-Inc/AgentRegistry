/**
 * `acknowledge_signal` — operator marks an anomaly signal notification
 * as reviewed. ACR records observed deviations from cohort baseline as
 * *signals*, not verdicts; acknowledgement records that the operator
 * has seen one, not that anything is "resolved."
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { ARROW, section, truncId } from '../utils/style.js';

const inputSchema = {
  notification_id: z.string().describe('The notification ID to acknowledge'),
  agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
  reason: z.string().optional().describe('Why the signal is being acknowledged (e.g., "user reviewed and accepted risk")'),
  verbose: z.boolean().optional().describe('Render full-length notification and agent IDs instead of the truncated inline display.'),
};

type Input = {
  notification_id: string;
  agent_id?: string;
  reason?: string;
  verbose?: boolean;
};

async function acknowledgeHandler(
  apiUrl: string,
  { notification_id, agent_id, reason, verbose }: Input,
) {
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

    const data = await res.json() as {
      success?: boolean;
      acknowledged_at?: string;
      expires_at?: string;
      error?: { message: string };
    };
    if (!res.ok) {
      return { content: [{ type: 'text' as const, text: `Acknowledgement failed: ${data.error?.message ?? 'Unknown error'}` }] };
    }

    // Render the state transition. Even though acknowledgement is a
    // boolean flip rather than a counts diff, operators benefit from
    // seeing the before→after shape — it mirrors update_composition's
    // format so every mutation response reads the same way.
    const nowIso = data.acknowledged_at ?? new Date().toISOString();
    const expiresIso = data.expires_at ?? null;

    let text = `Notification acknowledged.\n\n`;
    text += `${section('Diff')}\n`;
    text += `  Notification: ${truncId(notification_id, { verbose })}\n`;
    text += `  State:        unacknowledged ${ARROW} acknowledged\n`;
    text += `  At:           ${nowIso}\n`;
    if (expiresIso) {
      text += `  Expires:      ${expiresIso} (30 days)\n`;
    } else {
      text += `  Expires:      30 days from now\n`;
    }
    if (reason) {
      text += `  Reason:       ${reason}\n`;
    }
    text += `  Agent:        ${truncId(resolvedId, { verbose })}\n`;

    text += '\nThe anomaly signals remain visible across the network. This acknowledgement records that you and your operator have reviewed the observation.\n';

    return { content: [{ type: 'text' as const, text }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { content: [{ type: 'text' as const, text: `Acknowledgement error: ${msg}` }] };
  }
}

export function acknowledgeSignalTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'acknowledge_signal',
    {
      description: 'Acknowledge an anomaly signal notification after reviewing it with your operator. Records that the notification has been reviewed. Acknowledgements expire after 30 days. Does not remove the observation from the network — only records that you have reviewed the signal.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async (input) => acknowledgeHandler(apiUrl, input as Input),
  );
}
