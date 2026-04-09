import { Hono } from 'hono';
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

const log = createLogger({ name: 'receipts' });
const app = new Hono();

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

  const receiptIds: string[] = [];

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

    await execute(
      `INSERT INTO interaction_receipts (
        receipt_id, emitter_agent_id, emitter_composition_hash, emitter_provider_class,
        target_system_id, target_system_type, interaction_category,
        request_timestamp_ms, response_timestamp_ms, duration_ms, status,
        anomaly_flagged, anomaly_category, anomaly_detail,
        transport_type, source,
        queue_wait_ms, retry_count, error_code, response_size_bytes,
        chain_id, chain_position, preceded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23)
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
        receipt.chain_id ?? null,
        receipt.chain_position ?? null,
        receipt.preceded_by ?? null,
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

  // Inline threat check: warn if any targets are known-bad skills
  let threat_warnings: Array<{ target: string; threat_level: string; skill_name?: string }> = [];
  const skillTargets = receipts
    .map((r) => normalizeSystemId(r.target.system_id))
    .filter((id) => id.startsWith('skill:'))
    .map((id) => id.replace('skill:', ''));

  if (skillTargets.length > 0) {
    try {
      const threats = await query<{ skill_hash: string; threat_level: string; skill_name: string | null }>(
        `SELECT skill_hash AS "skill_hash", threat_level AS "threat_level", skill_name AS "skill_name"
         FROM skill_hashes
         WHERE skill_hash = ANY($1) AND threat_level IN ('medium', 'high', 'critical')`,
        [skillTargets],
      );
      threat_warnings = threats.map((t) => ({
        target: `skill:${t.skill_hash}`,
        threat_level: t.threat_level,
        skill_name: t.skill_name ?? undefined,
      }));
    } catch {
      // Non-blocking: threat check failure should not block receipt acceptance
    }
  }

  return c.json({
    accepted: receiptIds.length,
    receipt_ids: receiptIds,
    threat_warnings,
  }, 201);
});

export { app as receiptsRoute };
