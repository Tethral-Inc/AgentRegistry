import { Hono } from 'hono';
import { query, makeError, createLogger } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'receipts-read' });
const app = new Hono();

interface ReceiptRow {
  receipt_id: string;
  emitter_agent_id: string;
  emitter_composition_hash: string | null;
  emitter_provider_class: string | null;
  target_system_id: string;
  target_system_type: string;
  interaction_category: string;
  request_timestamp_ms: string;
  response_timestamp_ms: string | null;
  duration_ms: number | null;
  status: string;
  anomaly_flagged: boolean;
  anomaly_category: string | null;
  anomaly_detail: string | null;
  created_at: string;
}

/**
 * GET /agent/:identifier/receipts — paginated receipt history (cursor-based).
 * GET /agent/:identifier/receipts?receipt_id=rcpt_... — single receipt detail with context.
 */
app.get('/agent/:identifier/receipts', async (c) => {
  const identifier = c.req.param('identifier');
  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  const receiptId = c.req.query('receipt_id');

  // Single receipt detail mode
  if (receiptId) {
    const rows = await query<ReceiptRow>(
      `SELECT receipt_id AS "receipt_id",
              emitter_agent_id AS "emitter_agent_id",
              emitter_composition_hash AS "emitter_composition_hash",
              emitter_provider_class AS "emitter_provider_class",
              target_system_id AS "target_system_id",
              target_system_type AS "target_system_type",
              interaction_category AS "interaction_category",
              request_timestamp_ms::text AS "request_timestamp_ms",
              response_timestamp_ms::text AS "response_timestamp_ms",
              duration_ms AS "duration_ms",
              status AS "status",
              anomaly_flagged AS "anomaly_flagged",
              anomaly_category AS "anomaly_category",
              anomaly_detail AS "anomaly_detail",
              created_at::text AS "created_at"
       FROM interaction_receipts
       WHERE receipt_id = $1 AND emitter_agent_id = $2
       LIMIT 1`,
      [receiptId, agentId],
    );

    if (rows.length === 0) {
      return c.json(makeError('NOT_FOUND', `Receipt "${receiptId}" not found`), 404);
    }

    const receipt = rows[0]!;

    // Fetch network context for this target (sequential — pool max:1)
    const healthRows = await query<{
      health_status: string;
      failure_rate: number;
      anomaly_rate: number;
      distinct_agent_count: number;
      median_duration_ms: number | null;
      p95_duration_ms: number | null;
    }>(
      `SELECT health_status AS "health_status",
              failure_rate AS "failure_rate",
              anomaly_rate AS "anomaly_rate",
              distinct_agent_count AS "distinct_agent_count",
              median_duration_ms AS "median_duration_ms",
              p95_duration_ms AS "p95_duration_ms"
       FROM system_health
       WHERE system_id = $1
       LIMIT 1`,
      [receipt.target_system_id],
    ).catch(() => []);

    // Fetch baseline for this target
    const baselineRows = await query<{
      baseline_median_ms: number;
      baseline_p95_ms: number;
      volatility_score: number;
    }>(
      `SELECT baseline_median_ms AS "baseline_median_ms",
              baseline_p95_ms AS "baseline_p95_ms",
              volatility_score AS "volatility_score"
       FROM friction_baselines
       WHERE target_class = $1
       LIMIT 1`,
      [receipt.target_system_id],
    ).catch(() => []);

    return c.json({
      agent_id: agentId,
      name: agentName,
      receipt,
      network_context: healthRows[0] ?? null,
      baseline: baselineRows[0] ?? null,
    });
  }

  // List mode — cursor-based pagination
  const limitParam = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Math.max(1, limitParam), 200);
  const cursor = c.req.query('cursor'); // created_at of last item
  const target = c.req.query('target');
  const category = c.req.query('category');
  const status = c.req.query('status');
  const anomaly = c.req.query('anomaly');
  const since = c.req.query('since');
  const until = c.req.query('until');

  // Build dynamic WHERE
  const conditions: string[] = ['emitter_agent_id = $1'];
  const params: unknown[] = [agentId];

  if (cursor) {
    params.push(cursor);
    conditions.push(`created_at < $${params.length}`);
  }
  if (target) {
    params.push(target);
    conditions.push(`target_system_id = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`interaction_category = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (anomaly === 'true') {
    conditions.push('anomaly_flagged = true');
  }
  if (since) {
    params.push(since);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (until) {
    params.push(until);
    conditions.push(`created_at <= $${params.length}`);
  }

  params.push(limit + 1); // fetch one extra to detect next page
  const sql = `SELECT receipt_id AS "receipt_id",
                      emitter_agent_id AS "emitter_agent_id",
                      emitter_composition_hash AS "emitter_composition_hash",
                      emitter_provider_class AS "emitter_provider_class",
                      target_system_id AS "target_system_id",
                      target_system_type AS "target_system_type",
                      interaction_category AS "interaction_category",
                      request_timestamp_ms::text AS "request_timestamp_ms",
                      response_timestamp_ms::text AS "response_timestamp_ms",
                      duration_ms AS "duration_ms",
                      status AS "status",
                      anomaly_flagged AS "anomaly_flagged",
                      anomaly_category AS "anomaly_category",
                      anomaly_detail AS "anomaly_detail",
                      created_at::text AS "created_at"
               FROM interaction_receipts
               WHERE ${conditions.join(' AND ')}
               ORDER BY created_at DESC, receipt_id DESC
               LIMIT $${params.length}`;

  const rows = await query<ReceiptRow>(sql, params);

  const hasMore = rows.length > limit;
  const receipts = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && receipts.length > 0
    ? receipts[receipts.length - 1]!.created_at
    : null;

  return c.json({
    agent_id: agentId,
    name: agentName,
    receipts,
    next_cursor: nextCursor,
    limit,
  });
});

export { app as receiptsReadRoute };
