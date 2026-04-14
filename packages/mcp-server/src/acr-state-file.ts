/**
 * Writes ~/.claude/.acr-state.json so host plugins (claude-code-plugin)
 * can discover the agent_id, API URL, and API key. Fire-and-forget — never throws.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function writeAcrStateFile(agentId: string, apiUrl: string, apiKey?: string): void {
  try {
    const stateDir = join(homedir(), '.claude');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, '.acr-state.json'),
      JSON.stringify({
        agent_id: agentId,
        api_url: apiUrl,
        ...(apiKey && { api_key: apiKey }),
      }),
    );
  } catch { /* fire-and-forget */ }
}

export function readAcrStateFile(): { agent_id: string; api_url: string; api_key?: string } | null {
  try {
    const stateFile = join(homedir(), '.claude', '.acr-state.json');
    const data = JSON.parse(readFileSync(stateFile, 'utf-8'));
    if (data?.agent_id) return data;
    return null;
  } catch { return null; }
}
