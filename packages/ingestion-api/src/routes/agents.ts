import { Hono } from 'hono';
import { query, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'agents' });
const app = new Hono();

/**
 * GET /agent/:identifier — Lookup by name OR agent_id.
 * This is the "who am I?" endpoint.
 */
app.get('/agent/:identifier', async (c) => {
  const identifier = c.req.param('identifier');

  const rows = await query<{
    agent_id: string;
    name: string | null;
    provider_class: string;
    status: string;
    operational_domain: string | null;
    device_class: string | null;
    platform: string | null;
    arch: string | null;
    client_type: string | null;
    transport_type: string | null;
    created_at: string;
    last_active_at: string;
  }>(
    `SELECT agent_id AS "agent_id",
            name AS "name",
            provider_class AS "provider_class",
            status AS "status",
            operational_domain AS "operational_domain",
            device_class AS "device_class",
            platform AS "platform",
            arch AS "arch",
            client_type AS "client_type",
            transport_type AS "transport_type",
            created_at::text AS "created_at",
            last_active_at::text AS "last_active_at"
     FROM agents
     WHERE agent_id = $1 OR name = $1
     LIMIT 1`,
    [identifier],
  );

  if (rows.length === 0) {
    return c.json(makeError('NOT_FOUND', `Agent "${identifier}" not found`), 404);
  }

  return c.json(rows[0]);
});

/**
 * GET /agents — List agents with optional filters.
 */
app.get('/agents', async (c) => {
  const providerClass = c.req.query('provider_class');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let sql = `SELECT agent_id AS "agent_id",
                    name AS "name",
                    provider_class AS "provider_class",
                    status AS "status",
                    last_active_at::text AS "last_active_at"
             FROM agents`;
  const params: unknown[] = [];

  if (providerClass) {
    params.push(providerClass);
    sql += ` WHERE provider_class = $${params.length}`;
  }

  sql += ` ORDER BY last_active_at DESC`;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
  params.push(offset);
  sql += ` OFFSET $${params.length}`;

  const rows = await query<{
    agent_id: string;
    name: string | null;
    provider_class: string;
    status: string;
    last_active_at: string;
  }>(sql, params);

  return c.json({ agents: rows, limit, offset });
});

export { app as agentsRoute };
