import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import {
  RegistrationRequestSchema,
  generateAgentId,
  generateAgentName,
  computeCompositionHash,
  extractCompositionComponentHashes,
  getSigningKeyPair,
  issueCredential,
  sha256,
  execute,
  query,
  makeError,
  createLogger,
} from '@acr/shared';
import {
  parseRegisterChurnThreshold,
  shouldRejectRegistration,
  extractClientIp,
} from '../lib/register-churn.js';

const log = createLogger({ name: 'register' });
const app = new Hono();

// Per-IP register churn — env-configurable so the threshold and kill
// switch are flippable in Vercel without a redeploy.
// CHURN_CHECK_ENABLED=false disables entirely.
const CHURN_CHECK_ENABLED = process.env.REGISTER_CHURN_CHECK_ENABLED !== 'false';
const CHURN_THRESHOLD = parseRegisterChurnThreshold(
  process.env.REGISTER_CHURN_THRESHOLD_PER_IP_HOUR,
);

type ExistingAgentRow = {
  agent_id: string;
  name: string | null;
  credential_jwt: string | null;
  current_composition_hash: string | null;
};

type SystemHealthRow = {
  system_id: string;
  system_type: string;
  failure_rate: number;
  anomaly_rate: number;
  anomaly_signal_count: number;
  distinct_agent_count: number;
};

type SkillSignalRow = {
  skill_hash: string;
  skill_name: string;
  anomaly_signal_count: number;
  agent_count: number;
  first_seen_at: string;
};

async function buildEnvironmentBriefing() {
  const systems = await query<SystemHealthRow>(
    `SELECT system_id AS "system_id", system_type AS "system_type",
     failure_rate AS "failure_rate", anomaly_rate AS "anomaly_rate",
     anomaly_signal_count AS "anomaly_signal_count",
     distinct_agent_count AS "distinct_agent_count"
     FROM system_health ORDER BY total_interactions DESC LIMIT 10`,
  );
  const skillSignals = await query<SkillSignalRow>(
    `SELECT skill_hash AS "skill_hash",
     COALESCE(skill_name, '') AS "skill_name",
     anomaly_signal_count AS "anomaly_signal_count",
     agent_count AS "agent_count",
     first_seen_at::text AS "first_seen_at"
     FROM skill_hashes WHERE anomaly_signal_count > 0
     ORDER BY anomaly_signal_count DESC LIMIT 10`,
  );
  return {
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
  };
}

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

  // Per-IP churn check — fail fast before any crypto/DB work.
  // Skipped when disabled or when no IP header is present (caller is
  // probably a local integration test). Counts the number of distinct
  // agents already registered from this IP in the current hour; rejects
  // once the count reaches the threshold.
  const ip = extractClientIp(
    c.req.header('x-forwarded-for'),
    c.req.header('x-real-ip'),
  );
  if (CHURN_CHECK_ENABLED && ip !== 'unknown') {
    try {
      const churnRows = await query<{ count: number }>(
        `SELECT COUNT(*)::INT AS "count"
         FROM ip_register_churn
         WHERE ip = $1 AND bucket_hour = date_trunc('hour', now())`,
        [ip],
      );
      const count = churnRows[0]?.count ?? 0;
      if (shouldRejectRegistration(count, CHURN_THRESHOLD)) {
        log.warn(
          { event: 'register_churn_reject', ip, count, threshold: CHURN_THRESHOLD },
          'IP exceeded register churn threshold',
        );
        return c.json(
          makeError(
            'RATE_LIMITED',
            `IP has registered ${count} distinct agents this hour (limit ${CHURN_THRESHOLD})`,
          ),
          429,
        );
      }
    } catch (err) {
      // Churn table missing in an env that hasn't run 000022 yet — do not
      // block registration on infra drift. Log and proceed.
      log.warn({ ip, err: (err as Error).message }, 'Register churn check failed');
    }
  }

  const timestamp = Date.now();
  const agentId = generateAgentId(data.public_key, timestamp);
  const agentName = data.name ?? generateAgentName(data.provider_class, data.public_key);

  // Compute composition hash over every composition field the agent
  // sent — flat legacy + rich nested + sub_components. Previously only
  // `skill_hashes` was hashed, which meant rich-only compositions all
  // collapsed to sha256('') and could not be distinguished.
  const componentHashes = extractCompositionComponentHashes(data.composition ?? {});
  const compositionHash = computeCompositionHash(componentHashes);

  // Issue JWT credential
  const { privateKey } = await getSigningKeyPair();
  const credential = await issueCredential(privateKey, {
    agent_id: agentId,
    public_key: data.public_key,
    provider_class: data.provider_class,
    composition_hash: compositionHash,
  });

  // Idempotent INSERT — agents.public_key is UNIQUE (000022). If the row
  // already exists we skip the INSERT, fetch the existing record, and
  // return it without minting a new api_key. Re-registration is a no-op
  // at the storage layer; composition changes go through
  // /composition/update, not /register.
  const env = data.environment;
  const insertRows = await query<{ agent_id: string }>(
    `INSERT INTO agents (agent_id, name, public_key, provider_class, current_composition_hash,
     operational_domain, registration_method, status, registered, credential_jwt,
     device_class, platform, arch, client_type, transport_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (public_key) DO NOTHING
     RETURNING agent_id AS "agent_id"`,
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

  const isReRegistration = insertRows.length === 0;

  if (isReRegistration) {
    // Re-registration path: return the existing agent's stable identity.
    // We deliberately do NOT mint a new api_key — if the caller lost
    // theirs, they go through a key-rotation flow (not built yet), not
    // by replaying /register. This is what closes the "anyone knowing
    // your public_key can steal your api_key" vector.
    const existingRows = await query<ExistingAgentRow>(
      `SELECT agent_id AS "agent_id", name AS "name",
       credential_jwt AS "credential_jwt",
       current_composition_hash AS "current_composition_hash"
       FROM agents WHERE public_key = $1`,
      [data.public_key],
    );
    const existing = existingRows[0];
    if (!existing) {
      // Impossible unless the row was deleted between INSERT and SELECT.
      // Treat as a server error rather than re-issuing credentials.
      log.error({ publicKey: data.public_key.slice(0, 8) }, 'Register conflict with no existing row');
      return c.json(makeError('INTERNAL_ERROR', 'Registration conflict could not be resolved'), 500);
    }

    const briefing = await buildEnvironmentBriefing();
    log.info(
      { agentId: existing.agent_id, event: 'register_reregistration' },
      'Existing agent re-registered',
    );
    return c.json(
      {
        agent_id: existing.agent_id,
        name: existing.name,
        credential: existing.credential_jwt,
        composition_hash: existing.current_composition_hash,
        reregistered: true,
        environment_briefing: briefing,
      },
      200,
    );
  }

  // Fresh registration path. All derived records insert with the new
  // agent_id, using ON CONFLICT where the table supports it so re-runs
  // against a retried write stay idempotent.

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

  if (data.composition) {
    const source = data.composition_source ?? 'agent_reported';
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
        compositionHash,
      ],
    ).catch((err) => {
      log.warn({ err }, 'agent_composition_sources insert failed');
    });
  }

  // Auto-subscribe the agent to anomaly-signal notifications for every
  // skill_hash it declared. Batched into a single multi-VALUES INSERT so
  // one registration with N skill_hashes is one round trip, not N —
  // previously an attacker could pin a serverless worker by sending a
  // large skill_hashes array. The schema cap (64) is the hard bound on N.
  const skillHashes = data.composition?.skill_hashes ?? [];
  if (skillHashes.length > 0) {
    const placeholders: string[] = [];
    const params: unknown[] = [agentId];
    for (let i = 0; i < skillHashes.length; i++) {
      placeholders.push(`($1, $${i + 2}, 'anomaly_signal')`);
      params.push(skillHashes[i]);
    }
    await execute(
      `INSERT INTO skill_subscriptions (agent_id, skill_hash, notify_on)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (agent_id, skill_hash) DO NOTHING`,
      params,
    ).catch((err) => {
      // Non-fatal: subscriptions are a convenience. Registration should
      // still succeed if a constraint is violated somewhere.
      log.warn({ err }, 'skill_subscriptions batch insert failed');
    });
  }

  // Auto-issue API key for per-agent endpoint access. Minted exclusively
  // on fresh registration — re-registrations never receive a new key.
  const rawApiKey = `acr_${randomBytes(24).toString('hex')}`;
  const apiKeyHash = sha256(rawApiKey);
  await execute(
    `INSERT INTO api_keys (key_hash, operator_id, name, tier, rate_limit_per_hour)
     VALUES ($1, $2, 'auto', 'free', 100)`,
    [apiKeyHash, agentId],
  ).catch((err) => {
    log.warn({ err }, 'api_keys insert failed');
  });

  // Record this (ip, agent_id) pair for churn accounting. Done last so
  // the handler's successful-registration count matches what actually
  // got written. A failed INSERT anywhere above means we don't count it.
  if (CHURN_CHECK_ENABLED && ip !== 'unknown') {
    await execute(
      `INSERT INTO ip_register_churn (ip, bucket_hour, agent_id)
       VALUES ($1, date_trunc('hour', now()), $2)
       ON CONFLICT (ip, bucket_hour, agent_id) DO NOTHING`,
      [ip, agentId],
    ).catch((err) => {
      // Don't fail the registration over churn bookkeeping.
      log.warn({ ip, agentId, err: (err as Error).message }, 'Register churn insert failed');
    });
  }

  const briefing = await buildEnvironmentBriefing();

  log.info(
    { agentId, name: agentName, provider: data.provider_class },
    'Agent registered',
  );

  return c.json(
    {
      agent_id: agentId,
      name: agentName,
      credential,
      api_key: rawApiKey,
      composition_hash: compositionHash,
      reregistered: false,
      environment_briefing: briefing,
    },
    201,
  );
});

export { app as registerRoute };
