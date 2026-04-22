/**
 * `acknowledge_signal` + `acknowledge_threat` — dual-registered for a
 * 90-day deprecation window.
 *
 * ACR has always recorded "anomalies" as *signals* — observed
 * deviations from cohort baseline, not verdicts. The old tool name
 * `acknowledge_threat` leaked a synthetic verdict label into the
 * operator's vocabulary: "threat" implies ACR decided something is
 * bad, when the raw data is just an observation. The rename to
 * `acknowledge_signal` aligns the tool surface with how the rest of
 * the codebase already talks (`anomaly_signal_count`,
 * `skill_signals`, `anomaly_rate`, etc.).
 *
 * Deprecation plan:
 *   - v2.7.0 (this release): both names registered. `threat` stamps
 *     a deprecation banner on its output. Descriptions tell callers
 *     which to use going forward.
 *   - v2.7.0 + 90 days: `acknowledge_threat` removed. Anyone still
 *     calling it gets an InputValidationError, which is the correct
 *     failure mode for "the tool is gone".
 *
 * Both tools share one handler because their semantics are
 * identical — the rename is purely vocabulary. Descriptions and
 * banners differ; behavior does not.
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

/**
 * Shared handler. `deprecationBanner` gets prepended to the success
 * output only — error paths don't need the banner because the
 * caller already has a problem to fix before the deprecation
 * matters.
 */
async function acknowledgeHandler(
  apiUrl: string,
  { notification_id, agent_id, reason, verbose }: Input,
  deprecationBanner = '',
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

    let text = `${deprecationBanner}Notification acknowledged.\n\n`;
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

/**
 * New canonical name — `acknowledge_signal`. Matches the rest of the
 * codebase's vocabulary (`anomaly_signal`, `skill_signals`).
 */
export function acknowledgeSignalTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'acknowledge_signal',
    {
      description: 'Acknowledge an anomaly signal notification after reviewing it with your operator. Records that the notification has been reviewed. Acknowledgements expire after 30 days. Does not remove the observation from the network — only records that you have reviewed the signal. Replaces `acknowledge_threat` (same behavior, aligned terminology).',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async (input) => acknowledgeHandler(apiUrl, input as Input),
  );
}

/**
 * Legacy name — kept for 90 days so existing agent code doesn't break
 * on upgrade. Identical behavior, deprecation banner on success.
 * Remove no earlier than v2.7.0 + 90 days.
 */
export function acknowledgeThreatTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'acknowledge_threat',
    {
      description: 'DEPRECATED since v2.7.0 — call `acknowledge_signal` instead. Behavior is identical; the rename aligns with how the rest of the ACR codebase talks ("signal", not "threat"). This shim will be removed no earlier than 90 days after v2.7.0.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      // Priority dropped so hosts sorting by priorityHint surface the
      // canonical tool first.
      _meta: { priorityHint: 0.1, deprecated: true, replacedBy: 'acknowledge_signal', deprecatedSince: '2.7.0' },
    },
    async (input) => acknowledgeHandler(
      apiUrl,
      input as Input,
      `NOTE: acknowledge_threat is deprecated since v2.7.0. Call \`acknowledge_signal\` — same behavior, aligned terminology.\n\n`,
    ),
  );
}
