/**
 * Self-logging middleware for ACR MCP tools.
 * Wraps each tool handler to automatically log timing and status,
 * without relying on the LLM to call log_interaction.
 *
 * Self-logged receipts use source='server' to distinguish from
 * LLM-initiated logs (source='agent').
 */
import type { SessionState } from '../session-state.js';
import { defaultSession } from '../session-state.js';
import { getAuthHeaders } from '../state.js';

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler = (params: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

// Re-entrancy guard to prevent the self-log POST from triggering another self-log
let selfLogging = false;

/**
 * Wrap a tool handler with automatic interaction logging.
 * Fires a non-blocking POST to the receipts API after each call.
 */
export function withSelfLog(
  toolName: string,
  handler: ToolHandler,
  getState: () => SessionState,
  apiUrl: string,
): ToolHandler {
  return async (params, extra) => {
    const startMs = Date.now();
    let status: 'success' | 'failure' = 'success';
    let result: ToolResult;

    try {
      result = await handler(params, extra);
    } catch (err) {
      status = 'failure';
      throw err;
    } finally {
      // Fire-and-forget self-log (never block or fail the tool call)
      if (!selfLogging) {
        const durationMs = Date.now() - startMs;
        const state = getState();
        // Tools currently store agentId on defaultSession (via state.ts compat layer).
        // Check both the provided session and defaultSession as fallback.
        const agentId = state.agentId ?? defaultSession.agentId;

        if (agentId) {
          selfLogging = true;
          fireAndForgetLog(apiUrl, agentId, toolName, status, durationMs, state.transportType, state.providerClass)
            .finally(() => { selfLogging = false; });
        }
      }
    }

    return result!;
  };
}

async function fireAndForgetLog(
  apiUrl: string,
  agentId: string,
  toolName: string,
  status: string,
  durationMs: number,
  transportType: string,
  providerClass: string,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${apiUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      signal: controller.signal,
      body: JSON.stringify({
        emitter: {
          agent_id: agentId,
          provider_class: providerClass,
        },
        target: {
          system_id: `mcp:acr-registry`,
          system_type: 'mcp_server',
        },
        interaction: {
          category: 'tool_call',
          status,
          duration_ms: durationMs,
          request_timestamp_ms: Date.now() - durationMs,
        },
        anomaly: { flagged: false },
        transport_type: transportType,
        source: 'server',
      }),
    });

    clearTimeout(timeout);
  } catch {
    // Silently ignore — self-logging must never break tool calls
  }
}
