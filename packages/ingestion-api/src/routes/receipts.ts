import { Hono } from 'hono';
import {
  InteractionReceiptSchema,
  ReceiptBatchSchema,
  generateReceiptId,
  normalizeSystemId,
  execute,
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
        anomaly_flagged, anomaly_category, anomaly_detail
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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

  return c.json({
    accepted: receiptIds.length,
    receipt_ids: receiptIds,
  }, 201);
});

export { app as receiptsRoute };
