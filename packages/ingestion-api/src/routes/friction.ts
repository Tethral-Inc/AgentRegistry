import { Hono } from 'hono';
import {
  FrictionScope,
  query,
  makeError,
  createLogger,
} from '@acr/shared';

import { sha256 } from '@acr/shared';

const log = createLogger({ name: 'friction' });
const app = new Hono();

async function checkPaidTier(apiKey: string): Promise<boolean> {
  try {
    const keyHash = sha256(apiKey);
    const row = await query<{ tier: string; revoked: boolean }>(
      `SELECT tier AS "tier", revoked AS "revoked"
       FROM api_keys WHERE key_hash = $1`,
      [keyHash],
    );
    if (row.length === 0 || row[0]!.revoked) return false;
    return row[0]!.tier !== 'free';
  } catch {
    return false;
  }
}

function getScopeWindow(scope: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (scope) {
    case 'session':
      start.setHours(start.getHours() - 1);
      break;
    case 'day':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }

  return { start, end };
}

app.get('/agent/:agent_id/friction', async (c) => {
  const agentId = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'day';

  const scopeParsed = FrictionScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be session, day, or week'), 400);
  }

  const scope = scopeParsed.data;
  const { start, end } = getScopeWindow(scope);
  const scopeMs = end.getTime() - start.getTime();

  // Query receipts for this agent within the time scope
  const rows = await query<{
    target_system_id: string;
    target_system_type: string;
    duration_ms: number | null;
    status: string;
  }>(
    `SELECT target_system_id AS "target_system_id",
            target_system_type AS "target_system_type",
            duration_ms AS "duration_ms",
            status AS "status"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3
     ORDER BY created_at DESC`,
    [agentId, start.toISOString(), end.toISOString()],
  );

  if (rows.length === 0) {
    return c.json({
      agent_id: agentId,
      scope,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      summary: {
        total_interactions: 0,
        total_wait_time_ms: 0,
        friction_percentage: 0,
        total_failures: 0,
        failure_rate: 0,
      },
      top_targets: [],
    });
  }

  // Group by target
  const targetMap = new Map<string, {
    system_type: string;
    durations: number[];
    failures: number;
  }>();

  let totalWaitMs = 0;
  let totalFailures = 0;

  for (const row of rows) {
    const dur = row.duration_ms ?? 0;
    totalWaitMs += dur;
    const isFailed = row.status !== 'success';
    if (isFailed) totalFailures++;

    let entry = targetMap.get(row.target_system_id);
    if (!entry) {
      entry = { system_type: row.target_system_type, durations: [], failures: 0 };
      targetMap.set(row.target_system_id, entry);
    }
    entry.durations.push(dur);
    if (isFailed) entry.failures++;
  }

  // Sprint 4: Fetch population baselines for vs_baseline comparison
  const baselines = await query<{
    target_class: string;
    baseline_median_ms: number;
    baseline_p95_ms: number;
    volatility_score: number;
  }>(
    `SELECT target_class AS "target_class",
            baseline_median_ms AS "baseline_median_ms",
            baseline_p95_ms AS "baseline_p95_ms",
            volatility_score AS "volatility_score"
     FROM friction_baselines`,
  ).catch(() => [] as Array<{ target_class: string; baseline_median_ms: number; baseline_p95_ms: number; volatility_score: number }>);

  const baselineMap = new Map(baselines.map((b) => [b.target_class, b]));

  // Compute total agent count for percentile ranking
  const agentCountResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT emitter_agent_id)::text AS count
     FROM interaction_receipts
     WHERE created_at >= $1 AND created_at <= $2`,
    [start.toISOString(), end.toISOString()],
  ).catch(() => [{ count: '0' }]);

  const totalAgents = parseInt(agentCountResult[0]?.count ?? '0', 10);

  // Build top_targets sorted by total_duration_ms desc
  const targets = Array.from(targetMap.entries())
    .map(([targetId, data]) => {
      const sorted = [...data.durations].sort((a, b) => a - b);
      const totalDur = sorted.reduce((a, b) => a + b, 0);
      const medianIdx = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? Math.round((sorted[medianIdx - 1]! + sorted[medianIdx]!) / 2)
        : sorted[medianIdx]!;

      // Sprint 4: vs_baseline and p95
      const baseline = baselineMap.get(targetId);
      const p95Idx = Math.ceil(sorted.length * 0.95) - 1;
      const p95 = sorted[Math.max(0, p95Idx)] ?? median;

      const target: Record<string, unknown> = {
        target_system_id: targetId,
        target_system_type: data.system_type,
        interaction_count: data.durations.length,
        total_duration_ms: totalDur,
        proportion_of_total: totalWaitMs > 0 ? totalDur / totalWaitMs : 0,
        failure_count: data.failures,
        median_duration_ms: median,
      };

      // Add Sprint 4 fields if baselines exist
      if (baseline) {
        target.vs_baseline = baseline.baseline_median_ms > 0
          ? Math.round((median / baseline.baseline_median_ms) * 100) / 100
          : null;
        target.volatility = Math.round(baseline.volatility_score * 1000) / 1000;
        target.p95_duration_ms = p95;
      }

      return target;
    })
    .sort((a, b) => (b.total_duration_ms as number) - (a.total_duration_ms as number))
    .slice(0, 10);

  const frictionPercentage = scopeMs > 0 ? (totalWaitMs / scopeMs) * 100 : 0;

  // Sprint 4: Check API key tier for full vs limited response
  const apiKey = c.req.header('x-api-key');
  const isPaidTier = apiKey ? await checkPaidTier(apiKey) : false;

  // Free tier: summary + top 3 targets only
  // Paid tier: summary + top 10 targets with component-level breakdown
  const visibleTargets = isPaidTier ? targets : targets.slice(0, 3);

  // Sprint 4: population_comparison
  const populationComparison = baselines.length > 0 ? {
    total_agents_in_period: totalAgents,
    baselines_available: baselines.length,
  } : undefined;

  return c.json({
    agent_id: agentId,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    summary: {
      total_interactions: rows.length,
      total_wait_time_ms: totalWaitMs,
      friction_percentage: Math.round(frictionPercentage * 1000) / 1000,
      total_failures: totalFailures,
      failure_rate: rows.length > 0 ? Math.round((totalFailures / rows.length) * 1000) / 1000 : 0,
    },
    top_targets: visibleTargets,
    population_comparison: populationComparison,
    tier: isPaidTier ? 'paid' : 'free',
  });
});

export { app as frictionRoute };
