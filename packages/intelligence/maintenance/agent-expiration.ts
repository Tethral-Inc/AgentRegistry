import { execute, query, createLogger } from '@acr/shared';

const log = createLogger({ name: 'agent-expiration' });

const EXPIRATION_DAYS = 90;

export async function handler() {
  try {
    // Find agents inactive for > 90 days
    const expired = await query<{ agent_id: string; last_active_at: string }>(
      `SELECT agent_id AS "agent_id", last_active_at::text AS "last_active_at"
       FROM agents
       WHERE status = 'active'
         AND last_active_at < now() - $1::int * INTERVAL '1 day'`,
      [EXPIRATION_DAYS],
    );

    if (expired.length === 0) {
      log.info('No agents to expire');
      return { statusCode: 200, body: JSON.stringify({ expired: 0 }) };
    }

    const agentIds = expired.map((a) => a.agent_id);

    // Batch update to expired status
    const count = await execute(
      `UPDATE agents SET status = 'expired', updated_at = now()
       WHERE agent_id = ANY($1) AND status = 'active'`,
      [agentIds],
    );

    log.info({ expiredCount: count, agentIds }, 'Agents expired');

    return {
      statusCode: 200,
      body: JSON.stringify({ expired: count }),
    };
  } catch (err) {
    log.error({ err }, 'Agent expiration failed');
    const msg = err instanceof Error ? err.message : 'Unknown error'; return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
