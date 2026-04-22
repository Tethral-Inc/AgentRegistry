import { Hono } from 'hono';
import {
  CompositionUpdateSchema,
  computeCompositionHash,
  extractCompositionComponentHashes,
  queryOne,
  execute,
  makeError,
  createLogger,
} from '@acr/shared';

const log = createLogger({ name: 'composition' });
const app = new Hono();

app.post('/composition/update', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json(makeError('INVALID_INPUT', 'Request body must be valid JSON'), 400); }
  const parsed = CompositionUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      makeError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; ')),
      400,
    );
  }

  const { agent_id, composition, composition_source } = parsed.data;

  // Authorization: the API key must belong to the agent_id being updated.
  // agentAuth middleware already validated the key and set X-ACR-Auth-Agent;
  // we check body ownership here because the agent_id lives in the body,
  // not the URL.
  const authAgent = c.req.header('X-ACR-Auth-Agent');
  if (!authAgent || authAgent !== agent_id) {
    return c.json(makeError('FORBIDDEN', 'API key does not authorize composition updates for this agent.'), 403);
  }

  // Verify agent exists
  const agent = await queryOne<{ agent_id: string }>(
    `SELECT agent_id AS "agent_id" FROM agents WHERE agent_id = $1`,
    [agent_id],
  );

  if (!agent) {
    return c.json(makeError('AGENT_NOT_FOUND', `Agent ${agent_id} not found`), 404);
  }

  // Hash every composition field (flat + rich + sub_components), not
  // just the legacy `skill_hashes`. Rich-only compositions previously
  // collapsed to sha256('') — the helper fixes that while preserving
  // backwards compatibility for callers who only send `skill_hashes`.
  const componentHashes = extractCompositionComponentHashes(composition);
  const compositionHash = computeCompositionHash(componentHashes);

  // Skill subscriptions key on real skill content hashes (what other
  // agents' `skill_hashes` match for signal ingestion). Synthetic
  // component hashes derived from names or rich-component ids must not
  // enter this table or we subscribe to signals nobody else observes.
  const skillSubscriptionHashes = composition.skill_hashes ?? [];

  // Store composition snapshot
  const result = await execute(
    `INSERT INTO composition_snapshots (agent_id, composition_hash, component_hashes,
     reported_components, snapshot_method)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      agent_id,
      compositionHash,
      componentHashes,
      JSON.stringify(composition),
      'composition_update',
    ],
  );

  // Update agent's current composition hash
  await execute(
    `UPDATE agents SET current_composition_hash = $1, updated_at = now()
     WHERE agent_id = $2`,
    [compositionHash, agent_id],
  );

  // Sync skill subscriptions: deactivate removed, activate new
  if (skillSubscriptionHashes.length > 0) {
    await execute(
      `UPDATE skill_subscriptions SET active = false
       WHERE agent_id = $1 AND skill_hash != ALL($2)`,
      [agent_id, skillSubscriptionHashes],
    );
    for (const hash of skillSubscriptionHashes) {
      await execute(
        `INSERT INTO skill_subscriptions (agent_id, skill_hash, active, notify_on)
         VALUES ($1, $2, true, 'anomaly_signal')
         ON CONFLICT (agent_id, skill_hash) DO UPDATE SET active = true`,
        [agent_id, hash],
      );
    }
  }

  // Store per-source composition so the server can track MCP observation
  // vs agent self-report separately. Default is agent_reported for
  // backwards compatibility.
  const source = composition_source ?? 'agent_reported';
  await execute(
    `INSERT INTO agent_composition_sources (agent_id, source, composition, composition_hash, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (agent_id, source) DO UPDATE
     SET composition = EXCLUDED.composition,
         composition_hash = EXCLUDED.composition_hash,
         updated_at = now()`,
    [
      agent_id,
      source,
      JSON.stringify(composition),
      compositionHash,
    ],
  ).catch((err) => {
    log.warn({ err }, 'agent_composition_sources update failed');
  });

  log.info({ agentId: agent_id, compositionHash, source }, 'Composition updated');

  return c.json({
    composition_hash: compositionHash,
    snapshot_id: 'stored',
  });
});

export { app as compositionRoute };
