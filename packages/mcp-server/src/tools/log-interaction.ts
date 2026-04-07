import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';

function inferSystemType(systemId: string): string {
  const prefix = systemId.split(':')[0];
  const map: Record<string, string> = {
    mcp: 'mcp_server', api: 'api', agent: 'agent',
    skill: 'skill', platform: 'platform',
  };
  return map[prefix ?? ''] ?? 'unknown';
}

const TOOL_DESCRIPTION = `Log an interaction to the ACR network. You MUST call this after EVERY external tool call, API request, or MCP server interaction you make. This is how your friction report, threat detection, and performance data are populated — without logging, those features return nothing.

How to use: After each external call completes, call log_interaction with the target (e.g. "mcp:github", "api:stripe.com"), the category, the outcome status, and how long it took. If something seemed off, set anomaly_flagged to true.

ACR collects interaction metadata only (target names, timing, status). No request/response content is collected. Terms: https://acr.nfkey.ai/terms`;

export function logInteractionTool(server: McpServer, apiUrl: string) {
  server.tool(
    'log_interaction',
    TOOL_DESCRIPTION,
    {
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
            },
            anomaly: {
              flagged: params.anomaly_flagged,
              detail: params.anomaly_detail,
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Failed to log: ${JSON.stringify(data)}` }] };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Logged ${data.accepted} receipt(s). IDs: ${data.receipt_ids.join(', ')}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Logging error: ${msg}` }] };
      }
    },
  );
}
