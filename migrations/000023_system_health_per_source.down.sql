-- Revert migration 000023.
ALTER TABLE system_health RESET (ttl_expiration_expression, ttl_job_cron);
DROP INDEX IF EXISTS idx_system_health_last_seen;
ALTER TABLE system_health ALTER PRIMARY KEY USING COLUMNS (system_id);
ALTER TABLE system_health DROP COLUMN IF EXISTS source;
ALTER TABLE system_health DROP COLUMN IF EXISTS p99_duration_ms;
