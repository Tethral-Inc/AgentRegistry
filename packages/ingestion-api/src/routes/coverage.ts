import { Hono } from 'hono';
import { query, createLogger } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'coverage' });
const app = new Hono();

/**
 * GET /agent/{id}/coverage — Data sufficiency view.
 *
 * Tells the operator how much data they have, where the gaps are, and
 * what they should log differently to unlock more analytical surfaces.
 *
 * Free tier. The recommendations themselves are templated — no ML, no
 * personalization, just rule-based suggestions based on what the receipt
 * stream looks like.
 *
 * Thin client principle: this is the answer to "what should the agent log
 * more of?" — a question the MCP cannot answer locally because it has no
 * historical view. The server has all of it.
 */

interface Recommendation {
  signal: string;
  reason: string;
  unlocks: string[];
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
       COUNT(DISTINCT target_system_type)::int AS "distinct_target_types"
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
  };

  // Maturity / coverage states (same logic as profile.ts so they stay aligned).
  let maturityState: 'warmup' | 'calibrating' | 'stable_candidate';
  if (s.total_receipts <= 0 || s.distinct_targets <= 0) maturityState = 'warmup';
  else if (s.total_receipts < 50 || s.distinct_targets < 3) maturityState = 'warmup';
  else if (s.total_receipts < 250 || s.distinct_targets < 5) maturityState = 'calibrating';
  else maturityState = 'stable_candidate';

  let coverageState: 'uninitialized' | 'narrow' | 'observed';
  if (s.total_receipts <= 0 || s.distinct_targets <= 0 || s.distinct_categories <= 0) coverageState = 'uninitialized';
  else if (s.distinct_targets < 4 || s.distinct_categories < 3) coverageState = 'narrow';
  else coverageState = 'observed';

  // Templated recommendations — pure rule-based, no ML.
  const recommendations: Recommendation[] = [];

  if (s.total_receipts === 0) {
    recommendations.push({
      signal: 'log_interaction',
      reason: 'No receipts logged yet. Call log_interaction after every external tool call to start building your interaction profile.',
      unlocks: ['friction lens', 'coverage analysis', 'healthy corridors', 'failure registry', 'trend detection'],
    });
  }

  if (s.total_receipts > 0 && s.chain_coverage < 0.25) {
    recommendations.push({
      signal: 'chain_id',
      reason: 'Less than 25% of your receipts include a chain_id. Sequential tool calls in the same workflow should share a chain_id so chain analysis can detect overhead between steps.',
      unlocks: ['chain analysis', 'directional friction (Pro)', 'chain pattern detection (Pro)'],
    });
  }

  if (s.total_receipts > 20 && s.distinct_categories < 3) {
    recommendations.push({
      signal: 'interaction.category',
      reason: 'You are only logging 1-2 interaction categories. Use specific categories (tool_call, data_exchange, commerce, communication, etc.) so the friction lens can break down by category.',
      unlocks: ['category breakdown in friction reports'],
    });
  }

  if (s.total_receipts > 20 && s.receipts_with_queue_wait === 0) {
    recommendations.push({
      signal: 'interaction.queue_wait_ms',
      reason: 'No receipts include queue_wait_ms. If your tool call waited in a queue before execution, log that wait separately so the friction lens can attribute time correctly.',
      unlocks: ['queue overhead attribution in friction lens'],
    });
  }

  if (s.total_receipts > 20 && s.receipts_with_retry_count === 0) {
    recommendations.push({
      signal: 'interaction.retry_count',
      reason: 'No receipts include retry_count. If your tool call retried before succeeding, log the retry count so retry overhead can be attributed.',
      unlocks: ['retry overhead attribution (Pro)'],
    });
  }

  if (s.total_receipts > 50 && s.distinct_target_types < 2) {
    recommendations.push({
      signal: 'target.system_type',
      reason: 'You are only logging one type of target system. If your agent calls APIs in addition to MCP tools, log them too — the friction lens compares performance across system types.',
      unlocks: ['cross-system-type comparison'],
    });
  }

  c.header('Cache-Control', 'private, max-age=60');

  return c.json({
    agent_id: agentId,
    coverage_state: coverageState,
    maturity_state: maturityState,
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
    },
    recommendations,
    tier: 'free',
  });
});

export { app as coverageRoute };
