-- Rollback: restore synthetic label columns

ALTER TABLE skill_hashes ADD COLUMN IF NOT EXISTS threat_level STRING NOT NULL DEFAULT 'none';
CREATE INDEX IF NOT EXISTS idx_skills_threat ON skill_hashes (threat_level) WHERE threat_level != 'none';

ALTER TABLE system_health ADD COLUMN IF NOT EXISTS health_status STRING NOT NULL DEFAULT 'unknown';

ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS quality_score INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_catalog_quality ON skill_catalog (quality_score DESC);

ALTER TABLE skill_subscriptions ADD COLUMN IF NOT EXISTS min_threat_level STRING NOT NULL DEFAULT 'medium';
ALTER TABLE skill_subscriptions DROP COLUMN IF EXISTS min_anomaly_signals;
ALTER TABLE skill_subscriptions ALTER COLUMN notify_on SET DEFAULT 'threat';

ALTER TABLE threat_acknowledgements RENAME COLUMN severity TO threat_level;
