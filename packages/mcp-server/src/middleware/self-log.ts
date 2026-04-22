/**
 * Self-logging middleware for ACR MCP tools.
 * Wraps each tool handler to automatically log timing and status,
 * without relying on the LLM to call log_interaction.
 *
 * Self-logged receipts use source='server' to distinguish from
 * LLM-initiated logs (source='agent').
 *
 * Re-entrancy guard: the self-log POST itself goes out through fetch,
 * which would trip the tool-handler wrapper again if one tool call
 * chained into another. We guard with AsyncLocalStorage instead of a
 * module-level boolean so concurrent HTTP sessions don't race on a
 * shared flag (a process-global boolean would let session A's
 * selfLogging=true suppress session B's self-log and vice versa).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionState } from '../session-state.js';

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler = (params: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

// Per-async-context re-entrancy guard. True means "we are currently
// emitting a self-log receipt; any nested tool-handler wrap should skip
// emission to avoid a loop." Unlike a module boolean this is scoped to
// the caller's async chain, so concurrent HTTP sessions don't collide.
const inSelfLog = new AsyncLocalStorage<boolean>();

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
      // Fire-and-forget self-log (never block or fail the tool call).
      // Skip when we're already inside another self-log's emission path.
      if (inSelfLog.getStore() !== true) {
        const durationMs = Date.now() - startMs;
        const state = getState();
        const agentId = state.agentId;

        if (agentId) {
          const apiKey = state.apiKey;
          inSelfLog.run(true, () => {
            void fireAndForgetLog(
              apiUrl,
              agentId,
              toolName,
              status,
              durationMs,
              state.transportType,
              state.providerClass,
              apiKey,
            );
          });
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
  apiKey: string | null,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    await fetch(`${apiUrl}/api/v1/receipts`, {
      method: 'POST',
      headers,
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
