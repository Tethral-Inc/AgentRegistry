import { Hono } from 'hono';
import {
  CompositionUpdateSchema,
  computeCompositionHash,
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

  const { agent_id, composition } = parsed.data;

  // Verify agent exists
  const agent = await queryOne<{ agent_id: string }>(
    `SELECT agent_id AS "agent_id" FROM agents WHERE agent_id = $1`,
    [agent_id],
  );

  if (!agent) {
    return c.json(makeError('AGENT_NOT_FOUND', `Agent ${agent_id} not found`), 404);
  }

  const componentHashes = composition.skill_hashes ?? [];
  const compositionHash = computeCompositionHash(componentHashes);

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
  if (componentHashes.length > 0) {
    await execute(
      `UPDATE skill_subscriptions SET active = false
       WHERE agent_id = $1 AND skill_hash != ALL($2)`,
      [agent_id, componentHashes],
    );
    for (const hash of componentHashes) {
      await execute(
        `INSERT INTO skill_subscriptions (agent_id, skill_hash, active)
         VALUES ($1, $2, true)
         ON CONFLICT (agent_id, skill_hash) DO UPDATE SET active = true`,
        [agent_id, hash],
      );
    }
  }

  log.info({ agentId: agent_id, compositionHash }, 'Composition updated');

  return c.json({
    composition_hash: compositionHash,
    snapshot_id: 'stored',
  });
});

export { app as compositionRoute };
