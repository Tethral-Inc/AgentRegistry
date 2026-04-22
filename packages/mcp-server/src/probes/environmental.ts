/**
 * Environmental probe — observation without cooperation.
 *
 * On MCP startup, fire a handful of lightweight HEAD requests from the
 * user's own machine to well-known public targets. Record each as a
 * receipt with source='environmental', category='tool_call'. The
 * resulting baseline answers "what does latency from *this* host to
 * *that* target look like when nothing is wrong?"
 *
 * Why this matters: when an agent call to api.openai.com is slow, the
 * friction report can say "your machine → openai baseline is 180ms,
 * this call was 2100ms → 11x your local baseline." That distinguishes
 * "your network is bad today" from "this target is having issues"
 * from "your code is slow" — which the agent cannot self-report.
 *
 * Privacy: all probes are HEAD requests to public endpoints. No body,
 * no auth, no tracking headers. Users can disable via
 * ACR_DISABLE_ENV_PROBE=1.
 */

import type { SessionState } from '../session-state.js';
import { envBool } from '../utils/env.js';

/**
 * Default probe targets. Chosen because they're (a) the systems agents
 * most commonly interact with, (b) publicly reachable without auth, and
 * (c) answer HEAD requests quickly. Users can override via
 * ACR_ENV_PROBE_TARGETS=host1,host2,host3.
 */
const DEFAULT_TARGETS: Array<{ system_id: string; url: string }> = [
  { system_id: 'api:anthropic.com', url: 'https://api.anthropic.com/' },
  { system_id: 'api:openai.com', url: 'https://api.openai.com/' },
  { system_id: 'api:github.com', url: 'https://api.github.com/' },
  // Google's public Gemini endpoint — HEAD returns 404/405 but the TCP
  // round-trip is what we're measuring.
  { system_id: 'api:googleapis.com', url: 'https://generativelanguage.googleapis.com/' },
  // AWS Bedrock runtime region endpoint. us-east-1 chosen because it's
  // the most common default; users can override via ACR_ENV_PROBE_TARGETS
  // if they run a different region.
  { system_id: 'api:bedrock.amazonaws.com', url: 'https://bedrock-runtime.us-east-1.amazonaws.com/' },
  // Azure OpenAI shared endpoint. Resolves globally; the underlying host
  // varies by subscription but the shared `azure.com` front-door is
  // reachable for a baseline latency measurement.
  { system_id: 'api:azure.com', url: 'https://management.azure.com/' },
];

const PROBE_TIMEOUT_MS = 3000;

export interface ProbeResult {
  system_id: string;
  duration_ms: number;
  status: 'success' | 'failure' | 'timeout';
  http_status?: number;
  error?: string;
}

/**
 * Fire a single HEAD probe. Never throws — errors return a failure result.
 */
async function probeOne(
  system_id: string,
  url: string,
  unwrappedFetch: typeof fetch,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await unwrappedFetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timer);
    const duration_ms = Date.now() - start;
    // Any non-5xx is "success" for probe purposes — a 401/403 from an
    // unauthenticated HEAD still proves the target is reachable and
    // responding. We only care about reachability + latency, not the
    // business-logic outcome.
    const ok = res.status < 500;
    return {
      system_id,
      duration_ms,
      status: ok ? 'success' : 'failure',
      http_status: res.status,
    };
  } catch (err) {
    clearTimeout(timer);
    const duration_ms = Date.now() - start;
    const aborted = (err as { name?: string }).name === 'AbortError';
    return {
      system_id,
      duration_ms,
      status: aborted ? 'timeout' : 'failure',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Emit a probe result as a receipt. Uses source='environmental' so the
 * friction report can distinguish probe-derived baselines from real
 * agent activity when computing metrics.
 */
async function emitReceipt(
  apiUrl: string,
  agentId: string,
  providerClass: string,
  transportType: string,
  result: ProbeResult,
  unwrappedFetch: typeof fetch,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await unwrappedFetch(`${apiUrl}/api/v1/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        emitter: { agent_id: agentId, provider_class: providerClass },
        target: { system_id: result.system_id, system_type: 'api' },
        interaction: {
          category: 'tool_call',
          status: result.status === 'timeout' ? 'timeout' : result.status,
          duration_ms: result.duration_ms,
          request_timestamp_ms: Date.now() - result.duration_ms,
          error_code: result.error ? (result.http_status ? String(result.http_status) : 'NETWORK') : undefined,
        },
        anomaly: { flagged: false },
        transport_type: transportType,
        source: 'environmental',
        categories: { interaction_purpose: 'probe', criticality: 'baseline' },
      }),
    });
    clearTimeout(timer);
  } catch {
    // Probe emission failures are non-fatal; they just mean we lose a
    // baseline datapoint. The MCP itself must not be perturbed.
  }
}

/**
 * Run the environmental probe. Non-blocking: fire-and-forget from caller.
 * Requires the agent to be registered (agentId must exist). Honors the
 * ACR_DISABLE_ENV_PROBE env var.
 */
export async function runEnvironmentalProbe(options: {
  apiUrl: string;
  session: SessionState;
  /** Inject the raw unwrapped fetch to avoid the observer re-entering itself. */
  unwrappedFetch?: typeof fetch;
}): Promise<ProbeResult[]> {
  if (envBool('ACR_DISABLE_ENV_PROBE', false)) return [];

  const { apiUrl, session } = options;
  const unwrappedFetch = options.unwrappedFetch ?? fetch;

  const agentId = session.agentId;
  if (!agentId) {
    // Can't emit receipts without an agent id; skip silently. The MCP
    // will try again on the next startup once the agent is registered.
    return [];
  }

  const targetsEnv = process.env.ACR_ENV_PROBE_TARGETS;
  const targets = targetsEnv
    ? targetsEnv.split(',').map((t) => t.trim()).filter(Boolean).map((host) => ({
        system_id: host.startsWith('api:') ? host : `api:${host}`,
        url: host.startsWith('http') ? host : `https://${host}/`,
      }))
    : DEFAULT_TARGETS;

  const results = await Promise.all(
    targets.map((t) => probeOne(t.system_id, t.url, unwrappedFetch)),
  );

  // Emit receipts in parallel but don't block the caller's startup. The
  // provider_class comes from the live session (inferred from the MCP
  // client name) so baseline probes land in the same cohort as the
  // agent's real activity — previously they were hard-coded 'unknown'
  // and formed a separate cohort from every caller's own receipts.
  const providerClass = session.providerClass;
  await Promise.all(
    results.map((r) => emitReceipt(apiUrl, agentId, providerClass, session.transportType, r, unwrappedFetch)),
  );

  return results;
}
