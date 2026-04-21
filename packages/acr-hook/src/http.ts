/**
 * Fire-and-forget receipt post. Never throws, never prints, always
 * returns quickly so the host process isn't blocked waiting on ACR.
 */
const TIMEOUT_MS = 1500;

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

export async function postReceipt(
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
