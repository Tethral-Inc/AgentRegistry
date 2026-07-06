/**
 * Fire-and-forget receipt post. Never throws, never prints, always
 * returns quickly so the host process isn't blocked waiting on ACR.
 */
const TIMEOUT_MS = 1500;
const RETRY_BACKOFF_MS = 300;

export interface HookReceipt {
  emitter: {
    agent_id: string;
    provider_class: string;
  };
  target: {
    system_id: string;
    system_type: string;
  };
  interaction: {
    category: string;
    duration_ms?: number | null;
    status: 'success' | 'failure' | 'timeout' | 'partial';
    request_timestamp_ms: number;
    response_timestamp_ms?: number;
    error_code?: string;
  };
  anomaly: { flagged: boolean };
  source: 'claude-code-hook';
  categories?: Record<string, string>;
}

async function attemptPost(
  apiUrl: string,
  apiKey: string | undefined,
  receipt: HookReceipt,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-Key'] = apiKey;
      const res = await fetch(`${apiUrl}/api/v1/receipts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(receipt),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/**
 * Post a receipt. Default is a single fire-and-forget attempt (`retries: 0`) —
 * the capture hot-path posts hundreds of these per session and must never block
 * or amplify load, so its behavior is unchanged.
 *
 * `retries` is opt-in for ONE-SHOT events (the TTFR funnel's init / first_card):
 * those fire at most once in an install's lifetime, so a single transient
 * failure permanently erases that install from the adoption metric. A couple of
 * short-backoff retries buy resilience there without touching the hot path. The
 * success path never sleeps — only a failed attempt waits before retrying.
 */
export async function postReceipt(
  apiUrl: string,
  apiKey: string | undefined,
  receipt: HookReceipt,
  opts?: { retries?: number },
): Promise<boolean> {
  const retries = opts?.retries ?? 0;
  for (let attempt = 0; ; attempt++) {
    if (await attemptPost(apiUrl, apiKey, receipt)) return true;
    if (attempt >= retries) return false;
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
  }
}
