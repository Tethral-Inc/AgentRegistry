import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'coverage' });
const app = new Hono();

/**
 * GET /agent/{id}/coverage — Raw signal coverage over the agent's history.
 *
 * Returns observed counts describing what fields the agent populates on
 * its receipts. No synthetic state labels (warmup / calibrating / ...),
 * no narrative advice. Triggers describe what the server observed and
 * what rule was applied. Clients decide whether a trigger is worth
 * acting on and how to phrase the suggestion in the UI.
 *
 * Free tier.
 */

interface Trigger {
  signal: string;
  rule: string;
  observed: Record<string, number>;
}

app.get('/agent/:agent_id/coverage', async (c) => {
  const identifier = c.req.param('agent_id');
  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;

  // Coverage stats over the agent's full receipt history.
  const stats = await query<{
    total_receipts: number;
    distinct_targets: number;
    distinct_categories: number;
    distinct_chains: number;
    chain_coverage: number;
    receipts_with_queue_wait: number;
    receipts_with_retry_count: number;
    receipts_with_anomaly_flag: number;
    distinct_target_types: number;
    receipts_with_activity_class: number;
    receipts_with_any_category: number;
  }>(
    `SELECT
       COUNT(*)::int AS "total_receipts",
       COUNT(DISTINCT target_system_id)::int AS "distinct_targets",
       COUNT(DISTINCT interaction_category)::int AS "distinct_categories",
       COUNT(DISTINCT chain_id) FILTER (WHERE chain_id IS NOT NULL)::int AS "distinct_chains",
       COALESCE(
         COUNT(*) FILTER (WHERE chain_id IS NOT NULL)::float /
         NULLIF(COUNT(*), 0), 0
       ) AS "chain_coverage",
       COUNT(*) FILTER (WHERE queue_wait_ms IS NOT NULL)::int AS "receipts_with_queue_wait",
       COUNT(*) FILTER (WHERE retry_count IS NOT NULL AND retry_count > 0)::int AS "receipts_with_retry_count",
       COUNT(*) FILTER (WHERE anomaly_flagged = true)::int AS "receipts_with_anomaly_flag",
       COUNT(DISTINCT target_system_type)::int AS "distinct_target_types",
       COUNT(*) FILTER (WHERE categories ? 'activity_class')::int AS "receipts_with_activity_class",
       COUNT(*) FILTER (WHERE categories IS NOT NULL AND categories != '{}'::jsonb)::int AS "receipts_with_any_category"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1`,
    [agentId],
  ).catch(() => []);

  const s = stats[0] ?? {
    total_receipts: 0,
    distinct_targets: 0,
    distinct_categories: 0,
    distinct_chains: 0,
    chain_coverage: 0,
    receipts_with_queue_wait: 0,
    receipts_with_retry_count: 0,
    receipts_with_anomaly_flag: 0,
    distinct_target_types: 0,
    receipts_with_activity_class: 0,
    receipts_with_any_category: 0,
  };

  // Triggers: each trigger states the rule that fired, the observed inputs
  // it fired on, and the signal field it's about. No prose, no "unlocks"
  // list, no advice. The MCP presenter composes the suggestion text from
  // this structured data if it wants to.
  const triggers: Trigger[] = [];

  if (s.total_receipts === 0) {
    triggers.push({
      signal: 'log_interaction',
      rule: 'total_receipts == 0',
      observed: { total_receipts: 0 },
    });
  }

  if (s.total_receipts > 0 && s.chain_coverage < 0.25) {
    triggers.push({
      signal: 'chain_id',
      rule: 'chain_coverage < 0.25',
      observed: {
        total_receipts: s.total_receipts,
        chain_coverage: Math.round(s.chain_coverage * 1000) / 1000,
      },
    });
  }

  if (s.total_receipts > 20 && s.distinct_categories < 3) {
    triggers.push({
      signal: 'interaction.category',
      rule: 'distinct_categories < 3 AND total_receipts > 20',
      observed: {
        total_receipts: s.total_receipts,
        distinct_categories: s.distinct_categories,
      },
    });
  }

  if (s.total_receipts > 20 && s.receipts_with_queue_wait === 0) {
    triggers.push({
      signal: 'interaction.queue_wait_ms',
      rule: 'receipts_with_queue_wait == 0 AND total_receipts > 20',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_queue_wait: 0,
      },
    });
  }

  if (s.total_receipts > 20 && s.receipts_with_retry_count === 0) {
    triggers.push({
      signal: 'interaction.retry_count',
      rule: 'receipts_with_retry_count == 0 AND total_receipts > 20',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_retry_count: 0,
      },
    });
  }

  if (s.total_receipts > 50 && s.distinct_target_types < 2) {
    triggers.push({
      signal: 'target.system_type',
      rule: 'distinct_target_types < 2 AND total_receipts > 50',
      observed: {
        total_receipts: s.total_receipts,
        distinct_target_types: s.distinct_target_types,
      },
    });
  }

  if (s.total_receipts > 20 && s.receipts_with_activity_class === 0) {
    triggers.push({
      signal: 'categories.activity_class',
      rule: 'receipts_with_activity_class == 0 AND total_receipts > 20',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_activity_class: 0,
      },
    });
  }

  if (s.total_receipts > 100 && s.receipts_with_any_category < s.total_receipts / 2) {
    triggers.push({
      signal: 'categories.*',
      rule: 'receipts_with_any_category < total_receipts / 2 AND total_receipts > 100',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_any_category: s.receipts_with_any_category,
      },
    });
  }

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    signals: {
      total_receipts: s.total_receipts,
      distinct_targets: s.distinct_targets,
      distinct_categories: s.distinct_categories,
      distinct_chains: s.distinct_chains,
      distinct_target_types: s.distinct_target_types,
      chain_coverage: Math.round(s.chain_coverage * 1000) / 1000,
      receipts_with_queue_wait: s.receipts_with_queue_wait,
      receipts_with_retry_count: s.receipts_with_retry_count,
      receipts_with_anomaly_flag: s.receipts_with_anomaly_flag,
      receipts_with_activity_class: s.receipts_with_activity_class,
      receipts_with_any_category: s.receipts_with_any_category,
    },
    triggers,
    tier: 'free',
  });
});

export { app as coverageRoute };
