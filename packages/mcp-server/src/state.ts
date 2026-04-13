/**
 * Backwards-compatible state module.
 * Delegates to the defaultSession singleton from session-state.ts.
 * Tools continue to import from './state.js' without changes.
 */
import { defaultSession } from './session-state.js';

const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';

export function getApiUrl(): string {
  return ACR_API_URL;
}

export function getAgentId(): string | null {
  return defaultSession.agentId;
}

export function getAgentName(): string | null {
  return defaultSession.agentName;
}

export function getApiKey(): string | null {
  return defaultSession.apiKey;
}

export function setAgentId(id: string): void {
  defaultSession.setAgentId(id);
}

export function setAgentName(name: string): void {
  defaultSession.setAgentName(name);
}

export function setApiKey(key: string): void {
  defaultSession.setApiKey(key);
}

/** Returns auth headers for per-agent API calls, or empty object if no key. */
export function getAuthHeaders(): Record<string, string> {
  const key = defaultSession.apiKey;
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export async function ensureRegistered(): Promise<string> {
  return defaultSession.ensureRegistered(ACR_API_URL);
}
