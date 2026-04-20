-- Migration 000018: Anomaly-on-ingest — volume counters, quarantine, baselines.
--
-- Backs three defenses against receipt-stream abuse:
--   1. ingest_counters  — per-agent hourly receipt count for inline volume cap
--   2. agent_quarantine — active quarantines (hard volume, target spray, etc.)
--   3. agent_baselines  — learned per-agent normal behavior for async detection
--
-- Phase 0 ships in shadow mode: the ingest path writes counters and reads
-- quarantine, but log-only (no 429 yet). Enforcement flips on once baselines
-- have at least 24h of coverage per agent.

CREATE TABLE IF NOT EXISTS ingest_counters (
    agent_id          STRING NOT NULL,
    bucket_hour       TIMESTAMPTZ NOT NULL,
    receipt_count     INT NOT NULL DEFAULT 0,
    anomaly_flagged   INT NOT NULL DEFAULT 0,
    distinct_targets  INT NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, bucket_hour)
) WITH (
    ttl_expiration_expression = 'bucket_hour + INTERVAL ''14 days''',
    ttl_job_cron = '@daily'
);

CREATE TABLE IF NOT EXISTS agent_quarantine (
    agent_id     STRING PRIMARY KEY,
    reason       STRING NOT NULL,
    flagged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ,
    evidence     JSONB NOT NULL DEFAULT '{}'::JSONB,
    cleared_at   TIMESTAMPTZ,
    cleared_by   STRING,
    INDEX idx_quarantine_active (agent_id) WHERE cleared_at IS NULL
);

CREATE TABLE IF NOT EXISTS agent_baselines (
    agent_id               STRING PRIMARY KEY,
    receipts_per_hour_p50  FLOAT,
    receipts_per_hour_p95  FLOAT,
    receipts_per_hour_p99  FLOAT,
    top_targets            JSONB NOT NULL DEFAULT '[]'::JSONB,
    category_distribution  JSONB NOT NULL DEFAULT '{}'::JSONB,
    anomaly_rate_p50       FLOAT,
    anomaly_rate_p99       FLOAT,
    hours_of_data          INT NOT NULL DEFAULT 0,
    computed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
