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

  // Store agent (including optional environment context)
  const env = data.environment;
  await execute(
    `INSERT INTO agents (agent_id, name, public_key, provider_class, current_composition_hash,
     operational_domain, registration_method, status, registered, credential_jwt,
     device_class, platform, arch, client_type, transport_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
      env?.device_class ?? null,
      env?.platform ?? null,
      env?.arch ?? null,
      env?.client_type ?? null,
      env?.transport_type ?? null,
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

  // Store per-source composition so the server can track MCP observation
  // vs agent self-report separately and compute the delta. Default source
  // is agent_reported for backwards compatibility with clients that don't
  // set composition_source.
  if (data.composition) {
    const source = data.composition_source ?? 'agent_reported';
    const sourceCompositionHash = componentHashes.length > 0
      ? compositionHash
      : computeCompositionHash([]);
    await execute(
      `INSERT INTO agent_composition_sources (agent_id, source, composition, composition_hash, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (agent_id, source) DO UPDATE
       SET composition = EXCLUDED.composition,
           composition_hash = EXCLUDED.composition_hash,
           updated_at = now()`,
      [
        agentId,
        source,
        JSON.stringify(data.composition),
        sourceCompositionHash,
      ],
    ).catch((err) => {
      // Non-fatal: if the new table doesn't exist yet (migration hasn't
      // run in the target environment), fall through without blocking
      // registration.
      log.warn({ err }, 'agent_composition_sources insert failed');
    });
  }

  // Auto-subscribe agent to threat notifications for their installed skills
  for (const hash of componentHashes) {
    await execute(
      `INSERT INTO skill_subscriptions (agent_id, skill_hash, notify_on)
       VALUES ($1, $2, 'anomaly_signal') ON CONFLICT (agent_id, skill_hash) DO NOTHING`,
      [agentId, hash],
    );
  }

  // Build environment briefing
  const systems = await query<{
    system_id: string;
    system_type: string;
    failure_rate: number;
    anomaly_rate: number;
    anomaly_signal_count: number;
    distinct_agent_count: number;
  }>(
    `SELECT system_id AS "system_id", system_type AS "system_type",
     failure_rate AS "failure_rate", anomaly_rate AS "anomaly_rate",
     anomaly_signal_count AS "anomaly_signal_count",
     distinct_agent_count AS "distinct_agent_count"
     FROM system_health ORDER BY total_interactions DESC LIMIT 10`,
  );

  const skillSignals = await query<{
    skill_hash: string;
    skill_name: string;
    anomaly_signal_count: number;
    agent_count: number;
    first_seen_at: string;
  }>(
    `SELECT skill_hash AS "skill_hash",
     COALESCE(skill_name, '') AS "skill_name",
     anomaly_signal_count AS "anomaly_signal_count",
     agent_count AS "agent_count",
     first_seen_at::text AS "first_seen_at"
     FROM skill_hashes WHERE anomaly_signal_count > 0
     ORDER BY anomaly_signal_count DESC LIMIT 10`,
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
        failure_rate: s.failure_rate,
        anomaly_rate: s.anomaly_rate,
        anomaly_signal_count: s.anomaly_signal_count,
        agent_population: s.distinct_agent_count,
      })),
      skill_signals: skillSignals.map((s) => ({
        skill_hash: s.skill_hash,
        skill_name: s.skill_name || undefined,
        anomaly_signal_count: s.anomaly_signal_count,
        agent_count: s.agent_count,
        first_seen: s.first_seen_at,
      })),
    },
  }, 201);
});

export { app as registerRoute };
