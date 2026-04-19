import { Hono } from 'hono';
import { CompensationWindow, query, makeError, createLogger } from '@acr/shared';
import { resolveAgentId } from '../helpers/resolve-agent.js';
import { scorePatterns } from '../lib/stability-score.js';

const log = createLogger({ name: 'compensation' });
const app = new Hono();

app.get('/agent/:agent_id/compensation', async (c) => {
  const identifier = c.req.param('agent_id');
  const windowParam = c.req.query('window') ?? 'week';

  const parsed = CompensationWindow.safeParse(windowParam);
  if (!parsed.success) {
    return c.json(makeError('INVALID_INPUT', 'window must be day or week'), 400);
  }
  const window = parsed.data;

  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  // Pull the agent's precomputed chain patterns for the window.
  // chain_analysis is populated by the background job in
  // packages/intelligence/anomaly/chain-analysis.ts.
  const patternRows = await query<{
    pattern_hash: string;
    chain_pattern: string[];
    frequency: number;
    avg_overhead_ms: number;
    computed_at: string;
  }>(
    `SELECT pattern_hash AS "pattern_hash",
            chain_pattern AS "chain_pattern",
            frequency::int AS "frequency",
            COALESCE(avg_overhead_ms, 0)::float AS "avg_overhead_ms",
            computed_at::text AS "computed_at"
     FROM chain_analysis
     WHERE agent_id = $1
       AND analysis_window = $2
     ORDER BY frequency DESC`,
    [agentId, window],
  ).catch((err) => { log.debug({ err }, 'Failed to fetch chain_analysis'); return []; });

  const { scored, total_chains, agent_stability } = scorePatterns(
    patternRows.map((r) => ({
      pattern_hash: r.pattern_hash,
      chain_pattern: r.chain_pattern,
      frequency: r.frequency,
    })),
  );

  // Merge fleet data: for each pattern, how common is it across the fleet?
  // Tells the operator whether this pattern is idiosyncratic (one agent) or
  // widespread (substrate-wide compensation).
  const patternHashes = scored.map((s) => s.pattern_hash);
  const fleetRows = patternHashes.length > 0
    ? await query<{ pattern_hash: string; agent_count: number; total_frequency: number }>(
        `SELECT pattern_hash AS "pattern_hash",
                agent_count::int AS "agent_count",
                total_frequency::int AS "total_frequency"
         FROM chain_analysis_fleet
         WHERE pattern_hash = ANY($1) AND analysis_window = $2`,
        [patternHashes, window],
      ).catch((err) => { log.debug({ err }, 'Failed to fetch chain_analysis_fleet'); return []; })
    : [];

  const fleetMap = new Map(fleetRows.map((f) => [f.pattern_hash, f]));

  // Build output list. Keep the overhead alongside the pattern so a user
  // can see "this pattern is low-stability AND expensive" without having
  // to cross-reference the friction report.
  const overheadByHash = new Map(patternRows.map((r) => [r.pattern_hash, r.avg_overhead_ms] as const));

  const patterns = scored.map((s) => {
    const fleet = fleetMap.get(s.pattern_hash);
    return {
      pattern_hash: s.pattern_hash,
      chain_pattern: s.chain_pattern,
      frequency: s.frequency,
      pattern_stability: s.pattern_stability,
      share_of_chains: s.share_of_chains,
      avg_overhead_ms: overheadByHash.get(s.pattern_hash) ?? 0,
      fleet_agent_count: fleet?.agent_count ?? null,
      fleet_total_frequency: fleet?.total_frequency ?? null,
    };
  });

  const computedAt = patternRows.length > 0 ? patternRows[0]!.computed_at : null;

  return c.json({
    agent_id: agentId,
    name: agentName,
    window,
    computed_at: computedAt,
    summary: {
      total_chains,
      distinct_patterns: patterns.length,
      agent_stability,
    },
    patterns,
  });
});

export { app as compensationRoute };
