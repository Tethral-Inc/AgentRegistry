import { Hono } from 'hono';
import {
  FrictionScope,
  query,
  makeError,
  createLogger,
} from '@acr/shared';

import { sha256 } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';

const log = createLogger({ name: 'friction' });
const app = new Hono();

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
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
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
  const identifier = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'day';

  const scopeParsed = FrictionScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be session, day, yesterday, or week'), 400);
  }

  const scope = scopeParsed.data;
  const { start, end } = getScopeWindow(scope);

  // Optional transport_type and source filters
  const transportFilter = c.req.query('transport_type');
  const sourceFilter = c.req.query('source');
  // Environmental probes (background reachability checks) are emitted as
  // the agent's own agent_id but represent baseline network health, not
  // agent work. Excluding them by default keeps totals, friction_percentage,
  // failure_rate, and top targets focused on what the agent actually did.
  // Opt-in via ?include_env=1 for operators who want the full picture.
  const includeEnv = c.req.query('include_env') === '1';

  // Resolve name or agent_id
  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  // Query receipts for this agent within the time scope
  const queryParams: unknown[] = [agentId, start.toISOString(), end.toISOString()];
  let whereExtra = '';
  if (transportFilter) {
    queryParams.push(transportFilter);
    whereExtra += ` AND transport_type = $${queryParams.length}`;
  }
  if (sourceFilter) {
    queryParams.push(sourceFilter);
    whereExtra += ` AND source = $${queryParams.length}`;
  } else if (!includeEnv) {
    whereExtra += ` AND (source IS NULL OR source != 'environmental')`;
  }

  const rows = await query<{
    target_system_id: string;
    target_system_type: string;
    interaction_category: string;
    duration_ms: number | null;
    status: string;
    anomaly_flagged: boolean;
    anomaly_category: string | null;
    anomaly_detail: string | null;
    transport_type: string | null;
    source: string | null;
    created_at: string;
    queue_wait_ms: number;
    retry_count: number;
    error_code: string | null;
    chain_id: string | null;
    chain_position: number | null;
    preceded_by: string | null;
    tokens_used: number | null;
  }>(
    `SELECT target_system_id AS "target_system_id",
            target_system_type AS "target_system_type",
            interaction_category AS "interaction_category",
            COALESCE(duration_ms, 0)::int AS "duration_ms",
            status AS "status",
            anomaly_flagged AS "anomaly_flagged",
            anomaly_category AS "anomaly_category",
            anomaly_detail AS "anomaly_detail",
            transport_type AS "transport_type",
            source AS "source",
            created_at::text AS "created_at",
            COALESCE(queue_wait_ms, 0)::int AS "queue_wait_ms",
            COALESCE(retry_count, 0)::int AS "retry_count",
            error_code AS "error_code",
            chain_id AS "chain_id",
            chain_position AS "chain_position",
            preceded_by AS "preceded_by",
            tokens_used AS "tokens_used"
     FROM interaction_receipts
     WHERE emitter_agent_id = $1
       AND created_at >= $2
       AND created_at <= $3${whereExtra}
     ORDER BY created_at DESC`,
    queryParams,
  );

  if (rows.length === 0) {
    return c.json({
      agent_id: agentId,
      name: agentName,
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
    failedTokensUsed: number;
    statuses: Map<string, number>;
    anomalies: Array<{ category: string | null; detail: string | null; timestamp: string }>;
  }>();

  // Group by category
  const categoryMap = new Map<string, { count: number; total_ms: number; failures: number }>();

  // Group by error_code (only populated on failures). Lets the user see
  // "401: 6 hits, all Slack" instead of just a failure percentage —
  // concrete + actionable, same data we already loaded.
  const errorCodeMap = new Map<string, Map<string, number>>();

  let totalWaitMs = 0;
  let totalFailures = 0;
  let totalTokensUsed = 0;

  for (const row of rows) {
    const dur = row.duration_ms ?? 0;
    totalWaitMs += dur;
    const isFailed = row.status !== 'success';
    if (isFailed) totalFailures++;
    totalTokensUsed += row.tokens_used ?? 0;

    // Target grouping
    let entry = targetMap.get(row.target_system_id);
    if (!entry) {
      entry = { system_type: row.target_system_type, durations: [], failures: 0, failedTokensUsed: 0, statuses: new Map(), anomalies: [] };
      targetMap.set(row.target_system_id, entry);
    }
    entry.durations.push(dur);
    if (isFailed) {
      entry.failures++;
      if (row.tokens_used != null) entry.failedTokensUsed += row.tokens_used;
    }
    entry.statuses.set(row.status, (entry.statuses.get(row.status) ?? 0) + 1);
    if (row.anomaly_flagged && entry.anomalies.length < 3) {
      entry.anomalies.push({
        category: row.anomaly_category,
        detail: row.anomaly_detail,
        timestamp: row.created_at,
      });
    }

    // Category grouping
    const cat = categoryMap.get(row.interaction_category) ?? { count: 0, total_ms: 0, failures: 0 };
    cat.count++;
    cat.total_ms += dur;
    if (isFailed) cat.failures++;
    categoryMap.set(row.interaction_category, cat);

    // Error-code grouping (failures only; error_code is null for success)
    if (isFailed && row.error_code) {
      let perTarget = errorCodeMap.get(row.error_code);
      if (!perTarget) { perTarget = new Map(); errorCodeMap.set(row.error_code, perTarget); }
      perTarget.set(row.target_system_id, (perTarget.get(row.target_system_id) ?? 0) + 1);
    }
  }

  // Flatten error code map into sorted summary. Top target is surfaced
  // per code so the user sees "401: 6 (mostly Slack)" at a glance.
  const byErrorCode = Array.from(errorCodeMap.entries())
    .map(([error_code, perTarget]) => {
      let count = 0;
      let topTarget = '';
      let topTargetCount = 0;
      for (const [tid, c] of perTarget) {
        count += c;
        if (c > topTargetCount) { topTargetCount = c; topTarget = tid; }
      }
      return { error_code, count, top_target: topTarget, top_target_count: topTargetCount };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── Chain Analysis (free tier) ──
  // After server-side chain inference (W2.2) every receipt picks up a
  // chain_id even when it's a lone call, so the raw chainMap is padded
  // with hundreds of length-1 "chains" that aren't chains at all. We
  // only surface chainMap entries with ≥2 receipts so chain_count and
  // avg_chain_length reflect actual multi-step workflows.
  const chainMapAll = new Map<string, { targets: string[]; durations: number[] }>();
  for (const row of rows) {
    if (!row.chain_id) continue;
    let chain = chainMapAll.get(row.chain_id);
    if (!chain) { chain = { targets: [], durations: [] }; chainMapAll.set(row.chain_id, chain); }
    chain.targets.push(row.target_system_id);
    chain.durations.push(row.duration_ms ?? 0);
  }
  const chainMap = new Map(
    Array.from(chainMapAll.entries()).filter(([, c]) => c.targets.length >= 2),
  );

  let chainAnalysis: { chain_count: number; avg_chain_length: number; total_chain_overhead_ms: number; top_patterns?: unknown[] } | undefined;
  if (chainMap.size > 0) {
    const lengths = Array.from(chainMap.values()).map(c => c.targets.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    // Overhead approximation: sum of queue_wait_ms for chained calls.
    // Only count rows whose chain survived the length≥2 filter.
    let totalOverhead = 0;
    for (const row of rows) {
      if (row.chain_id && chainMap.has(row.chain_id) && row.queue_wait_ms) {
        totalOverhead += row.queue_wait_ms;
      }
    }
    chainAnalysis = {
      chain_count: chainMap.size,
      avg_chain_length: Math.round(avgLen * 10) / 10,
      total_chain_overhead_ms: totalOverhead,
    };
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
  ).catch((err) => { log.debug({ err }, 'Failed to fetch friction baselines'); return [] as Array<{ target_class: string; baseline_median_ms: number; baseline_p95_ms: number; volatility_score: number }>; });

  const baselineMap = new Map(baselines.map((b) => [b.target_class, b]));

  // Compute total agent count for percentile ranking
  const agentCountResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT emitter_agent_id)::text AS count
     FROM interaction_receipts
     WHERE created_at >= $1 AND created_at <= $2`,
    [start.toISOString(), end.toISOString()],
  ).catch(() => [{ count: '0' }]);

  const totalAgents = parseInt(agentCountResult[0]?.count ?? '0', 10);

  // Compute total wasted tokens across all targets before building targets array
  let wastedTokensTotal = 0;
  for (const entry of targetMap.values()) {
    wastedTokensTotal += entry.failedTokensUsed;
  }

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

      // Status breakdown (e.g. { success: 8, timeout: 2 })
      const statusBreakdown: Record<string, number> = {};
      for (const [s, c] of data.statuses) {
        statusBreakdown[s] = c;
      }

      const target: Record<string, unknown> = {
        target_system_id: targetId,
        target_system_type: data.system_type,
        interaction_count: data.durations.length,
        total_duration_ms: totalDur,
        proportion_of_total: totalWaitMs > 0 ? totalDur / totalWaitMs : 0,
        failure_count: data.failures,
        median_duration_ms: median,
        p95_duration_ms: p95,
        status_breakdown: statusBreakdown,
      };

      // Add baseline comparison fields if baselines exist
      if (baseline) {
        target.vs_baseline = baseline.baseline_median_ms > 0
          ? Math.round((median / baseline.baseline_median_ms) * 100) / 100
          : null;
        target.baseline_median_ms = baseline.baseline_median_ms;
        target.baseline_p95_ms = baseline.baseline_p95_ms;
        target.volatility = Math.round(baseline.volatility_score * 1000) / 1000;
      }

      // Add recent anomalies if any
      if (data.anomalies.length > 0) {
        target.recent_anomalies = data.anomalies;
      }

      // Wasted tokens from failed calls
      if (data.failedTokensUsed > 0) {
        target.wasted_tokens = data.failedTokensUsed;
      }

      return target;
    })
    .sort((a, b) => (b.total_duration_ms as number) - (a.total_duration_ms as number))
    .slice(0, 10);

  // Burst-based active span for friction_percentage denominator.
  //
  // The original formula used the full scope window (e.g. 24h for scope=day)
  // as the denominator, which made friction_percentage dominated by idle
  // time — agents that worked for 20 minutes inside a 24h window would
  // report ~0% friction no matter how slow the work was. The observation
  // principle says: the denominator should be the time the agent was
  // actually active, not the wall-clock window.
  //
  // We compute active time by sorting receipt timestamps, grouping them
  // into bursts separated by gaps > BURST_GAP_MS, and summing each
  // burst's duration (max - min). A single-receipt burst contributes the
  // receipt's own duration. We floor the total at MIN_ACTIVE_MS so a
  // handful of fast calls doesn't produce a denominator so small the
  // percentage explodes past 100%.
  const BURST_GAP_MS = 10 * 60 * 1000; // 10 minutes
  const MIN_ACTIVE_MS = 60 * 1000;     // 60 seconds floor
  const timestamps = rows
    .map((r) => ({ ts: new Date(r.created_at).getTime(), dur: r.duration_ms ?? 0 }))
    .filter((r) => Number.isFinite(r.ts))
    .sort((a, b) => a.ts - b.ts);

  let activeMs = 0;
  if (timestamps.length > 0) {
    let burstStart = timestamps[0]!.ts;
    let burstEnd = timestamps[0]!.ts + (timestamps[0]!.dur ?? 0);
    for (let i = 1; i < timestamps.length; i++) {
      const { ts, dur } = timestamps[i]!;
      if (ts - burstEnd > BURST_GAP_MS) {
        activeMs += Math.max(burstEnd - burstStart, 0);
        burstStart = ts;
        burstEnd = ts + (dur ?? 0);
      } else {
        burstEnd = Math.max(burstEnd, ts + (dur ?? 0));
      }
    }
    activeMs += Math.max(burstEnd - burstStart, 0);
  }
  const activeSpanMs = Math.max(activeMs, MIN_ACTIVE_MS);
  const frictionPercentage = (totalWaitMs / activeSpanMs) * 100;

  // Enrich targets with network-wide system health
  const targetIds = Array.from(targetMap.keys());
  const healthRows = targetIds.length > 0
    ? await query<{
        system_id: string;
        failure_rate: number;
        anomaly_rate: number;
        distinct_agent_count: number;
        total_interactions: number;
      }>(
        `SELECT system_id AS "system_id",
                failure_rate AS "failure_rate",
                anomaly_rate AS "anomaly_rate",
                distinct_agent_count AS "distinct_agent_count",
                total_interactions::int AS "total_interactions"
         FROM system_health
         WHERE system_id = ANY($1)`,
        [targetIds],
      ).catch((err) => { log.debug({ err }, 'Failed to fetch system health'); return []; })
    : [];

  const healthMap = new Map(healthRows.map((h) => [h.system_id, h]));
  for (const t of targets) {
    const h = healthMap.get(t.target_system_id as string);
    if (h) {
      t.network_failure_rate = h.failure_rate;
      t.network_anomaly_rate = h.anomaly_rate;
      t.network_agent_count = h.distinct_agent_count;
      // Surface the total interaction count so the MCP-side rendering
      // can apply sample-size guards before drawing a verdict from the
      // network failure rate.
      t.network_interaction_count = h.total_interactions;
    }
  }

  // Compute percentile rank: where does this agent's median sit among all
  // agents for each target in this window? Free tier — useful for everyone.
  const targetIdsForPercentile = Array.from(targetMap.keys());
  let percentileMap = new Map<string, number>();
  if (targetIdsForPercentile.length > 0) {
    try {
      const percentileRows = await query<{ target_system_id: string; percentile_rank: number }>(
        `SELECT target_system_id, percentile_rank
         FROM (
           SELECT
             target_system_id,
             emitter_agent_id,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS agent_median,
             PERCENT_RANK() OVER (
               PARTITION BY target_system_id
               ORDER BY PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)
             ) AS percentile_rank
           FROM interaction_receipts
           WHERE created_at >= $1
             AND created_at <= $2
             AND target_system_id = ANY($3)
             AND duration_ms IS NOT NULL
           GROUP BY target_system_id, emitter_agent_id
           HAVING COUNT(*) >= 3
         ) ranked
         WHERE emitter_agent_id = $4`,
        [start.toISOString(), end.toISOString(), targetIdsForPercentile, agentId],
      );
      for (const row of percentileRows) {
        // PERCENT_RANK 0 = fastest (lowest latency), 1 = slowest.
        // Invert so the value = "faster than X fraction of agents"
        percentileMap.set(row.target_system_id, Math.round((1 - row.percentile_rank) * 100));
      }
    } catch (err) {
      log.debug({ err }, 'Percentile rank query failed — non-fatal');
    }
  }

  // Attach percentile_rank to each target object
  for (const t of targets) {
    const rank = percentileMap.get(t.target_system_id as string);
    if (rank !== undefined) {
      t.percentile_rank = rank; // "faster than N% of agents on this target"
    }
  }

  const isPaidTier = (c.req.header('X-ACR-Auth-Tier') ?? 'free') !== 'free';

  // ── Implicit retry detection (transport-boundary observation) ──
  // Observation principle: don't require the agent to set retry_count.
  // Any receipt whose target was just called and failed within
  // IMPLICIT_RETRY_WINDOW_MS is almost certainly a retry, regardless
  // of whether the agent's code labelled it one. We detect those
  // receipts with an EXISTS subquery and sum them into the same
  // retry_overhead structure so the number the agent sees reflects
  // actual retry behaviour, not self-reported retry behaviour.
  const IMPLICIT_RETRY_WINDOW_SECS = 30;
  // The current receipt must not already be a self-reported retry —
  // otherwise the explicit-count pass below would double-count it.
  // We also skip environmental probes (unless include_env=1) so baseline
  // reachability checks don't masquerade as agent retries.
  const implicitRetryRows = await query<{ target_system_id: string; implicit_retries: number; wasted_ms: number }>(
    `SELECT cur.target_system_id AS "target_system_id",
            COUNT(*)::int AS "implicit_retries",
            COALESCE(SUM(cur.duration_ms), 0)::int AS "wasted_ms"
     FROM interaction_receipts cur
     WHERE cur.emitter_agent_id = $1
       AND cur.created_at >= $2
       AND cur.created_at <= $3
       AND COALESCE(cur.retry_count, 0) = 0
       AND ($5::boolean OR cur.source IS NULL OR cur.source != 'environmental')
       AND EXISTS (
         SELECT 1 FROM interaction_receipts prev
         WHERE prev.emitter_agent_id = cur.emitter_agent_id
           AND prev.target_system_id = cur.target_system_id
           AND prev.status != 'success'
           AND prev.created_at < cur.created_at
           AND prev.created_at >= cur.created_at - (INTERVAL '1 second' * $4)
       )
     GROUP BY cur.target_system_id`,
    [agentId, start.toISOString(), end.toISOString(), IMPLICIT_RETRY_WINDOW_SECS, includeEnv],
  ).catch((err) => { log.debug({ err }, 'Implicit retry detection failed'); return [] as Array<{ target_system_id: string; implicit_retries: number; wasted_ms: number }>; });

  // ── Retry Overhead ──
  // Totals (total_retries, total_wasted_ms, implicit_retries) are
  // free-tier: the aggregate is the headline number most users want and
  // gating it behind a paywall hides the very signal the product is
  // trying to surface. The per-target breakdown (top_retry_targets)
  // remains paid.
  const retryMap = new Map<string, { count: number; totalMs: number }>();
  let explicitRetries = 0;
  let explicitWastedMs = 0;
  for (const row of rows) {
    const rc = row.retry_count ?? 0;
    if (rc > 0) {
      explicitRetries += rc;
      const dur = row.duration_ms ?? 0;
      explicitWastedMs += rc * dur;
      const entry = retryMap.get(row.target_system_id) ?? { count: 0, totalMs: 0 };
      entry.count += rc;
      entry.totalMs += rc * dur;
      retryMap.set(row.target_system_id, entry);
    }
  }

  let implicitRetryCount = 0;
  let implicitWastedMs = 0;
  for (const r of implicitRetryRows) {
    implicitRetryCount += r.implicit_retries;
    implicitWastedMs += r.wasted_ms;
    const entry = retryMap.get(r.target_system_id) ?? { count: 0, totalMs: 0 };
    entry.count += r.implicit_retries;
    entry.totalMs += r.wasted_ms;
    retryMap.set(r.target_system_id, entry);
  }

  const totalRetries = explicitRetries + implicitRetryCount;
  const totalWastedMs = explicitWastedMs + implicitWastedMs;

  let retryOverhead: {
    total_retries: number;
    total_wasted_ms: number;
    implicit_retries: number;
    explicit_retries: number;
    detection_window_seconds: number;
    top_retry_targets?: Array<{ target_system_id: string; retry_count: number; avg_duration_ms: number; wasted_ms: number }>;
  } | undefined;
  if (totalRetries > 0) {
    retryOverhead = {
      total_retries: totalRetries,
      total_wasted_ms: totalWastedMs,
      implicit_retries: implicitRetryCount,
      explicit_retries: explicitRetries,
      detection_window_seconds: IMPLICIT_RETRY_WINDOW_SECS,
    };
    if (isPaidTier) {
      retryOverhead.top_retry_targets = Array.from(retryMap.entries())
        .map(([tid, data]) => ({
          target_system_id: tid,
          retry_count: data.count,
          avg_duration_ms: data.count > 0 ? Math.round(data.totalMs / data.count) : 0,
          wasted_ms: data.totalMs,
        }))
        .sort((a, b) => b.wasted_ms - a.wasted_ms)
        .slice(0, 5);
    }
  }

  // ── Population Drift (pro tier) ──
  // Raw comparison only: current median, baseline median, and the
  // percentage change. No synthetic direction label — the client sees
  // the sign of drift_percentage and interprets it.
  let populationDrift: { targets: Array<{ target_system_id: string; current_median_ms: number; baseline_median_ms: number; drift_percentage: number }> } | undefined;
  if (isPaidTier && baselines.length > 0) {
    const driftTargets = [];
    for (const t of targets) {
      const bl = baselines.find(b => b.target_class === t.target_system_id);
      if (bl && bl.baseline_median_ms > 0) {
        const currentMedian = t.median_duration_ms as number;
        const driftPct = ((currentMedian - bl.baseline_median_ms) / bl.baseline_median_ms) * 100;
        driftTargets.push({
          target_system_id: t.target_system_id as string,
          current_median_ms: currentMedian as number,
          baseline_median_ms: bl.baseline_median_ms,
          drift_percentage: Math.round(driftPct * 10) / 10,
        });
      }
    }
    if (driftTargets.length > 0) populationDrift = { targets: driftTargets };
  }

  // ── Directional Pairs (pro tier) ──
  let directionalPairs: Array<{ source_target: string; destination_target: string; avg_duration_when_preceded: number; avg_duration_standalone: number; amplification_factor: number; sample_count: number }> | undefined;
  if (isPaidTier) {
    const targetIds = targets.map(t => t.target_system_id);
    if (targetIds.length > 0) {
      const pairs = await query<{
        source_target: string; destination_target: string;
        avg_duration_when_preceded: number; avg_duration_standalone: number;
        amplification_factor: number; sample_count: number;
      }>(
        `SELECT source_target AS "source_target", destination_target AS "destination_target",
                avg_duration_when_preceded AS "avg_duration_when_preceded",
                avg_duration_standalone AS "avg_duration_standalone",
                amplification_factor AS "amplification_factor",
                sample_count AS "sample_count"
         FROM directional_pairs
         WHERE (source_target = ANY($1) OR destination_target = ANY($1))
           AND analysis_window = 'week'
         ORDER BY amplification_factor DESC
         LIMIT 10`,
        [targetIds],
      ).catch((err) => { log.debug({ err }, 'Failed to fetch directional pairs'); return []; });
      if (pairs.length > 0) directionalPairs = pairs;
    }
  }

  // ── Chain Patterns (pro tier) ──
  if (isPaidTier && chainAnalysis) {
    const patterns = await query<{
      chain_pattern: string[]; frequency: number; avg_overhead_ms: number;
    }>(
      `SELECT chain_pattern AS "chain_pattern", frequency::int AS "frequency",
              avg_overhead_ms AS "avg_overhead_ms"
       FROM chain_analysis
       WHERE agent_id = $1 AND analysis_window = 'day'
       ORDER BY frequency DESC LIMIT 5`,
      [agentId],
    ).catch((err) => { log.debug({ err }, 'Failed to fetch chain patterns'); return []; });
    if (patterns.length > 0) {
      chainAnalysis.top_patterns = patterns;
    }
  }

  // Free tier: top 10 targets, no baseline comparisons.
  // Paid tier: top 10 targets WITH baselines (vs_baseline, volatility, etc.)
  // and drift-over-time analysis.
  //
  // The free/paid split is the comparison, not the count. Capping free-tier
  // at 3 targets hid data the user already owns, and didn't protect any
  // paid differentiator — the paywall value is the population baseline.
  const visibleTargets = isPaidTier ? targets : targets.map((t) => {
    const { vs_baseline, baseline_median_ms, baseline_p95_ms, volatility, ...rest } = t as Record<string, unknown>;
    return rest;
  });

  // Category breakdown (always included)
  const categories = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      interaction_count: data.count,
      total_duration_ms: data.total_ms,
      failure_count: data.failures,
    }))
    .sort((a, b) => b.interaction_count - a.interaction_count);

  // Population comparison (paid tier only)
  const populationComparison = isPaidTier && baselines.length > 0 ? {
    total_agents_in_period: totalAgents,
    baselines_available: baselines.length,
  } : undefined;

  // Transport breakdown
  const transportBreakdown = new Map<string, { count: number; total_ms: number }>();
  const sourceBreakdown = new Map<string, number>();
  for (const row of rows) {
    const t = row.transport_type ?? 'unknown';
    const entry = transportBreakdown.get(t) ?? { count: 0, total_ms: 0 };
    entry.count++;
    entry.total_ms += row.duration_ms ?? 0;
    transportBreakdown.set(t, entry);

    const s = row.source ?? 'agent';
    sourceBreakdown.set(s, (sourceBreakdown.get(s) ?? 0) + 1);
  }

  const byTransport = Array.from(transportBreakdown.entries()).map(([transport, data]) => ({
    transport,
    interaction_count: data.count,
    total_duration_ms: data.total_ms,
  }));

  const bySource = Array.from(sourceBreakdown.entries()).map(([source, count]) => ({
    source,
    interaction_count: count,
  }));

  // ── Category breakdowns (free tier) ──
  // Groups receipts by classification fields so the friction lens can show
  // "kind of work" distribution. Only dimensions populated by at least one
  // receipt in the period are surfaced. Uncategorized receipts are ignored.
  // All queries run only when at least one receipt has a non-empty categories
  // object, to avoid pointless empty queries during warmup.
  let byActivityClass: Array<{ activity_class: string; interaction_count: number; total_duration_ms: number }> = [];
  let byTargetType: Array<{ target_type: string; interaction_count: number; total_duration_ms: number }> = [];
  let byInteractionPurpose: Array<{ interaction_purpose: string; interaction_count: number; total_duration_ms: number }> = [];

  try {
    const categoryRows = await query<{
      dimension: string;
      value: string;
      interaction_count: number;
      total_duration_ms: number;
    }>(
      `SELECT 'activity_class' AS "dimension",
              categories->>'activity_class' AS "value",
              COUNT(*)::int AS "interaction_count",
              COALESCE(SUM(duration_ms), 0)::int AS "total_duration_ms"
       FROM interaction_receipts
       WHERE emitter_agent_id = $1
         AND created_at >= $2
         AND created_at <= $3
         AND categories ? 'activity_class'
         AND ($4::boolean OR source IS NULL OR source != 'environmental')
       GROUP BY categories->>'activity_class'
       UNION ALL
       SELECT 'target_type' AS "dimension",
              categories->>'target_type' AS "value",
              COUNT(*)::int AS "interaction_count",
              COALESCE(SUM(duration_ms), 0)::int AS "total_duration_ms"
       FROM interaction_receipts
       WHERE emitter_agent_id = $1
         AND created_at >= $2
         AND created_at <= $3
         AND categories ? 'target_type'
         AND ($4::boolean OR source IS NULL OR source != 'environmental')
       GROUP BY categories->>'target_type'
       UNION ALL
       SELECT 'interaction_purpose' AS "dimension",
              categories->>'interaction_purpose' AS "value",
              COUNT(*)::int AS "interaction_count",
              COALESCE(SUM(duration_ms), 0)::int AS "total_duration_ms"
       FROM interaction_receipts
       WHERE emitter_agent_id = $1
         AND created_at >= $2
         AND created_at <= $3
         AND categories ? 'interaction_purpose'
         AND ($4::boolean OR source IS NULL OR source != 'environmental')
       GROUP BY categories->>'interaction_purpose'`,
      [agentId, start.toISOString(), end.toISOString(), includeEnv],
    );

    for (const row of categoryRows) {
      if (row.dimension === 'activity_class') {
        byActivityClass.push({
          activity_class: row.value,
          interaction_count: row.interaction_count,
          total_duration_ms: row.total_duration_ms,
        });
      } else if (row.dimension === 'target_type') {
        byTargetType.push({
          target_type: row.value,
          interaction_count: row.interaction_count,
          total_duration_ms: row.total_duration_ms,
        });
      } else if (row.dimension === 'interaction_purpose') {
        byInteractionPurpose.push({
          interaction_purpose: row.value,
          interaction_count: row.interaction_count,
          total_duration_ms: row.total_duration_ms,
        });
      }
    }

    byActivityClass.sort((a, b) => b.interaction_count - a.interaction_count);
    byTargetType.sort((a, b) => b.interaction_count - a.interaction_count);
    byInteractionPurpose.sort((a, b) => b.interaction_count - a.interaction_count);
  } catch (err) {
    // Category query failures are non-fatal — the rest of the friction
    // report is still useful. Log but don't surface.
    log.warn({ err }, 'Category breakdown query failed');
  }

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    summary: {
      total_interactions: rows.length,
      total_wait_time_ms: totalWaitMs,
      // Raw active-span (burst-union) so the denominator of friction_percentage
      // is visible to the user. Without this the % is uninterpretable —
      // 3% of 4h means something different from 3% of 40s.
      active_span_ms: activeMs,
      friction_percentage: Math.round(frictionPercentage * 1000) / 1000,
      total_failures: totalFailures,
      failure_rate: rows.length > 0 ? Math.round((totalFailures / rows.length) * 1000) / 1000 : 0,
      ...(totalTokensUsed > 0 ? { total_tokens_used: totalTokensUsed } : {}),
      ...(wastedTokensTotal > 0 ? { wasted_tokens: wastedTokensTotal } : {}),
    },
    by_category: categories,
    by_error_code: byErrorCode,
    top_targets: visibleTargets,
    by_transport: byTransport,
    by_source: bySource,
    by_activity_class: byActivityClass,
    by_target_type: byTargetType,
    by_interaction_purpose: byInteractionPurpose,
    population_comparison: populationComparison,
    chain_analysis: chainAnalysis,
    directional_pairs: directionalPairs,
    retry_overhead: retryOverhead,
    population_drift: populationDrift,
    tier: isPaidTier ? 'paid' : 'free',
  });
});

export { app as frictionRoute };
