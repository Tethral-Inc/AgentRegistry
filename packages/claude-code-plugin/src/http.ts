/**
 * Fire-and-forget HTTP client for posting composition updates to ACR.
 */
import type { Composition, Component } from './scanner.js';

const TIMEOUT_MS = 3000;

function stripSubComponents<T extends Component>(arr: T[]): T[] {
  return arr.map(({ sub_components: _, ...rest }) => rest as T);
}

/**
 * POST composition to ACR ingestion API.
 * Returns true on success, false on any error. Never throws.
 */
export async function postComposition(
  apiUrl: string,
  agentId: string,
  composition: Composition,
): Promise<boolean> {
  try {
    const deep = (process.env.ACR_DEEP_COMPOSITION ?? 'true') !== 'false';

    const body = {
      agent_id: agentId,
      composition: {
        skill_hashes: composition.skill_hashes,
        skills: composition.skills,
        mcps: composition.mcps,
        skill_components: deep
          ? composition.skill_components
          : stripSubComponents(composition.skill_components),
        mcp_components: deep
          ? composition.mcp_components
          : stripSubComponents(composition.mcp_components),
      },
      composition_source: 'mcp_observed',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${apiUrl}/api/v1/composition/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
