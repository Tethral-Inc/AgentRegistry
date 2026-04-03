import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function logInteractionTool(server: McpServer, apiUrl: string) {
  server.tool(
    'log_interaction',
    'Log an interaction receipt to the ACR network. Call this after interacting with any external tool, API, or service.',
    {
      agent_id: z.string().describe('Your registered ACR agent ID'),
      provider_class: z.enum([
        'anthropic', 'openai', 'google', 'openclaw', 'langchain',
        'crewai', 'autogen', 'custom', 'unknown',
      ]).describe('Agent provider/framework'),
      target_system_id: z.string().describe('Target in type:name format (e.g., mcp:github, api:stripe.com)'),
      target_system_type: z.enum(['mcp_server', 'api', 'agent', 'skill', 'platform', 'unknown']).describe('Type of target system'),
      category: z.enum([
        'tool_call', 'delegation', 'data_exchange', 'skill_install',
        'commerce', 'research', 'code', 'communication',
      ]).describe('Interaction category'),
      status: z.enum(['success', 'failure', 'timeout', 'partial']).describe('Outcome of the interaction'),
      duration_ms: z.number().nonnegative().describe('How long the interaction took in milliseconds'),
      anomaly_flagged: z.boolean().optional().default(false).describe('Whether this interaction seemed anomalous'),
      anomaly_category: z.string().optional().describe('Type of anomaly if flagged'),
      anomaly_detail: z.string().max(500).optional().describe('Brief description of what seemed wrong'),
    },
    async (params) => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emitter: {
              agent_id: params.agent_id,
              provider_class: params.provider_class,
            },
            target: {
              system_id: params.target_system_id,
              system_type: params.target_system_type,
            },
            interaction: {
              category: params.category,
              status: params.status,
              duration_ms: params.duration_ms,
              request_timestamp_ms: Date.now() - params.duration_ms,
            },
            anomaly: {
              flagged: params.anomaly_flagged,
              category: params.anomaly_category,
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
