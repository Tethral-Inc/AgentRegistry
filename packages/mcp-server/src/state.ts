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

export function setAgentId(id: string): void {
  defaultSession.setAgentId(id);
}

export function setAgentName(name: string): void {
  defaultSession.setAgentName(name);
}

export async function ensureRegistered(): Promise<string> {
  return defaultSession.ensureRegistered(ACR_API_URL);
}
