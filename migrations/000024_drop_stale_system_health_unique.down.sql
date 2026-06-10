-- Rollback 000024: recreate the single-column unique index on system_id.
--
-- Best-effort only. This will FAIL if per-source rows already exist (multiple
-- rows per system_id), which is the expected steady state once the per-source
-- aggregator has run. Rolling back this migration therefore also requires
-- collapsing system_health back to one row per system_id first.
CREATE UNIQUE INDEX IF NOT EXISTS system_health_system_id_key
    ON system_health (system_id);
