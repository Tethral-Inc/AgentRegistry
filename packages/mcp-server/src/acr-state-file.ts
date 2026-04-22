/**
 * Writes ~/.claude/.acr-state.json so host plugins (claude-code-plugin)
 * can discover the agent_id, API URL, and API key. Fire-and-forget — never throws.
 *
 * Also holds the agent's persistent Ed25519 keypair so subsequent
 * /register calls (and any future signed endpoints) can reuse the same
 * identity. Before PoP was enforced we used an ephemeral pseudo-key
 * each session; that's now a non-starter because the server requires
 * a signed payload.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AcrStateFile {
  agent_id: string;
  api_url: string;
  api_key?: string;
  // Agent's persistent Ed25519 keypair, base64url-encoded raw bytes.
  // Generated once on first registration; reused forever after.
  public_key?: string;
  private_key?: string;
}

export function writeAcrStateFile(state: AcrStateFile): void {
  try {
    const stateDir = join(homedir(), '.claude');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, '.acr-state.json'),
      JSON.stringify({
        agent_id: state.agent_id,
        api_url: state.api_url,
        ...(state.api_key && { api_key: state.api_key }),
        ...(state.public_key && { public_key: state.public_key }),
        ...(state.private_key && { private_key: state.private_key }),
      }),
    );
  } catch { /* fire-and-forget */ }
}

export function readAcrStateFile(): AcrStateFile | null {
  try {
    const stateFile = join(homedir(), '.claude', '.acr-state.json');
    const data = JSON.parse(readFileSync(stateFile, 'utf-8')) as Partial<AcrStateFile>;
    if (data?.agent_id && data?.api_url) {
      return {
        agent_id: data.agent_id,
        api_url: data.api_url,
        api_key: data.api_key,
        public_key: data.public_key,
        private_key: data.private_key,
      };
    }
    return null;
  } catch { return null; }
}
