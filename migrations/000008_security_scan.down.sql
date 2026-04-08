DELETE FROM crawl_sources WHERE source_id = 'pypi';
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS scan_score;
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS threat_patterns;
ALTER TABLE skill_catalog DROP COLUMN IF EXISTS scan_result;
