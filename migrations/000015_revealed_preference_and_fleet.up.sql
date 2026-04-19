-- Migration 000015: Revealed-preference index + cross-agent chain aggregation.
--
-- Phase 0 of the metabolic observability sprint. Two additions:
--
-- 1) A partial composite index that makes the revealed-preference lens's
--    agent+target+time scan efficient when filtering to source='agent' —
--    the default for all agent-facing lenses.
--
-- 2) A fleet-level aggregation of chain_analysis so the same pattern
--    observed across multiple agents can be surfaced as a substrate-wide
--    signal (cross-agent compensation detection). Populated by the
--    chain-analysis background job with one extra UPSERT per agent-window.

-- Composite index for revealed-preference joins (call-count side)
CREATE INDEX IF NOT EXISTS idx_receipts_agent_target_time
    ON interaction_receipts (emitter_agent_id, target_system_id, created_at DESC)
    WHERE source = 'agent';

-- Cross-agent chain pattern aggregation (populated by background job)
CREATE TABLE IF NOT EXISTS chain_analysis_fleet (
    pattern_hash     STRING NOT NULL,
    chain_pattern    STRING[] NOT NULL,
    analysis_window  STRING NOT NULL,
    agent_count      INT NOT NULL DEFAULT 0,
    total_frequency  INT NOT NULL DEFAULT 0,
    avg_chain_length FLOAT NOT NULL DEFAULT 0,
    avg_total_ms     FLOAT NOT NULL DEFAULT 0,
    avg_overhead_ms  FLOAT NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (pattern_hash, analysis_window),
    INDEX idx_fleet_chain_window (analysis_window, agent_count DESC)
);
