import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'coverage' });
const app = new Hono();

/**
 * GET /agent/{id}/coverage — Raw signal coverage over the agent's history.
 *
 * Returns observed counts describing what fields the agent populates on
 * its receipts. No synthetic state labels, no narrative advice.
 *
 * The `rules` array returns every coverage rule the server evaluates,
 * with the rule's condition as a string, the observed inputs that were
 * checked, and a triggered flag. Clients see all rules and all inputs
 * — nothing hidden. Clients decide whether a triggered rule is worth
 * acting on and how to phrase the suggestion in the UI.
 *
 * Free tier.
 */

interface RuleResult {
  signal: string;
  rule: string;
  observed: Record<string, number>;
  triggered: boolean;
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

  // Rules: every coverage rule evaluated, with its condition as a
  // string, the observed inputs, and whether it triggered. Max
  // transparency: clients see the full rule set and all inputs.
  // categories.activity_class is a soft rule — the server flags when
  // no receipts carry it, but the taxonomy itself is non-gating and
  // any string value is accepted.
  const rules: RuleResult[] = [
    {
      signal: 'log_interaction',
      rule: 'total_receipts == 0',
      observed: { total_receipts: s.total_receipts },
      triggered: s.total_receipts === 0,
    },
    {
      signal: 'chain_id',
      rule: 'total_receipts > 0 AND chain_coverage < 0.25',
      observed: {
        total_receipts: s.total_receipts,
        chain_coverage: Math.round(s.chain_coverage * 1000) / 1000,
      },
      triggered: s.total_receipts > 0 && s.chain_coverage < 0.25,
    },
    {
      signal: 'interaction.category',
      rule: 'total_receipts > 20 AND distinct_categories < 3',
      observed: {
        total_receipts: s.total_receipts,
        distinct_categories: s.distinct_categories,
      },
      triggered: s.total_receipts > 20 && s.distinct_categories < 3,
    },
    {
      signal: 'interaction.queue_wait_ms',
      rule: 'total_receipts > 20 AND receipts_with_queue_wait == 0',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_queue_wait: s.receipts_with_queue_wait,
      },
      triggered: s.total_receipts > 20 && s.receipts_with_queue_wait === 0,
    },
    {
      signal: 'interaction.retry_count',
      rule: 'total_receipts > 20 AND receipts_with_retry_count == 0',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_retry_count: s.receipts_with_retry_count,
      },
      triggered: s.total_receipts > 20 && s.receipts_with_retry_count === 0,
    },
    {
      signal: 'target.system_type',
      rule: 'total_receipts > 50 AND distinct_target_types < 2',
      observed: {
        total_receipts: s.total_receipts,
        distinct_target_types: s.distinct_target_types,
      },
      triggered: s.total_receipts > 50 && s.distinct_target_types < 2,
    },
    {
      // Soft rule: any string is accepted for activity_class. The taxonomy
      // (application, language, math, visuals, creative, deterministic,
      // sound) is a suggestion, not a gate. This rule fires when the
      // agent hasn't set the field at all on a meaningful number of
      // receipts. Not required; purely informative.
      signal: 'categories.activity_class',
      rule: 'total_receipts > 20 AND receipts_with_activity_class == 0',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_activity_class: s.receipts_with_activity_class,
      },
      triggered: s.total_receipts > 20 && s.receipts_with_activity_class === 0,
    },
    {
      signal: 'categories.*',
      rule: 'total_receipts > 100 AND receipts_with_any_category * 2 < total_receipts',
      observed: {
        total_receipts: s.total_receipts,
        receipts_with_any_category: s.receipts_with_any_category,
      },
      triggered: s.total_receipts > 100 && s.receipts_with_any_category * 2 < s.total_receipts,
    },
  ];

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
    rules,
    tier: 'free',
  });
});

export { app as coverageRoute };
