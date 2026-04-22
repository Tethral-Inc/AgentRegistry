import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';

/**
 * Canonical implementation of agent ID resolution.
 * Consolidates the resolveId / resolveAgentId pattern duplicated across tool files.
 *
 * Resolution order:
 *   1. If agent_name looks like an ACR id (starts with `acr_`), use as-is.
 *   2. If agent_name is provided, look it up via the agent endpoint.
 *   3. Otherwise fall through to agent_id → session agentId → auto-register.
 *
 * Pre-2.5.0 builds would write `pseudo_*` ids on a registration failure.
 * Those are no longer treated as valid ids here — they flow through the
 * `/api/v1/agent/{name}` lookup and surface a clean "not found" if the
 * agent really never registered. The auto-register path now throws a
 * RegistrationFailedError on failure; callers should catch and render
 * `isError: true`.
 */
export async function resolveAgentId(
  params: { agentId?: string; agentName?: string },
  state: { getAgentId?: () => string | null; getAgentName?: () => string | null } = {},
): Promise<{ id: string; displayName: string }> {
  const { agentId, agentName } = params;

  if (agentName) {
    // If it looks like a real ACR id, use it as-is
    if (agentName.startsWith('acr_')) {
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

  // ensureRegistered() throws RegistrationFailedError on failure; callers
  // should catch it and render isError: true. We don't catch here so the
  // typed error surfaces intact to the tool handler.
  const id = agentId || getAgentId() || await ensureRegistered();
  const displayName = getAgentName() ?? id;
  return { id, displayName };
}

/**
 * Standard catch-and-render for `resolveAgentId` errors. Every lens tool
 * wraps its `resolveAgentId` call in a try/catch and needs to surface
 * a sensible message — this helper keeps that boilerplate identical
 * everywhere and ensures `RegistrationFailedError` gets its rich
 * `userMessage()` (HTTP-status-aware, actionable) instead of a generic
 * `Error: ...` dump.
 */
export function renderResolveError(err: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  if (err instanceof RegistrationFailedError) {
    return {
      content: [{ type: 'text' as const, text: err.userMessage() }],
      isError: true,
    };
  }
  const msg = err instanceof Error ? err.message : 'Unknown error';
  return {
    content: [{ type: 'text' as const, text: `Error: ${msg}` }],
    isError: true,
  };
}
