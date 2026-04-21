import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAuthHeaders } from '../state.js';
import { defaultSession } from '../session-state.js';
import type { CorrelationWindow } from '../middleware/correlation-window.js';

function inferSystemType(systemId: string): string {
  const prefix = systemId.split(':')[0];
  const map: Record<string, string> = {
    mcp: 'mcp_server', api: 'api', agent: 'agent',
    skill: 'skill', platform: 'platform',
  };
  return map[prefix ?? ''] ?? 'unknown';
}

const TOOL_DESCRIPTION = `Log an interaction to populate your ACR interaction profile. You MUST call this after EVERY external tool call, API request, or MCP server interaction you make. Every lens on your profile (friction, and more to come) depends on these signals — without logging, the lenses return nothing.

How to use: After each external call completes, call log_interaction with the target (e.g. "mcp:github", "api:stripe.com"), the category, the outcome status, and how long it took. If something seemed off, set anomaly_flagged to true — anomaly signals feed both your own lens views and the network's anomaly signal notifications.

For multi-step workflows, use chain_id, chain_position, and preceded_by to link sequential calls so the friction lens can analyze chain overhead and directional friction between targets.

Classification fields (all optional, all content-free): set activity_class ("language", "math", "visuals", "creative", "deterministic", "sound") and other category fields (target_type, interaction_purpose, workflow_role, workflow_phase, data_shape, criticality) to describe the kind of work this call represents. Richer classification unlocks friction breakdowns by kind-of-work, which matters as agents specialize.

ACR collects interaction metadata only (target names, timing, status, descriptive classifications). No request/response content is collected. We do not track the agent's owner. Terms: https://acr.nfkey.ai/terms`;

export function logInteractionTool(
  server: McpServer,
  apiUrl: string,
  correlationWindow?: CorrelationWindow,
) {
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
        preceded_by: z.string().optional().describe("The target_system_id of the immediately preceding call in a multi-step chain (e.g. 'api:openai.com'). Use this to link sequential calls so ACR can compute directional amplification — how much slower a call becomes when preceded by another. Pass the target of the previous step, not a receipt ID."),
        // Category classification (all optional, all descriptive, all non-content)
        target_type: z.string().max(64).optional().describe('More granular target type, e.g. "api.llm_provider", "api.payment", "mcp.database".'),
        activity_class: z.string().max(32).optional().describe('Kind of work the call represents. Examples: language, math, visuals, creative, deterministic, sound. Expandable — add new values as they emerge.'),
        interaction_purpose: z.string().max(32).optional().describe('What the agent was trying to accomplish. Examples: read, write, search, generate, transform, acknowledge.'),
        workflow_role: z.string().max(32).optional().describe('Where this call sits in the broader workflow. Examples: initial, intermediate, recovery, cleanup.'),
        workflow_phase: z.string().max(32).optional().describe('If the agent runs in phases. Examples: plan, act, reflect.'),
        data_shape: z.string().max(32).optional().describe('Content-free description of what kind of data moved. Examples: tabular, text, binary, structured_json, stream, image, audio.'),
        criticality: z.string().max(32).optional().describe('How essential this call was to the workflow. Examples: core, enrichment, debug.'),
        tokens_used: z.number().int().min(0).optional().describe('Total tokens used in this interaction (input + output). Optional — enables wasted-token callouts in the friction report.'),
        // Capture-surface expansion. All optional. Reporting these now
        // seeds future lenses (substitution graph, decision-cost,
        // wasted-attention, contextual cost, prompt-cache efficiency).
        substitution_of: z.string().max(200).optional().describe("When this call replaces a preceding failed call to a different target, pass the replaced target_system_id here (e.g. 'api:openai.com'). Seeds the substitution-graph lens."),
        decision_tokens: z.number().int().min(0).optional().describe("Tokens spent deciding *which* target to call, separate from the target call itself. Useful for agents that run reasoning before routing."),
        result_used: z.boolean().optional().describe("Did the agent actually use the response? Set false if the response was discarded (e.g. wrong shape, low quality). Seeds the wasted-attention lens."),
        context_bytes: z.number().int().min(0).optional().describe("Context payload size in bytes shipped to the target. Enables per-target context-cost analysis."),
        prompt_cache_hit_ratio: z.number().min(0).max(1).optional().describe("Fraction of prompt cached (0..1). Pass when the provider reports it."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.9 },
    },
    async (params) => {
      try {
        const id = params.agent_id || getAgentId() || await ensureRegistered();
        const nowMs = Date.now();

        // Consult the correlation window for an automatic preceded_by link
        // if the agent didn't supply one explicitly. The window is a passive
        // buffer: it doesn't analyze, it just holds recent receipts' chain
        // context so in-flight workflows can be stitched at ingest time.
        // If the agent explicitly provided preceded_by, that wins.
        let precededBy = params.preceded_by;
        if (!precededBy && correlationWindow && params.chain_id) {
          const found = correlationWindow.findPrecededBy(params.chain_id, nowMs);
          if (found) precededBy = found;
        }

        // Collect category fields into a categories object. Only include
        // fields the caller actually set. Empty object if none were set.
        const categories: Record<string, string> = {};
        if (params.target_type) categories.target_type = params.target_type;
        if (params.activity_class) categories.activity_class = params.activity_class;
        if (params.interaction_purpose) categories.interaction_purpose = params.interaction_purpose;
        if (params.workflow_role) categories.workflow_role = params.workflow_role;
        if (params.workflow_phase) categories.workflow_phase = params.workflow_phase;
        if (params.data_shape) categories.data_shape = params.data_shape;
        if (params.criticality) categories.criticality = params.criticality;

        const res = await fetch(`${apiUrl}/api/v1/receipts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            emitter: {
              agent_id: id,
              provider_class: defaultSession.providerClass,
            },
            target: {
              system_id: params.target_system_id,
              system_type: inferSystemType(params.target_system_id),
            },
            interaction: {
              category: params.category,
              status: params.status,
              duration_ms: params.duration_ms,
              request_timestamp_ms: nowMs - (params.duration_ms ?? 0),
              queue_wait_ms: params.queue_wait_ms,
              retry_count: params.retry_count,
              error_code: params.error_code,
              response_size_bytes: params.response_size_bytes,
              tokens_used: params.tokens_used,
              substitution_of: params.substitution_of,
              decision_tokens: params.decision_tokens,
              result_used: params.result_used,
              context_bytes: params.context_bytes,
              prompt_cache_hit_ratio: params.prompt_cache_hit_ratio,
            },
            anomaly: {
              flagged: params.anomaly_flagged,
              detail: params.anomaly_detail,
            },
            transport_type: defaultSession.transportType,
            source: 'agent' as const,
            chain_id: params.chain_id,
            chain_position: params.chain_position,
            preceded_by: precededBy,
            categories: Object.keys(categories).length > 0 ? categories : undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `Failed to log: ${JSON.stringify(data)}` }] };
        }

        // Record the receipt's correlation keys into the window so the
        // next in-flight receipt in the same chain can find it.
        // Only record if we have a chain_id — receipts without a chain
        // don't participate in in-flight linkage.
        if (correlationWindow && params.chain_id && Array.isArray(data.receipt_ids)) {
          for (const receiptId of data.receipt_ids) {
            correlationWindow.record({
              receipt_id: String(receiptId),
              chain_id: params.chain_id,
              target_system_id: params.target_system_id,
              created_at_ms: nowMs,
            });
          }
        }

        let text = `Logged ${data.accepted} receipt(s). IDs: ${data.receipt_ids.join(', ')}`;

        // Surface raw anomaly signals for any skill targets in this
        // receipt. No synthetic severity label — the MCP just renders
        // the counts and rates the server observed. Operator reads the
        // numbers and decides.
        if (data.skill_signals && Array.isArray(data.skill_signals) && data.skill_signals.length > 0) {
          text += '\n\nSkill signals (raw anomaly stats from the network):';
          for (const s of data.skill_signals) {
            const ratePct = typeof s.anomaly_signal_rate === 'number'
              ? (s.anomaly_signal_rate * 100).toFixed(1)
              : '0.0';
            text += `\n  ${s.target}`;
            if (s.skill_name) text += ` (${s.skill_name})`;
            text += `: ${s.anomaly_signal_count} anomaly signals across ${s.agent_count} agents (${ratePct}% rate)`;
            if (s.last_updated_at) text += `, last updated ${s.last_updated_at}`;
          }
        }

        // Report composition age when the server supplies it. No
        // threshold — the server returns the raw age and the MCP decides
        // how to present it. For now we surface the number whenever it's
        // present so the operator can see it.
        if (typeof data.composition_last_updated_minutes_ago === 'number') {
          text += `\n\n[ACR] Composition last updated ${data.composition_last_updated_minutes_ago} minute(s) ago.`;
          text += ' If you have loaded or unloaded skills, MCPs, or tools since then, call update_composition.';
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
