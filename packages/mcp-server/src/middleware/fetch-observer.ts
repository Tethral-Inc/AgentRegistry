/**
 * Fetch-layer observer — transport boundary instrumentation.
 *
 * Wraps globalThis.fetch so every outbound HTTP call made from any tool
 * inside the MCP process is seen at the transport boundary. No agent
 * cooperation required. The agent does not need to call log_interaction;
 * the call is observed as it crosses the HTTP boundary.
 *
 * Session resolution: the observer looks up the active session via
 * `getActiveSession()` at call time, not at install time. Under HTTP
 * transport each request runs inside `sessionContext.run(session, …)`,
 * so concurrent sessions' fetches are correctly attributed to their own
 * agent_id and transport_type. Under stdio the lookup falls back to the
 * process-wide `defaultSession`, matching the single-session semantics.
 *
 * Re-entrancy hazards — handled explicitly:
 *
 * 1. The observer itself posts receipts to the ACR API. Those posts use
 *    fetch too — and would therefore be observed, triggering more posts,
 *    infinite loop. We prevent this by:
 *    - Keeping a reference to the original (unwrapped) fetch and using
 *      it exclusively for receipt emission. The observer never runs on
 *      its own receipts.
 *    - A per-call AsyncLocalStorage flag so recursive fetches inside
 *      a tool handler's observed fetch don't double-log.
 *
 * 2. The self-log middleware already posts receipts for MCP tool calls
 *    via fetch. Those are tool-call-scoped, not HTTP-scoped. We skip the
 *    observer for URLs that match the ACR API URL so we don't double-
 *    count (once at the tool-boundary by self-log, once at the HTTP
 *    boundary by this observer).
 *
 * 3. The installed observer is idempotent. Installing twice is a no-op;
 *    subsequent createAcrServer calls (HTTP transport with concurrent
 *    sessions) all share the one wrapper, which is session-agnostic.
 *
 * Opt-out: ACR_DISABLE_FETCH_OBSERVE=1 in the environment skips install.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { getActiveSession } from '../session-state.js';
import { envBool } from '../utils/env.js';

// Reference to the original fetch, captured before the wrapper is installed.
// Callers that must bypass observation (probe emission, self-log emission,
// fetch-observer emission) should use this directly.
let originalFetch: typeof fetch | null = null;

// Re-entrancy guard: when the observer is emitting a receipt, any fetches
// made during that emission path are skipped.
const inEmission = new AsyncLocalStorage<boolean>();

// Idempotency guard — avoid double-installing if createAcrServer is
// called twice (HTTP transport with concurrent sessions).
let installed = false;

export function getUnwrappedFetch(): typeof fetch {
  return originalFetch ?? fetch;
}

/**
 * Install the fetch observer. Returns true if installed, false if
 * disabled by env var or already installed. The observer is session-
 * agnostic at install time — it reads the active session via
 * `getActiveSession()` on every observed call, so multiple
 * createAcrServer invocations can safely share the one wrapper.
 */
export function installFetchObserver(options: { apiUrl: string }): boolean {
  if (envBool('ACR_DISABLE_FETCH_OBSERVE', false)) return false;
  if (installed) return false;
  installed = true;

  const { apiUrl } = options;

  // Capture the genuinely original fetch the first time.
  if (!originalFetch) originalFetch = globalThis.fetch.bind(globalThis);
  const unwrapped = originalFetch;

  // Parse apiUrl once for host-based exclusion. We compare by host rather
  // than full URL because the ACR API may be hit via different paths.
  let acrApiHost: string | null = null;
  try {
    acrApiHost = new URL(apiUrl).host.toLowerCase();
  } catch {
    acrApiHost = null;
  }

  const wrappedFetch: typeof fetch = async (input, init) => {
    // If we're already inside an emission path, bypass observation to
    // avoid recursive logging.
    if (inEmission.getStore() === true) {
      return unwrapped(input, init);
    }

    const urlStr = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    // Fast path: exclude ACR API traffic. This covers receipt emission
    // from log-interaction, self-log, environmental probe, and this
    // observer itself.
    let host: string | null = null;
    try {
      host = new URL(urlStr).host.toLowerCase();
    } catch {
      // Malformed URL — let the underlying fetch handle it, but don't
      // try to observe.
      return unwrapped(input, init);
    }
    if (acrApiHost && host === acrApiHost) {
      return unwrapped(input, init);
    }

    const start = Date.now();
    let status: 'success' | 'failure' | 'timeout' = 'success';
    let httpStatus: number | null = null;
    let errMessage: string | null = null;

    try {
      const res = await unwrapped(input, init);
      httpStatus = res.status;
      if (res.status >= 500) status = 'failure';
      else if (res.status >= 400) status = 'failure';
      return res;
    } catch (err) {
      const name = (err as { name?: string }).name;
      status = name === 'AbortError' ? 'timeout' : 'failure';
      errMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const duration_ms = Date.now() - start;
      const method = (init?.method ?? 'GET').toUpperCase();
      // Resolve the session at observation time, not at install time —
      // HTTP concurrent sessions each run under their own sessionContext.
      const session = getActiveSession();
      const agentId = session.agentId;
      if (agentId) {
        inEmission.run(true, () => {
          void emitObservedReceipt({
            apiUrl,
            agentId,
            transportType: session.transportType,
            providerClass: session.providerClass,
            host: host as string,
            method,
            duration_ms,
            status,
            httpStatus,
            errMessage,
            unwrapped,
          });
        });
      }
    }
  };

  globalThis.fetch = wrappedFetch;
  return true;
}

interface ObservedReceiptInput {
  apiUrl: string;
  agentId: string;
  transportType: string;
  providerClass: string;
  host: string;
  method: string;
  duration_ms: number;
  status: 'success' | 'failure' | 'timeout';
  httpStatus: number | null;
  errMessage: string | null;
  unwrapped: typeof fetch;
}

async function emitObservedReceipt(input: ObservedReceiptInput): Promise<void> {
  const {
    apiUrl,
    agentId,
    transportType,
    providerClass,
    host,
    method,
    duration_ms,
    status,
    httpStatus,
    errMessage,
    unwrapped,
  } = input;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await unwrapped(`${apiUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        emitter: { agent_id: agentId, provider_class: providerClass },
        target: { system_id: `api:${host}`, system_type: 'api' },
        interaction: {
          category: 'tool_call',
          status,
          duration_ms,
          request_timestamp_ms: Date.now() - duration_ms,
          error_code: httpStatus ? String(httpStatus) : (errMessage ? 'NETWORK' : undefined),
        },
        anomaly: { flagged: false },
        transport_type: transportType,
        // source='fetch-observer' distinguishes transport-boundary-observed
        // receipts from agent-reported and environmental-probe ones.
        source: 'fetch-observer',
        categories: {
          interaction_purpose: method.toLowerCase() === 'get' ? 'read' : method.toLowerCase(),
        },
      }),
    });
    clearTimeout(timer);
  } catch {
    // Observation must never perturb the observed call. Silent drop.
  }
}
