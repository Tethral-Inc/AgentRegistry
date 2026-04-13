/**
 * Manages ~/.claude/.acr-state.json — the shared state file between
 * the MCP server (writes agent_id on registration) and this plugin
 * (reads agent_id, writes last sync info).
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface AcrState {
  agent_id: string;
  api_url: string;
  registered_at: string;
  last_composition_hash?: string;
  last_sync_ts?: number;
}

const STATE_PATH = join(homedir(), '.claude', '.acr-state.json');

export function readState(): AcrState | null {
  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.agent_id !== 'string' || typeof parsed.api_url !== 'string') {
      return null;
    }
    return parsed as unknown as AcrState;
  } catch {
    return null;
  }
}

/**
 * Merge a patch into an already-read state and write atomically.
 * Avoids re-reading the file when the caller already has the state.
 */
export function writeStateMerged(existing: AcrState, patch: Partial<AcrState>): void {
  try {
    const merged = { ...existing, ...patch };
    const dir = dirname(STATE_PATH);
    mkdirSync(dir, { recursive: true });
    const tmp = STATE_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(merged, null, 2));
    renameSync(tmp, STATE_PATH);
  } catch {
    // Fire-and-forget — state write failure is non-fatal
  }
}
