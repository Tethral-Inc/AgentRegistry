/**
 * Newline-delimited JSON stream observer.
 *
 * MCP uses JSON-RPC 2.0 over stdio with one message per line. We tap
 * both directions (parent->child, child->parent) to record request
 * start timestamps and match them with responses via the JSON-RPC
 * `id` field. Matched pairs produce a receipt via the provided
 * emit() callback.
 *
 * Untapped messages are forwarded unchanged — the proxy is transparent
 * to the wrapped server.
 */

export interface PendingRequest {
  method: string;
  params: unknown;
  start_ms: number;
}

export type ReceiptEmitter = (args: {
  method: string;
  params: unknown;
  result: unknown | null;
  error: { code?: number; message?: string } | null;
  duration_ms: number;
  request_timestamp_ms: number;
}) => void;

/**
 * Create a stream tap. `onRequestLine` inspects outgoing (parent->child)
 * lines and records requests. `onResponseLine` inspects incoming
 * (child->parent) lines and matches them to requests, calling
 * `emit` on matched pairs.
 *
 * The tap never rewrites content — it only observes and forwards.
 */
export function createStreamTap(emit: ReceiptEmitter) {
  const pending = new Map<string | number, PendingRequest>();

  // We only care about tools/call for receipts — every other JSON-RPC
  // method (initialize, tools/list, ping, …) is setup/metadata and not
  // usefully aggregated as friction. Keep the set lean; adding methods
  // later is a one-line change.
  const OBSERVED_METHODS = new Set(['tools/call']);

  function observeRequest(line: string): void {
    // Parse, but never let bad JSON crash the proxy — just let it pass.
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof msg.method !== 'string') return;
    if (!OBSERVED_METHODS.has(msg.method)) return;
    const id = msg.id;
    if (id === undefined || id === null) return;
    pending.set(id as string | number, {
      method: msg.method,
      params: msg.params,
      start_ms: Date.now(),
    });
  }

  function observeResponse(line: string): void {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = msg.id;
    if (id === undefined || id === null) return;
    const key = id as string | number;
    const pendingReq = pending.get(key);
    if (!pendingReq) return;
    pending.delete(key);

    const now = Date.now();
    const error = (msg.error && typeof msg.error === 'object'
      ? (msg.error as { code?: number; message?: string })
      : null);

    emit({
      method: pendingReq.method,
      params: pendingReq.params,
      result: error ? null : msg.result ?? null,
      error,
      duration_ms: now - pendingReq.start_ms,
      request_timestamp_ms: pendingReq.start_ms,
    });
  }

  return {
    observeRequest,
    observeResponse,
    /** Test/debug hook: how many requests are still awaiting a response. */
    pendingCount: () => pending.size,
  };
}

/**
 * Split a raw stream chunk into newline-delimited messages, keeping any
 * trailing partial line for the next chunk. Returns { complete, rest }.
 */
export function splitLines(buffered: string, chunk: string): { complete: string[]; rest: string } {
  const combined = buffered + chunk;
  const parts = combined.split('\n');
  const rest = parts.pop() ?? '';
  return { complete: parts, rest };
}
