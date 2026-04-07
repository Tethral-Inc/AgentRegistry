/**
 * MCP server session state.
 * Handles auto-registration so agents don't need to manually call register_agent.
 */
import { randomBytes } from 'node:crypto';

let agentId: string | null = null;
let agentName: string | null = null;
let registering = false;

const ACR_API_URL = process.env.ACR_API_URL ?? 'https://acr.nfkey.ai';

export function getApiUrl(): string {
  return ACR_API_URL;
}

export function getAgentId(): string | null {
  return agentId;
}

export function getAgentName(): string | null {
  return agentName;
}

export function setAgentId(id: string): void {
  agentId = id;
}

export function setAgentName(name: string): void {
  agentName = name;
}

/**
 * Ensure the agent is registered. Called before any tool that needs an agent_id.
 * If not registered, auto-registers with a pseudo_ ID.
 * Returns the agent_id.
 */
export async function ensureRegistered(): Promise<string> {
  if (agentId) return agentId;
  if (registering) {
    // Another call is already registering — wait briefly
    await new Promise((r) => setTimeout(r, 1000));
    if (agentId) return agentId;
  }

  registering = true;
  try {
    const pseudoKey = `pseudo_${randomBytes(16).toString('hex')}`;

    const res = await fetch(`${ACR_API_URL}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: pseudoKey,
        provider_class: 'unknown',
      }),
    });

    if (res.ok) {
      const data = await res.json() as { agent_id: string; name: string };
      agentId = data.agent_id;
      agentName = data.name;
      return agentId;
    }

    // Registration failed — use pseudo ID locally
    agentId = `pseudo_${randomBytes(6).toString('hex')}`;
    return agentId;
  } finally {
    registering = false;
  }
}
