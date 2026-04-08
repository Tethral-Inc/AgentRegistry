-- Migration 000008: Security scan columns + PyPI source

ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS scan_result JSONB;
ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS threat_patterns STRING[] DEFAULT '{}';
ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS scan_score INT DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_catalog_scan_score ON skill_catalog (scan_score);
CREATE INDEX IF NOT EXISTS idx_catalog_threat_patterns ON skill_catalog USING GIN (threat_patterns);

-- Add PyPI as a crawl source
INSERT INTO crawl_sources (source_id, source_type, base_url, crawl_interval_mins) VALUES
    ('pypi', 'pypi_search', 'https://pypi.org', 1440)
ON CONFLICT (source_id) DO NOTHING;
