import { query, execute, createLogger, sha256 } from '@acr/shared';

const log = createLogger({ name: 'chain-analysis' });

interface PairRow {
  preceded_by: string;
  target_system_id: string;
  avg_preceded_ms: number;
  avg_standalone_ms: number;
  sample_count: string;
}

interface ChainPatternRow {
  agent_id: string;
  chain_id: string;
  targets: string[];
  total_duration_ms: number;
}

export async function handler() {
  try {
    // ── Step 1: Compute directional pairs ──
    // Find interactions where preceded_by is set, compare avg duration
    // when preceded vs standalone for the same target
    const pairs = await query<PairRow>(
      `WITH preceded AS (
         SELECT preceded_by, target_system_id,
                AVG(duration_ms)::int AS avg_preceded_ms,
                COUNT(*)::text AS sample_count
         FROM interaction_receipts
         WHERE created_at >= now() - INTERVAL '7 days'
           AND preceded_by IS NOT NULL
           AND duration_ms IS NOT NULL
           AND duration_ms > 0
         GROUP BY preceded_by, target_system_id
         HAVING COUNT(*) >= 5
       ),
       standalone AS (
         SELECT target_system_id,
                AVG(duration_ms)::int AS avg_standalone_ms
         FROM interaction_receipts
         WHERE created_at >= now() - INTERVAL '7 days'
           AND preceded_by IS NULL
           AND duration_ms IS NOT NULL
           AND duration_ms > 0
         GROUP BY target_system_id
         HAVING COUNT(*) >= 5
       )
       SELECT p.preceded_by AS "preceded_by",
              p.target_system_id AS "target_system_id",
              p.avg_preceded_ms AS "avg_preceded_ms",
              s.avg_standalone_ms AS "avg_standalone_ms",
              p.sample_count AS "sample_count"
       FROM preceded p
       JOIN standalone s ON p.target_system_id = s.target_system_id`,
    );

    let pairsUpserted = 0;
    for (const row of pairs) {
      const amplification = row.avg_standalone_ms > 0
        ? Math.round((row.avg_preceded_ms / row.avg_standalone_ms) * 100) / 100
        : 1;

      await execute(
        `INSERT INTO directional_pairs (
           source_target, destination_target,
           avg_duration_when_preceded, avg_duration_standalone,
           amplification_factor, sample_count, analysis_window, computed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'week', now())
         ON CONFLICT (source_target, destination_target, analysis_window) DO UPDATE SET
           avg_duration_when_preceded = $3,
           avg_duration_standalone = $4,
           amplification_factor = $5,
           sample_count = $6,
           computed_at = now()`,
        [
          row.preceded_by,
          row.target_system_id,
          row.avg_preceded_ms,
          row.avg_standalone_ms,
          amplification,
          parseInt(row.sample_count, 10),
        ],
      );
      pairsUpserted++;
    }

    log.info({ pairsUpserted }, 'Directional pairs computed');

    // ── Step 2: Compute chain patterns ──
    // Group by agent + chain_id, extract ordered target sequences
    const chains = await query<ChainPatternRow>(
      `SELECT emitter_agent_id AS "agent_id",
              chain_id AS "chain_id",
              array_agg(target_system_id ORDER BY chain_position) AS "targets",
              SUM(duration_ms)::int AS "total_duration_ms"
       FROM interaction_receipts
       WHERE created_at >= now() - INTERVAL '1 day'
         AND chain_id IS NOT NULL
         AND chain_position IS NOT NULL
       GROUP BY emitter_agent_id, chain_id
       HAVING COUNT(*) >= 2`,
    );

    // Aggregate patterns per agent: group by target sequence
    const agentPatterns = new Map<string, Map<string, { frequency: number; totalMs: number }>>();
    for (const chain of chains) {
      const key = JSON.stringify(chain.targets);
      let agentMap = agentPatterns.get(chain.agent_id);
      if (!agentMap) {
        agentMap = new Map();
        agentPatterns.set(chain.agent_id, agentMap);
      }
      const entry = agentMap.get(key) ?? { frequency: 0, totalMs: 0 };
      entry.frequency++;
      entry.totalMs += chain.total_duration_ms ?? 0;
      agentMap.set(key, entry);
    }

    let patternsUpserted = 0;
    for (const [agentId, patterns] of agentPatterns) {
      for (const [patternKey, data] of patterns) {
        const chainPattern = JSON.parse(patternKey) as string[];
        const patternHash = sha256(patternKey);
        const avgOverhead = data.frequency > 0 ? Math.round(data.totalMs / data.frequency) : 0;

        await execute(
          `INSERT INTO chain_analysis (
             agent_id, chain_pattern, pattern_hash, frequency, avg_overhead_ms,
             analysis_window, computed_at
           ) VALUES ($1, $2, $3, $4, $5, 'day', now())
           ON CONFLICT (agent_id, pattern_hash, analysis_window) DO UPDATE SET
             chain_pattern = $2,
             frequency = $4,
             avg_overhead_ms = $5,
             computed_at = now()`,
          [agentId, chainPattern, patternHash, data.frequency, avgOverhead],
        );
        patternsUpserted++;
      }
    }

    log.info({ patternsUpserted }, 'Chain patterns computed');

    // ── Step 3: Fleet-level pattern aggregation ──
    // Roll chain_analysis across all agents into chain_analysis_fleet so
    // the compensation lens can tell the operator whether a pattern is
    // idiosyncratic (one agent) or fleet-wide (substrate-level signal).
    // One UPSERT per distinct pattern seen this run.
    const fleetMap = new Map<string, {
      chain_pattern: string[];
      agentSet: Set<string>;
      total_frequency: number;
      total_overhead: number;
      overhead_samples: number;
    }>();
    for (const [agentId, patterns] of agentPatterns) {
      for (const [patternKey, data] of patterns) {
        const chainPattern = JSON.parse(patternKey) as string[];
        const patternHash = sha256(patternKey);
        const entry = fleetMap.get(patternHash) ?? {
          chain_pattern: chainPattern,
          agentSet: new Set<string>(),
          total_frequency: 0,
          total_overhead: 0,
          overhead_samples: 0,
        };
        entry.agentSet.add(agentId);
        entry.total_frequency += data.frequency;
        const avgOverhead = data.frequency > 0 ? data.totalMs / data.frequency : 0;
        entry.total_overhead += avgOverhead * data.frequency;
        entry.overhead_samples += data.frequency;
        fleetMap.set(patternHash, entry);
      }
    }

    let fleetUpserted = 0;
    for (const [patternHash, entry] of fleetMap) {
      const avgOverheadMs = entry.overhead_samples > 0
        ? Math.round(entry.total_overhead / entry.overhead_samples)
        : 0;
      await execute(
        `INSERT INTO chain_analysis_fleet (
           pattern_hash, chain_pattern, analysis_window,
           agent_count, total_frequency, avg_chain_length,
           avg_total_ms, avg_overhead_ms, computed_at
         ) VALUES ($1, $2, 'day', $3, $4, $5, $6, $6, now())
         ON CONFLICT (pattern_hash, analysis_window) DO UPDATE SET
           chain_pattern = $2,
           agent_count = $3,
           total_frequency = $4,
           avg_chain_length = $5,
           avg_overhead_ms = $6,
           avg_total_ms = $6,
           computed_at = now()`,
        [
          patternHash,
          entry.chain_pattern,
          entry.agentSet.size,
          entry.total_frequency,
          entry.chain_pattern.length,
          avgOverheadMs,
        ],
      );
      fleetUpserted++;
    }

    log.info({ fleetUpserted }, 'Fleet chain patterns computed');

    return {
      statusCode: 200,
      body: JSON.stringify({
        pairs_upserted: pairsUpserted,
        patterns_upserted: patternsUpserted,
        fleet_upserted: fleetUpserted,
      }),
    };
  } catch (err) {
    log.error({ err }, 'Chain analysis computation failed');
    const msg = err instanceof Error ? err.message : 'Unknown error'; return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
