import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { defaultSession } from '../session-state.js';

function inferSystemType(systemId: string): string {
  const prefix = systemId.split(':')[0];
  const map: Record<string, string> = {
    mcp: 'mcp_server', api: 'api', agent: 'agent',
    skill: 'skill', platform: 'platform',
  };
  return map[prefix ?? ''] ?? 'unknown';
}

const TOOL_DESCRIPTION = `Log an interaction to populate your ACR interaction profile. You MUST call this after EVERY external tool call, API request, or MCP server interaction you make. Every lens on your profile (friction, and more to come) depends on these signals — without logging, the lenses return nothing.

How to use: After each external call completes, call log_interaction with the target (e.g. "mcp:github", "api:stripe.com"), the category, the outcome status, and how long it took. If something seemed off, set anomaly_flagged to true — anomaly signals feed both your own lens views and the network's jeopardy notifications.

For multi-step workflows, use chain_id, chain_position, and preceded_by to link sequential calls so the friction lens can analyze chain overhead and directional friction between targets.

ACR collects interaction metadata only (target names, timing, status). No request/response content is collected. We do not track the agent's owner. Terms: https://acr.nfkey.ai/terms`;

export function logInteractionTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'log_interaction',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        target_system_id: z.string().describe('Target in type:name format (e.g., mcp:github, api:stripe.com, mcp:filesystem)'),
        category: z.enum([
          'tool_call', 'delegation', 'data_exchange', 'skill_install',
          'commerce', 'research', 'code', 'communication',
        ]).describe('Interaction category. Use "tool_call" for MCP tool calls and API requests.'),
        status: z.enum(['success', 'failure', 'timeout', 'partial']).describe('Outcome of the interaction'),
        duration_ms: z.number().nonnegative().optional().default(0).describe('Duration in ms (0 if unknown)'),
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        anomaly_flagged: z.boolean().optional().default(false).describe('Set true if something seemed wrong (unexpected behavior, suspicious output, excessive latency)'),
        anomaly_detail: z.string().max(500).optional().describe('What seemed wrong. DO NOT include credentials or API keys.'),
        queue_wait_ms: z.number().nonnegative().optional().describe('Time spent waiting in queue before execution (ms)'),
        retry_count: z.number().nonnegative().optional().default(0).describe('Number of retries (0 = no retries)'),
        error_code: z.string().max(50).optional().describe('Error code if failed (e.g., "429", "TIMEOUT", "ECONNREFUSED")'),
        response_size_bytes: z.number().nonnegative().optional().describe('Response payload size in bytes'),
        chain_id: z.string().max(64).optional().describe('ID linking sequential calls in a chain. Same chain_id for all calls in a multi-step workflow.'),
        chain_position: z.number().nonnegative().optional().describe('Position in chain (0-indexed). First call = 0, second = 1.'),
        preceded_by: z.string().optional().describe('target_system_id of the call that immediately preceded this one.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.9 },
    },
    async (params) => {
      try {
        const id = params.agent_id || getAgentId() || await ensureRegistered();

        const res = await fetch(`${apiUrl}/api/v1/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emitter: {
              agent_id: id,
              provider_class: 'unknown',
            },
            target: {
              system_id: params.target_system_id,
              system_type: inferSystemType(params.target_system_id),
            },
            interaction: {
              category: params.category,
              status: params.status,
              duration_ms: params.duration_ms,
              request_timestamp_ms: Date.now() - (params.duration_ms ?? 0),
              queue_wait_ms: params.queue_wait_ms,
              retry_count: params.retry_count,
              error_code: params.error_code,
              response_size_bytes: params.response_size_bytes,
            },
            anomaly: {
              flagged: params.anomaly_flagged,
              detail: params.anomaly_detail,
            },
            transport_type: defaultSession.transportType,
            source: 'agent' as const,
            chain_id: params.chain_id,
            chain_position: params.chain_position,
            preceded_by: params.preceded_by,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Failed to log: ${JSON.stringify(data)}` }] };
        }

        let text = `Logged ${data.accepted} receipt(s). IDs: ${data.receipt_ids.join(', ')}`;

        // Surface threat warnings from receipt response
        if (data.threat_warnings && Array.isArray(data.threat_warnings) && data.threat_warnings.length > 0) {
          text += '\n\nWARNING — Threat alerts for targets in this interaction:';
          for (const w of data.threat_warnings) {
            text += `\n  ${w.target}: ${w.threat_level.toUpperCase()}`;
            if (w.skill_name) text += ` (${w.skill_name})`;
          }
          text += '\n\nExercise caution with flagged skills. Check with the user before continuing.';
        }

        return {
          content: [{
            type: 'text' as const,
            text,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Logging error: ${msg}` }] };
      }
    },
  );
}
