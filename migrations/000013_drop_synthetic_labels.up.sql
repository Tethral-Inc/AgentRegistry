-- Migration 000013: Drop synthetic label columns.
--
-- ACR is an interaction profile registry. These columns stored synthetic
-- verdicts (threat_level, health_status, quality_score, min_threat_level)
-- derived from hidden thresholds. All consumers now use raw signal columns
-- (anomaly_signal_count, anomaly_signal_rate, failure_rate, anomaly_rate)
-- which already exist in the same tables.

-- skill_hashes: drop threat_level (was none/low/medium/high/critical)
DROP INDEX IF EXISTS idx_skills_threat;
ALTER TABLE skill_hashes DROP COLUMN IF EXISTS threat_level;

-- system_health: drop health_status (was healthy/degraded/unhealthy/flagged)
ALTER TABLE system_health DROP COLUMN IF EXISTS health_status;

-- skill_catalog: drop quality_score (was 0-100 weighted sum from hidden weights)
DROP INDEX IF EXISTS idx_catalog_quality;
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS quality_score;

-- skill_subscriptions: rename min_threat_level to min_anomaly_signals
-- and change type from STRING to INT (raw signal count threshold)
ALTER TABLE skill_subscriptions ADD COLUMN IF NOT EXISTS min_anomaly_signals INT NOT NULL DEFAULT 0;
ALTER TABLE skill_subscriptions DROP COLUMN IF EXISTS min_threat_level;
-- Also drop the 'medium' default on notify_on — require explicit value
ALTER TABLE skill_subscriptions ALTER COLUMN notify_on DROP DEFAULT;

-- threat_acknowledgements: rename threat_level to severity (it stores
-- the notification's severity, which is a raw value from the notification)
ALTER TABLE threat_acknowledgements RENAME COLUMN threat_level TO severity;
