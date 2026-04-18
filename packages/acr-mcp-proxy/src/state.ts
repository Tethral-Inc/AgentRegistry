/**
 * Reads ~/.claude/.acr-state.json to discover agent_id + api_url.
 * Shared contract with @tethral/acr-mcp and @tethral/acr-hook — the
 * MCP writes this file on first registration. The proxy reads it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AcrState {
  agent_id: string;
  api_url: string;
  api_key?: string;
}

const STATE_PATH = join(homedir(), '.claude', '.acr-state.json');

export function readState(): AcrState | null {
  const explicit = process.env.ACR_STATE_PATH || STATE_PATH;
  try {
    const raw = readFileSync(explicit, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.agent_id !== 'string' || typeof parsed.api_url !== 'string') {
      return null;
    }
    return parsed as unknown as AcrState;
  } catch {
    return null;
  }
}
