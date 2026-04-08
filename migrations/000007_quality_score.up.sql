ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS quality_score INT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_catalog_quality ON skill_catalog (quality_score DESC);
