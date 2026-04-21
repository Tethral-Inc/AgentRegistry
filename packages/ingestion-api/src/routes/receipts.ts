import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import {
  InteractionReceiptSchema,
  ReceiptBatchSchema,
  generateReceiptId,
  normalizeSystemId,
  execute,
  query,
  makeError,
  createLogger,
} from '@acr/shared';
import type { InteractionReceipt } from '@acr/shared';
import { optionalAgentAuth } from '../middleware/optional-agent-auth.js';

const log = createLogger({ name: 'receipts' });
const app = new Hono();

// Phase 0 of anomaly-on-ingest: write counters, read quarantine, but do not
// reject. Flip to false once baselines have 24h of coverage per agent and
// we've confirmed the signals in log review.
const SHADOW_MODE = true;
// Hard per-agent hourly receipt cap. Well above any legitimate fleet rate
// — a single compromised agent flooding this means something is wrong.
const HARD_HOURLY_CAP = 10_000;

// Per-IP agent-id churn defense (replaces the deleted Upstash rate limiter).
// Env-configurable so the threshold and kill switch are flippable in Vercel
// without a redeploy. CHURN_CHECK_ENABLED=false disables entirely.
const CHURN_CHECK_ENABLED = process.env.CHURN_CHECK_ENABLED !== 'false';
const CHURN_THRESHOLD_PER_IP_HOUR = Number.parseInt(
  process.env.CHURN_THRESHOLD_PER_IP_HOUR ?? '50',
  10,
);

// Server-side chain inference window. A chainless receipt arriving within
// this many ms of another receipt from the same agent gets fused into the
// latest active chain, whether that chain was set by the client (chain_id
// on log_interaction), inferred by the MCP session (s-* prefix), or minted
// here (srv-* prefix). Keeping the window short — 5 min matches the MCP
// session idle timeout — means distinct workflows don't get glued together.
const CHAIN_INFERENCE_WINDOW_MS = 5 * 60 * 1000;

type ChainTail = {
  chain_id: string;
  chain_position: number;
  receipt_id: string;
};

function mintServerChainId(): string {
  return `srv-${randomBytes(8).toString('hex')}`;
}

app.use('/receipts', optionalAgentAuth);

app.post('/receipts', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { return c.json(makeError('INVALID_INPUT', 'Request body must be valid JSON'), 400); }

  // Determine if single receipt or batch
  let receipts: InteractionReceipt[];

  const data = body as Record<string, unknown>;
  if (data.receipts && Array.isArray(data.receipts)) {
    const parsed = ReceiptBatchSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        makeError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; ')),
        400,
      );
    }
    receipts = parsed.data.receipts;
  } else {
    const parsed = InteractionReceiptSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        makeError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; ')),
        400,
      );
    }
    receipts = [parsed.data];
  }

  // If the caller authenticated with an API key, every receipt in the batch
  // must be emitted by that key's owner. Unauthenticated callers pass through
  // (backward compat with SDKs that don't yet send keys); they are still
  // bounded by the global IP rate limiter.
  const authedAgent = c.req.raw.headers.get('X-ACR-Auth-Agent');
  if (authedAgent) {
    for (const receipt of receipts) {
      if (receipt.emitter.agent_id !== authedAgent) {
        return c.json(
          makeError('FORBIDDEN', 'emitter.agent_id does not match the authenticated API key owner'),
          403,
        );
      }
    }
  }

  // Shadow-mode anomaly checks: group by agent, read quarantine + bump
  // hourly counter. Never blocks in SHADOW_MODE — only logs the signal so
  // we can calibrate thresholds before enforcing.
  const byAgent = new Map<string, { count: number; flagged: number; targets: Set<string> }>();
  for (const r of receipts) {
    const agg = byAgent.get(r.emitter.agent_id) ?? { count: 0, flagged: 0, targets: new Set<string>() };
    agg.count += 1;
    if (r.anomaly.flagged) agg.flagged += 1;
    agg.targets.add(normalizeSystemId(r.target.system_id));
    byAgent.set(r.emitter.agent_id, agg);
  }

  for (const [agentId, agg] of byAgent) {
    try {
      const quarantineRows = await query<{ reason: string; flagged_at: string }>(
        `SELECT reason AS "reason", flagged_at::text AS "flagged_at"
         FROM agent_quarantine
         WHERE agent_id = $1 AND cleared_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())`,
        [agentId],
      );
      if (quarantineRows.length > 0) {
        const q = quarantineRows[0]!;
        log.warn(
          { event: 'quarantine_read', agentId, reason: q.reason, flaggedAt: q.flagged_at, shadow: SHADOW_MODE },
          'Receipt from quarantined agent',
        );
        if (!SHADOW_MODE) {
          return c.json(
            makeError('FORBIDDEN', `Agent is quarantined: ${q.reason}`),
            403,
          );
        }
      }

      const counterRows = await query<{ receipt_count: number }>(
        `INSERT INTO ingest_counters (agent_id, bucket_hour, receipt_count, anomaly_flagged, distinct_targets)
         VALUES ($1, date_trunc('hour', now()), $2, $3, $4)
         ON CONFLICT (agent_id, bucket_hour) DO UPDATE SET
           receipt_count = ingest_counters.receipt_count + EXCLUDED.receipt_count,
           anomaly_flagged = ingest_counters.anomaly_flagged + EXCLUDED.anomaly_flagged,
           distinct_targets = GREATEST(ingest_counters.distinct_targets, EXCLUDED.distinct_targets),
           updated_at = now()
         RETURNING receipt_count AS "receipt_count"`,
        [agentId, agg.count, agg.flagged, agg.targets.size],
      );
      const hourly = counterRows[0]?.receipt_count ?? 0;
      if (hourly > HARD_HOURLY_CAP) {
        log.warn(
          { event: 'volume_spike', agentId, hourly, cap: HARD_HOURLY_CAP, shadow: SHADOW_MODE },
          'Agent exceeded hard hourly receipt cap',
        );
        if (!SHADOW_MODE) {
          return c.json(
            makeError('RATE_LIMITED', `Exceeded hard hourly cap of ${HARD_HOURLY_CAP} receipts`),
            429,
          );
        }
      }
    } catch (err) {
      // Non-fatal in shadow mode: missing tables in envs that haven't run
      // 000018 yet should not break receipt ingestion.
      log.warn({ agentId, err: (err as Error).message }, 'Anomaly-on-ingest check failed');
    }
  }

  // Per-IP agent-id churn check. Flags IPs declaring many distinct agent_ids
  // per hour — the one vector per-agent counters miss. Shadow-mode: logs
  // only, never rejects.
  if (CHURN_CHECK_ENABLED) {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
    if (ip !== 'unknown') {
      try {
        for (const agentId of byAgent.keys()) {
          await execute(
            `INSERT INTO ip_agent_churn (ip, bucket_hour, agent_id)
             VALUES ($1, date_trunc('hour', now()), $2)
             ON CONFLICT (ip, bucket_hour, agent_id) DO NOTHING`,
            [ip, agentId],
          );
        }
        const churnRows = await query<{ distinct_agents: number }>(
          `SELECT COUNT(*)::INT AS "distinct_agents"
           FROM ip_agent_churn
           WHERE ip = $1 AND bucket_hour = date_trunc('hour', now())`,
          [ip],
        );
        const distinctAgents = churnRows[0]?.distinct_agents ?? 0;
        if (distinctAgents > CHURN_THRESHOLD_PER_IP_HOUR) {
          log.warn(
            {
              event: 'churn_signal',
              ip,
              distinctAgents,
              threshold: CHURN_THRESHOLD_PER_IP_HOUR,
              shadow: SHADOW_MODE,
            },
            'IP exceeded agent-id churn threshold',
          );
          if (!SHADOW_MODE) {
            return c.json(
              makeError(
                'RATE_LIMITED',
                `IP declared ${distinctAgents} distinct agent_ids this hour (limit ${CHURN_THRESHOLD_PER_IP_HOUR})`,
              ),
              429,
            );
          }
        }
      } catch (err) {
        log.warn({ ip, err: (err as Error).message }, 'Churn check failed');
      }
    }
  }

  const receiptIds: string[] = [];

  // --- Chain inference pre-pass ---
  // For each agent emitting at least one chainless receipt (and where the
  // source is workflow-adjacent — environmental probes are intentionally
  // not chained), fetch their most recent chain tail inside the inference
  // window. The tail is then extended as we process the batch so chainless
  // receipts from the same agent within one batch share a chain.
  const agentsNeedingChain = new Set<string>();
  for (const r of receipts) {
    if (!r.chain_id && (r.source ?? 'agent') !== 'environmental') {
      agentsNeedingChain.add(r.emitter.agent_id);
    }
  }

  const chainTails = new Map<string, ChainTail>();
  if (agentsNeedingChain.size > 0) {
    const windowStartMs = Date.now() - CHAIN_INFERENCE_WINDOW_MS;
    for (const agentId of agentsNeedingChain) {
      try {
        const rows = await query<{
          receipt_id: string;
          chain_id: string;
          chain_position: number | null;
        }>(
          `SELECT receipt_id AS "receipt_id",
                  chain_id AS "chain_id",
                  chain_position AS "chain_position"
           FROM interaction_receipts
           WHERE emitter_agent_id = $1
             AND chain_id IS NOT NULL
             AND request_timestamp_ms >= $2
           ORDER BY request_timestamp_ms DESC
           LIMIT 1`,
          [agentId, windowStartMs],
        );
        if (rows.length > 0) {
          chainTails.set(agentId, {
            chain_id: rows[0].chain_id,
            chain_position: rows[0].chain_position ?? 0,
            receipt_id: rows[0].receipt_id,
          });
        }
      } catch {
        // Non-fatal: if the lookup fails, receipts just land without chain_id
        // rather than blocking ingest. Chain analysis is a nice-to-have.
      }
    }
  }

  for (const receipt of receipts) {
    // Normalize target system_id
    const normalizedTargetId = normalizeSystemId(receipt.target.system_id);

    // Compute receipt_id deterministically
    const receiptId = generateReceiptId(
      receipt.emitter.agent_id,
      normalizedTargetId,
      receipt.interaction.request_timestamp_ms,
    );

    // Compute duration_ms from timestamps if not provided
    const durationMs = receipt.interaction.duration_ms ??
      (receipt.interaction.response_timestamp_ms
        ? receipt.interaction.response_timestamp_ms - receipt.interaction.request_timestamp_ms
        : null);

    // Serialize categories as JSON string for JSONB column. Defaults to {}
    // if the client didn't supply categories — matches the DB column's
    // default and keeps reads consistent.
    const categoriesJson = JSON.stringify(receipt.categories ?? {});

    // Resolve the chain fields actually stored on this receipt. Client
    // values win — we never overwrite a chain_id the agent/MCP set. Only
    // chainless receipts (fetch-observer, HTTP-direct posts, hook-emitted
    // receipts) get server-side inference. Environmental probes stay
    // chainless on purpose: they're baselines, not workflow.
    let effectiveChainId: string | null = receipt.chain_id ?? null;
    let effectiveChainPosition: number | null = receipt.chain_position ?? null;
    let effectivePrecededBy: string | null = receipt.preceded_by ?? null;

    if (!effectiveChainId && (receipt.source ?? 'agent') !== 'environmental') {
      const tail = chainTails.get(receipt.emitter.agent_id);
      if (tail) {
        effectiveChainId = tail.chain_id;
        effectiveChainPosition = tail.chain_position + 1;
        if (!effectivePrecededBy) effectivePrecededBy = tail.receipt_id;
      } else {
        // No recent activity — start a new server-inferred chain. The
        // srv- prefix distinguishes these from client/session-inferred
        // chains (s-) and explicitly-set chains (anything else).
        effectiveChainId = mintServerChainId();
        effectiveChainPosition = 1;
      }
    }

    // Keep the in-memory tail up to date so subsequent receipts in this
    // batch (for the same agent) extend the same chain even if the DB
    // lookup didn't see them yet.
    if (effectiveChainId) {
      chainTails.set(receipt.emitter.agent_id, {
        chain_id: effectiveChainId,
        chain_position: effectiveChainPosition ?? 1,
        receipt_id: receiptId,
      });
    }

    await execute(
      `INSERT INTO interaction_receipts (
        receipt_id, emitter_agent_id, emitter_composition_hash, emitter_provider_class,
        target_system_id, target_system_type, interaction_category,
        request_timestamp_ms, response_timestamp_ms, duration_ms, status,
        anomaly_flagged, anomaly_category, anomaly_detail,
        transport_type, source,
        queue_wait_ms, retry_count, error_code, response_size_bytes,
        chain_id, chain_position, preceded_by,
        categories, tokens_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25)
      ON CONFLICT (receipt_id, created_at) DO NOTHING`,
      [
        receiptId,
        receipt.emitter.agent_id,
        receipt.emitter.composition_hash ?? null,
        receipt.emitter.provider_class,
        normalizedTargetId,
        receipt.target.system_type,
        receipt.interaction.category,
        receipt.interaction.request_timestamp_ms,
        receipt.interaction.response_timestamp_ms ?? null,
        durationMs,
        receipt.interaction.status,
        receipt.anomaly.flagged,
        receipt.anomaly.category ?? null,
        receipt.anomaly.detail ?? null,
        receipt.transport_type ?? null,
        receipt.source ?? 'agent',
        receipt.interaction.queue_wait_ms ?? null,
        receipt.interaction.retry_count ?? 0,
        receipt.interaction.error_code ?? null,
        receipt.interaction.response_size_bytes ?? null,
        effectiveChainId,
        effectiveChainPosition,
        effectivePrecededBy,
        categoriesJson,
        receipt.interaction.tokens_used ?? null,
      ],
    );

    receiptIds.push(receiptId);

    // Update agent last_active_at
    await execute(
      `UPDATE agents SET last_active_at = now(), updated_at = now()
       WHERE agent_id = $1`,
      [receipt.emitter.agent_id],
    );
  }

  log.info({ count: receipts.length, agentId: receipts[0]?.emitter.agent_id }, 'Receipts accepted');

  // Composition age: raw age in minutes since the agent last sent an
  // explicit register/update_composition call. Clients decide what age
  // is "stale" for their purposes. The server does not label a threshold.
  let composition_last_updated_minutes_ago: number | null = null;
  const agentIdForAge = receipts[0]?.emitter.agent_id;
  if (agentIdForAge) {
    try {
      const rows = await query<{ age_min: number | null }>(
        `SELECT EXTRACT(EPOCH FROM (now() - MAX(updated_at))) / 60 AS "age_min"
         FROM agent_composition_sources
         WHERE agent_id = $1 AND source = 'agent_reported'`,
        [agentIdForAge],
      );
      const age = rows[0]?.age_min;
      if (age != null) {
        composition_last_updated_minutes_ago = Math.round(age);
      }
    } catch {
      // Non-fatal: if the query fails (e.g. table missing in target env),
      // leave composition_last_updated_minutes_ago as null.
    }
  }

  // Inline signal attachment: return raw anomaly stats for any skills
  // referenced in these receipts. No synthetic threat_level label — the
  // client sees the anomaly_signal_count, anomaly_signal_rate, and
  // agent_count and decides what to surface.
  let skill_signals: Array<{
    target: string;
    skill_hash: string;
    skill_name: string | null;
    anomaly_signal_count: number;
    anomaly_signal_rate: number;
    agent_count: number;
    first_seen_at: string | null;
    last_updated_at: string | null;
  }> = [];

  const skillTargets = receipts
    .map((r) => normalizeSystemId(r.target.system_id))
    .filter((id) => id.startsWith('skill:'))
    .map((id) => id.replace('skill:', ''));

  if (skillTargets.length > 0) {
    try {
      const signals = await query<{
        skill_hash: string;
        skill_name: string | null;
        anomaly_signal_count: number;
        anomaly_signal_rate: number;
        agent_count: number;
        first_seen_at: string | null;
        last_updated: string | null;
      }>(
        `SELECT skill_hash AS "skill_hash",
                skill_name AS "skill_name",
                anomaly_signal_count AS "anomaly_signal_count",
                anomaly_signal_rate AS "anomaly_signal_rate",
                agent_count AS "agent_count",
                first_seen_at::text AS "first_seen_at",
                last_updated::text AS "last_updated"
         FROM skill_hashes
         WHERE skill_hash = ANY($1)
           AND (anomaly_signal_count > 0 OR agent_count > 0)`,
        [skillTargets],
      );
      skill_signals = signals.map((s) => ({
        target: `skill:${s.skill_hash}`,
        skill_hash: s.skill_hash,
        skill_name: s.skill_name,
        anomaly_signal_count: s.anomaly_signal_count,
        anomaly_signal_rate: s.anomaly_signal_rate,
        agent_count: s.agent_count,
        first_seen_at: s.first_seen_at,
        last_updated_at: s.last_updated,
      }));
    } catch {
      // Non-blocking: signal attachment failure should not block receipt acceptance
    }
  }

  return c.json({
    accepted: receiptIds.length,
    receipt_ids: receiptIds,
    skill_signals,
    composition_last_updated_minutes_ago,
  }, 201);
});

export { app as receiptsRoute };
