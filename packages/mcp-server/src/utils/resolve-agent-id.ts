import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

/**
 * Canonical implementation of agent ID resolution.
 * Consolidates the resolveId / resolveAgentId pattern duplicated across tool files.
 *
 * Resolution order:
 *   1. If agent_name looks like an ID (starts with acr_ or pseudo_), use it directly.
 *   2. If agent_name is provided, look it up via the agent endpoint.
 *   3. Otherwise fall through to agent_id → session agentId → auto-register.
 */
export async function resolveAgentId(
  params: { agentId?: string; agentName?: string },
  state: { getAgentId?: () => string | null; getAgentName?: () => string | null } = {},
): Promise<{ id: string; displayName: string }> {
  const { agentId, agentName } = params;

  if (agentName) {
    // If it looks like a real ID, use it as-is
    if (agentName.startsWith('acr_') || agentName.startsWith('pseudo_')) {
      return { id: agentName, displayName: agentName };
    }
    const apiUrl = getApiUrl();
    const res = await fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(agentName)}`);
    if (!res.ok) {
      throw new Error(`Agent "${agentName}" not found`);
    }
    const data = await res.json() as { agent_id: string; name?: string };
    return { id: data.agent_id, displayName: data.name ?? agentName };
  }

  const id = agentId || getAgentId() || await ensureRegistered();
  const displayName = getAgentName() ?? id;
  return { id, displayName };
}
