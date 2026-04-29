-- Migration 000023: per-source system_health + p99 + row-level TTL.
--
-- Fixes the get_network_status totals/systems contradiction: the totals
-- query filtered by source, the systems block read from system_health
-- which had no source dimension, so the two blocks of the same response
-- could disagree (totals = 0, systems = 16). After this migration the
-- aggregator emits one row per (system, source) with an 'all' rollup,
-- and reads filter consistently.
--
-- Also lands two long-overdue cleanups so we only rewrite system_health
-- once: p99_duration_ms (the schema declared the column intent in
-- friction_baselines but system_health never had it), and a 30-day
-- row-level TTL so dead systems age out instead of accumulating.

ALTER TABLE system_health
    ADD COLUMN IF NOT EXISTS source STRING NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS p99_duration_ms INT;

-- Promote (system_id, source) to PK so the aggregator can UPSERT
-- per-source rows. CRDB rewrites the table on this — acceptable for
-- a small derived table that the cron repopulates every 15 min.
ALTER TABLE system_health ALTER PRIMARY KEY USING COLUMNS (system_id, source);

-- Index for the staleness MAX(last_seen_at) probe in network-status.
-- Was a full table scan on every dashboard call.
CREATE INDEX IF NOT EXISTS idx_system_health_last_seen
    ON system_health (last_seen_at DESC);

-- Row-level TTL: dead systems age out 30 days after their last refresh.
-- Aggregator UPSERTs every 15 min so live systems never get close.
ALTER TABLE system_health SET (
    ttl_expiration_expression = 'last_seen_at + INTERVAL ''30 days''',
    ttl_job_cron = '@daily'
);
