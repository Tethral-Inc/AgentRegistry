import { query } from '@acr/shared';

/**
 * Resolve an identifier (name or agent_id) to an agent_id.
 * Used by friction, receipts, and any per-agent endpoint.
 */
export async function resolveAgentId(identifier: string): Promise<{ agent_id: string; name: string | null }> {
  if (identifier.startsWith('acr_') || identifier.startsWith('pseudo_')) {
    const rows = await query<{ agent_id: string; name: string | null }>(
      `SELECT agent_id AS "agent_id", name AS "name" FROM agents WHERE agent_id = $1 LIMIT 1`,
      [identifier],
    ).catch(() => []);
    return rows[0] ?? { agent_id: identifier, name: null };
  }
  const rows = await query<{ agent_id: string; name: string | null }>(
    `SELECT agent_id AS "agent_id", name AS "name" FROM agents WHERE name = $1 LIMIT 1`,
    [identifier],
  );
  if (rows.length === 0) {
    return { agent_id: identifier, name: null };
  }
  return rows[0]!;
}
