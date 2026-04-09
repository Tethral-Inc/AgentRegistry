-- Migration 000010: Interaction graph and chain signal fields.
-- Enables chain tracking, directional pair analysis, and retry/queue decomposition.

-- New receipt fields for richer friction signals
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS queue_wait_ms INT;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS error_code STRING;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS response_size_bytes INT;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS chain_id STRING;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS chain_position INT;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS preceded_by STRING;

-- Partial indexes (only index rows that have chain/retry data to minimize write overhead)
CREATE INDEX IF NOT EXISTS idx_receipts_chain ON interaction_receipts (chain_id, chain_position)
    WHERE chain_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_preceded ON interaction_receipts (preceded_by, created_at DESC)
    WHERE preceded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_retry ON interaction_receipts (retry_count, created_at DESC)
    WHERE retry_count > 0;

-- Chain analysis results (populated by background job)
CREATE TABLE IF NOT EXISTS chain_analysis (
    agent_id            STRING NOT NULL,
    analysis_window     STRING NOT NULL,
    chain_pattern       STRING[] NOT NULL,
    pattern_hash        STRING NOT NULL,
    frequency           INT NOT NULL DEFAULT 0,
    avg_chain_length    FLOAT NOT NULL DEFAULT 0,
    avg_overhead_ms     FLOAT NOT NULL DEFAULT 0,
    avg_total_ms        FLOAT NOT NULL DEFAULT 0,
    sample_count        INT NOT NULL DEFAULT 0,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, pattern_hash, analysis_window),
    INDEX idx_chain_analysis_agent (agent_id, computed_at DESC)
);

-- Directional pair analysis (populated by background job)
CREATE TABLE IF NOT EXISTS directional_pairs (
    source_target       STRING NOT NULL,
    destination_target  STRING NOT NULL,
    analysis_window     STRING NOT NULL,
    avg_duration_when_preceded FLOAT NOT NULL,
    avg_duration_standalone    FLOAT NOT NULL,
    amplification_factor       FLOAT NOT NULL DEFAULT 1.0,
    sample_count        INT NOT NULL DEFAULT 0,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_target, destination_target, analysis_window),
    INDEX idx_dir_pairs_dest (destination_target)
);
