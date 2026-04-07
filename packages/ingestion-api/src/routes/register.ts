import { Hono } from 'hono';
import {
  RegistrationRequestSchema,
  generateAgentId,
  generateAgentName,
  computeCompositionHash,
  getSigningKeyPair,
  issueCredential,
  execute,
  query,
  makeError,
  createLogger,
} from '@acr/shared';

const log = createLogger({ name: 'register' });
const app = new Hono();

app.post('/register', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json(makeError('INVALID_INPUT', 'Request body must be valid JSON'), 400); }
  const parsed = RegistrationRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      makeError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; ')),
      400,
    );
  }

  const data = parsed.data;
  const timestamp = Date.now();
  const agentId = generateAgentId(data.public_key, timestamp);
  const agentName = data.name ?? generateAgentName(data.provider_class, data.public_key);

  // Compute composition hash from skill_hashes if provided
  const componentHashes = data.composition?.skill_hashes ?? [];
  const compositionHash = componentHashes.length > 0
    ? computeCompositionHash(componentHashes)
    : computeCompositionHash([]);

  // Issue JWT credential
  const { privateKey } = await getSigningKeyPair();
  const credential = await issueCredential(privateKey, {
    agent_id: agentId,
    public_key: data.public_key,
    provider_class: data.provider_class,
    composition_hash: compositionHash,
  });

  // Store agent
  await execute(
    `INSERT INTO agents (agent_id, name, public_key, provider_class, current_composition_hash,
     operational_domain, registration_method, status, registered, credential_jwt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      agentId,
      agentName,
      data.public_key,
      data.provider_class,
      compositionHash,
      data.operational_domain ?? null,
      'api',
      'active',
      true,
      credential,
    ],
  );

  // Store composition snapshot
  if (componentHashes.length > 0) {
    await execute(
      `INSERT INTO composition_snapshots (agent_id, composition_hash, component_hashes,
       reported_components, snapshot_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        agentId,
        compositionHash,
        componentHashes,
        JSON.stringify(data.composition ?? {}),
        'registration',
      ],
    );
  }

  // Build environment briefing
  const systems = await query<{
    system_id: string;
    system_type: string;
    health_status: string;
    anomaly_signal_count: number;
    distinct_agent_count: number;
  }>(
    `SELECT system_id AS "system_id", system_type AS "system_type",
     health_status AS "health_status", anomaly_signal_count AS "anomaly_signal_count",
     distinct_agent_count AS "distinct_agent_count"
     FROM system_health ORDER BY total_interactions DESC LIMIT 10`,
  );

  const threats = await query<{
    threat_level: string;
    skill_hash: string;
    skill_name: string;
    first_seen_at: string;
  }>(
    `SELECT threat_level AS "threat_level", skill_hash AS "skill_hash",
     COALESCE(skill_name, '') AS "skill_name", first_seen_at::text AS "first_seen_at"
     FROM skill_hashes WHERE threat_level IN ('high', 'critical')
     ORDER BY first_seen_at DESC LIMIT 10`,
  );

  log.info({ agentId, name: agentName, provider: data.provider_class }, 'Agent registered');

  return c.json({
    agent_id: agentId,
    name: agentName,
    credential,
    composition_hash: compositionHash,
    environment_briefing: {
      connected_systems: systems.map((s) => ({
        name: s.system_id,
        type: s.system_type,
        health_status: s.health_status,
        anomaly_count: s.anomaly_signal_count,
        agent_population: s.distinct_agent_count,
      })),
      active_threats: threats.map((t) => ({
        threat_level: t.threat_level,
        component_hash: t.skill_hash,
        description: t.skill_name ? `Flagged skill: ${t.skill_name}` : 'Flagged skill hash',
        first_reported: t.first_seen_at,
      })),
    },
  }, 201);
});

export { app as registerRoute };
