/**
 * Reads ~/.claude/.acr-state.json — shared with @tethral/acr-mcp and
 * @tethral/acr-claude-code-plugin. The MCP writes agent_id + api_url
 * on first registration; this hook reads them.
 *
 * Also manages the in-flight file ~/.claude/.acr-hook-inflight.json
 * that pairs PreToolUse with PostToolUse so we can measure duration.
 * Keyed by session_id to tolerate multiple parallel sessions sharing
 * the same home dir. Self-cleaning on post.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface AcrState {
  agent_id: string;
  api_url: string;
  api_key?: string;
}

const STATE_PATH = join(homedir(), '.claude', '.acr-state.json');
const INFLIGHT_PATH = join(homedir(), '.claude', '.acr-hook-inflight.json');

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

export interface InflightEntry {
  tool_name: string;
  start_ms: number;
  tool_input_summary?: string;
}

type InflightMap = Record<string, InflightEntry>;

function readInflight(): InflightMap {
  try {
    const raw = readFileSync(INFLIGHT_PATH, 'utf-8');
    return JSON.parse(raw) as InflightMap;
  } catch {
    return {};
  }
}

function writeInflightAtomic(m: InflightMap): void {
  try {
    const dir = dirname(INFLIGHT_PATH);
    mkdirSync(dir, { recursive: true });
    const tmp = INFLIGHT_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, INFLIGHT_PATH);
  } catch {
    // Non-fatal — duration will be null on the next post.
  }
}

/** Mark a tool call as in-flight. Keyed by session_id. */
export function recordStart(sessionId: string, entry: InflightEntry): void {
  const m = readInflight();
  // Prune entries older than 10 min — abandoned/crashed sessions shouldn't
  // leak forever in this file.
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const k of Object.keys(m)) {
    if ((m[k]?.start_ms ?? 0) < cutoff) delete m[k];
  }
  m[sessionId] = entry;
  writeInflightAtomic(m);
}

/**
 * Consume the in-flight entry for a session, if it matches tool_name.
 * Returns null if no match (tool name changed, session unknown, etc.).
 */
export function consumeStart(sessionId: string, toolName: string): InflightEntry | null {
  const m = readInflight();
  const entry = m[sessionId];
  if (!entry) return null;
  if (entry.tool_name !== toolName) return null;
  delete m[sessionId];
  if (Object.keys(m).length === 0) {
    try { unlinkSync(INFLIGHT_PATH); } catch { /* fine */ }
  } else {
    writeInflightAtomic(m);
  }
  return entry;
}
