/**
 * `set_watch` — register a persistent lens threshold.
 *
 * Phase K of the v2.5.0 – v2.9.0 roadmap. Watches are evaluated hourly
 * by the `watch-evaluation` cron. On a fresh crossing (not a persistent
 * breach), a notification is written and `get_notifications` picks it up
 * alongside anomaly signals.
 *
 * Scope (v1) — the (lens, metric) matrix accepted here is the narrow
 * set where a scalar threshold is meaningful:
 *   - friction.failure_rate        (0.0 – 1.0)
 *   - friction.proportion_of_wait  (0.0 – 1.0)
 *   - trend.failure_rate_delta     (percentage points, e.g. 0.05 = +5pp)
 * Other lens/metric combinations are rejected at the server; this tool
 * keeps the zod enum in sync so the operator sees the constraint up
 * front rather than as a 400.
 *
 * A second call with the same (lens, target, metric, condition) updates
 * the threshold in place. That matches the operator's likely intent:
 * "I want to change the line I drew earlier," not "I want two watches
 * for the same line."
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { ARROW, section, truncId } from '../utils/style.js';

const LENSES = ['friction', 'trend'] as const;
const METRICS = ['failure_rate', 'proportion_of_wait', 'failure_rate_delta'] as const;
const CONDITIONS = ['above', 'below'] as const;

const inputSchema = {
  lens: z.enum(LENSES).describe('Lens the watch is attached to. "friction" covers same-window targets; "trend" covers week-over-week deltas.'),
  target_system_id: z.string().describe('Target being watched, as it appears in receipts (e.g. "api:slack.com", "mcp:filesystem").'),
  metric: z.enum(METRICS).describe('Scalar to threshold. failure_rate: 0.0-1.0. proportion_of_wait: 0.0-1.0. failure_rate_delta: percentage-points (0.05 = +5pp).'),
  threshold: z.number().describe('Number to compare against. Interpreted in the metric\'s units.'),
  condition: z.enum(CONDITIONS).optional().default('above').describe('"above" fires when metric > threshold (default). "below" fires when metric < threshold.'),
  agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
  verbose: z.boolean().optional().describe('Render full-length agent ID instead of the truncated display.'),
};

type Input = {
  lens: typeof LENSES[number];
  target_system_id: string;
  metric: typeof METRICS[number];
  threshold: number;
  condition?: typeof CONDITIONS[number];
  agent_id?: string;
  verbose?: boolean;
};

function formatThreshold(metric: Input['metric'], threshold: number): string {
  if (metric === 'failure_rate_delta') {
    const sign = threshold >= 0 ? '+' : '';
    return `${sign}${(threshold * 100).toFixed(1)}pp`;
  }
  return `${(threshold * 100).toFixed(1)}%`;
}

export function setWatchTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'set_watch',
    {
      description: 'Register a persistent threshold on a lens metric. Evaluated hourly; a fresh crossing writes a notification that surfaces in get_notifications. Scope (v1): friction.failure_rate, friction.proportion_of_wait, trend.failure_rate_delta on a specific target_system_id. Calling set_watch again with the same (lens, target, metric, condition) updates the threshold in place.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ lens, target_system_id, metric, threshold, condition, agent_id, verbose }: Input) => {
      let resolvedId: string;
      try {
        resolvedId = agent_id ?? getAgentId() ?? await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return { content: [{ type: 'text' as const, text: err.userMessage() }], isError: true };
        }
        throw err;
      }

      const finalCondition = condition ?? 'above';

      try {
        const res = await fetchAuthed(
          `${apiUrl}/api/v1/agent/${resolvedId}/watches`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lens,
              target_system_id,
              metric,
              threshold,
              condition: finalCondition,
            }),
          },
        );
        const data = await res.json() as {
          success?: boolean;
          error?: { message: string; code?: string };
        };

        if (!res.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `Watch create failed: ${data.error?.message ?? 'Unknown error'}`,
            }],
          };
        }

        let text = 'Watch registered.\n\n';
        text += `${section('Diff')}\n`;
        text += `  Agent:     ${truncId(resolvedId, { verbose })}\n`;
        text += `  Lens:      ${lens}\n`;
        text += `  Target:    ${target_system_id}\n`;
        text += `  Metric:    ${metric}\n`;
        text += `  Condition: ${finalCondition} ${formatThreshold(metric, threshold)}\n`;
        text += `\nEvaluated hourly. On a fresh crossing (not a persistent breach), a notification is written — call get_notifications to read it, or list_watches to see every watch you have registered.\n`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Watch error: ${msg}` }] };
      }
    },
  );
}

export function listWatchesTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'list_watches',
    {
      description: 'List your registered watches — (lens, target, metric, threshold, condition) plus when each was last evaluated and last matched. Use this to see what\'s currently being watched before registering a new one with set_watch.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
        include_disabled: z.boolean().optional().describe('Include watches that have been disabled. Default: false.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.4 },
    },
    async ({ agent_id, include_disabled }) => {
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
        const enabledParam = include_disabled ? 'false' : 'true';
        const res = await fetchAuthed(
          `${apiUrl}/api/v1/agent/${resolvedId}/watches?enabled=${enabledParam}`,
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `list_watches error: ${errText}` }] };
        }
        const data = await res.json() as {
          watches: Array<{
            id: string;
            lens: string;
            target_system_id: string;
            metric: string;
            threshold: number;
            condition: string;
            enabled: boolean;
            last_evaluated_at: string | null;
            last_matched_at: string | null;
            created_at: string;
          }>;
        };

        if (data.watches.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No watches registered. Call set_watch to register one — e.g. set_watch(lens="friction", target_system_id="api:slack.com", metric="failure_rate", threshold=0.2, condition="above") to be notified when slack\'s failure rate crosses 20%.' }] };
        }

        let text = `Registered Watches (${data.watches.length})\n${'='.repeat(30)}\n\n`;
        for (const w of data.watches) {
          text += `${w.lens}.${w.metric} on ${w.target_system_id}\n`;
          text += `  ${w.condition} ${(w.threshold * 100).toFixed(1)}${w.metric === 'failure_rate_delta' ? 'pp' : '%'}`;
          if (!w.enabled) text += '  [disabled]';
          text += '\n';
          if (w.last_matched_at) {
            text += `  last matched: ${w.last_matched_at}\n`;
          } else if (w.last_evaluated_at) {
            text += `  last evaluated: ${w.last_evaluated_at} (no match yet)\n`;
          } else {
            text += `  not yet evaluated\n`;
          }
          text += '\n';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `list_watches error: ${msg}` }] };
      }
    },
  );
}
