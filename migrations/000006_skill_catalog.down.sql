-- Rollback migration 000006: Skill Catalog

-- Drop the catalog link from skill_hashes
ALTER TABLE skill_hashes DROP COLUMN IF EXISTS catalog_skill_id;

-- Drop tables in dependency order
DROP TABLE IF EXISTS crawl_errors;
DROP TABLE IF EXISTS crawl_sources;
DROP TABLE IF EXISTS skill_version_history;
DROP TABLE IF EXISTS skill_catalog;
