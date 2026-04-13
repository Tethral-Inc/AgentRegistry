/**
 * Writes ~/.claude/.acr-state.json so host plugins (claude-code-plugin)
 * can discover the agent_id and API URL. Fire-and-forget — never throws.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function writeAcrStateFile(agentId: string, apiUrl: string): void {
  try {
    const stateDir = join(homedir(), '.claude');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, '.acr-state.json'),
      JSON.stringify({ agent_id: agentId, api_url: apiUrl }),
    );
  } catch { /* fire-and-forget */ }
}
