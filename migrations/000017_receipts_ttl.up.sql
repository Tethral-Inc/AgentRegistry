-- Migration 000017: Row-level TTL on interaction_receipts (90 days).
--
-- Replaces the never-deployed data-archival Lambda. CRDB's built-in
-- row-level TTL runs a daily job that deletes expired rows. Protects the
-- Cockroach Serverless free-tier 5 GB quota without a separate job runner.
--
-- 90 days is the longest window any current query anchors against:
-- paid-tier baselines span 7 days, health aggregates 24 hours, month-scope
-- friction reports 30 days. 90 leaves ~3x headroom for future analysis.

ALTER TABLE interaction_receipts SET (
    ttl_expiration_expression = 'created_at + INTERVAL ''90 days''',
    ttl_job_cron = '@daily'
);
