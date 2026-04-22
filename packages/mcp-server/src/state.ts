/**
 * Backwards-compatible state module.
 *
 * Every getter and setter routes through `getActiveSession()`, which
 * resolves to the per-request SessionState on HTTP transport (via the
 * `sessionContext` AsyncLocalStorage) and to `defaultSession` on stdio.
 * This lets the existing tool imports (getAgentId, getAuthHeaders, …)
 * keep working while concurrent HTTP sessions stay isolated.
 *
 * New code should prefer importing `getActiveSession()` directly from
 * `session-state.js` and calling `session.agentId` / `session.apiKey` —
 * this module exists to keep the tool surface diff small across the
 * Phase 1 migration.
 */
import { getActiveSession } from './session-state.js';

const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';

export function getApiUrl(): string {
  return ACR_API_URL;
}

export function getAgentId(): string | null {
  return getActiveSession().agentId;
}

export function getAgentName(): string | null {
  return getActiveSession().agentName;
}

export function getApiKey(): string | null {
  return getActiveSession().apiKey;
}

export function setAgentId(id: string): void {
  getActiveSession().setAgentId(id);
}

export function setAgentName(name: string): void {
  getActiveSession().setAgentName(name);
}

export function setApiKey(key: string): void {
  getActiveSession().setApiKey(key);
}

/** Returns auth headers for per-agent API calls, or empty object if no key. */
export function getAuthHeaders(): Record<string, string> {
  const key = getActiveSession().apiKey;
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export async function ensureRegistered(): Promise<string> {
  return getActiveSession().ensureRegistered(ACR_API_URL);
}
