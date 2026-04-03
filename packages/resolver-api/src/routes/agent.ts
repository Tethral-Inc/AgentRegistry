import type { Env } from '../types.js';
import { dbQuery } from '../lib/db.js';

interface AgentRow {
  agent_id: string;
  status: string;
  provider_class: string;
  registered: boolean;
  created_at: string;
  last_active_at: string;
  current_composition_hash: string | null;
}

interface AgentResponse {
  found: boolean;
  agent_id: string;
  status?: string;
  provider_class?: string;
  registered?: boolean;
  registration_date?: string;
  last_active?: string;
  composition_hash?: string;
}

export async function handleAgentLookup(
  agentId: string,
  env: Env,
): Promise<AgentResponse> {
  const rows = await dbQuery<AgentRow>(
    env.COCKROACH_CONNECTION_STRING,
    `SELECT agent_id, status, provider_class, registered,
     created_at::text AS created_at, last_active_at::text AS last_active_at,
     current_composition_hash
     FROM agents WHERE agent_id = $1`,
    [agentId],
  );

  if (rows.length === 0) {
    return { found: false, agent_id: agentId };
  }

  const row = rows[0]!;
  return {
    found: true,
    agent_id: row.agent_id,
    status: row.status,
    provider_class: row.provider_class,
    registered: row.registered,
    registration_date: row.created_at,
    last_active: row.last_active_at,
    composition_hash: row.current_composition_hash ?? undefined,
  };
}
