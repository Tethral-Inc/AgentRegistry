/**
 * `dismiss_pattern` — operator-facing dismissal for a proactive pattern.
 *
 * Phase J surfaces pattern detections on `get_my_agent` and `whats_new`
 * under a "Things we noticed" section. Each line includes a footer
 * pointing at this tool. Dismissal sets `dismissed_at` on the pattern
 * row; the cron detector preserves dismissed rows so the pattern
 * doesn't resurrect on the next pass.
 *
 * Reason is optional but strongly encouraged — it feeds into future
 * calibration work (are operators dismissing for "not useful" vs
 * "already fixed"?). The server accepts any free-form string and
 * doesn't validate the content.
 *
 * The response follows the mutation-diff convention established in
 * Phase H: show the state transition plainly so the operator sees
 * what happened.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { ARROW, section, truncId } from '../utils/style.js';

const KNOWN_TYPES = ['composition_staleness', 'retry_burst', 'lens_call_spike', 'skill_version_drift'] as const;

const inputSchema = {
  pattern_type: z.enum(KNOWN_TYPES).describe('Which pattern to dismiss. Must match a pattern the server currently surfaces on get_my_agent or whats_new.'),
  agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
  reason: z.string().optional().describe('Why this pattern isn\'t useful (e.g., "already planned", "not applicable to my setup"). Optional but helps calibrate future surfacing.'),
  verbose: z.boolean().optional().describe('Render full-length agent ID instead of the truncated inline display.'),
};

type Input = {
  pattern_type: typeof KNOWN_TYPES[number];
  agent_id?: string;
  reason?: string;
  verbose?: boolean;
};

export function dismissPatternTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'dismiss_pattern',
    {
      description: 'Dismiss a proactive pattern surfaced on get_my_agent or whats_new. The pattern won\'t appear again even if the underlying condition persists. Pass the pattern_type shown in the "Things we noticed" footer. Optional reason helps ACR calibrate which patterns operators find actionable.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async ({ pattern_type, agent_id, reason, verbose }: Input) => {
      let resolvedId: string;
      try {
        resolvedId = agent_id ?? getAgentId() ?? await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return { content: [{ type: 'text' as const, text: err.userMessage() }], isError: true };
        }
        throw err;
      }

      try {
        const res = await fetchAuthed(
          `${apiUrl}/api/v1/agent/${resolvedId}/patterns/${pattern_type}/dismiss`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
          },
        );
        const data = await res.json() as {
          success?: boolean;
          pattern_type?: string;
          error?: { message: string; code?: string };
        };

        if (!res.ok) {
          if (res.status === 404) {
            return {
              content: [{
                type: 'text' as const,
                text: `No active pattern of type "${pattern_type}" to dismiss — it either never fired or was already dismissed. Call get_my_agent to see current patterns.`,
              }],
            };
          }
          return {
            content: [{
              type: 'text' as const,
              text: `Dismiss failed: ${data.error?.message ?? 'Unknown error'}`,
            }],
          };
        }

        let text = `Pattern dismissed.\n\n`;
        text += `${section('Diff')}\n`;
        text += `  Pattern: ${pattern_type}\n`;
        text += `  State:   active ${ARROW} dismissed\n`;
        text += `  Agent:   ${truncId(resolvedId, { verbose })}\n`;
        if (reason) text += `  Reason:  ${reason}\n`;
        text += '\nThe pattern-detection cron will preserve your dismissal on subsequent passes — the pattern won\'t resurrect if the condition persists.\n';

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Dismiss error: ${msg}` }] };
      }
    },
  );
}
