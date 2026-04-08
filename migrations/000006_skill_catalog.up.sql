-- Migration 000006: Skill Catalog, Version History, Multi-Source Crawling
-- Introduces canonical skill identity (name+source), content storage,
-- full-text search, version tracking, and crawl infrastructure.

-- =============================================================================
-- skill_catalog: One row per canonical skill identity (name + source).
-- Persists full SKILL.md content for search and preview.
-- =============================================================================
CREATE TABLE IF NOT EXISTS skill_catalog (
    skill_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_name          STRING NOT NULL,
    skill_source        STRING NOT NULL,
    source_url          STRING NOT NULL,
    current_hash        STRING,
    previous_hash       STRING,
    -- Content storage (full SKILL.md persisted, not discarded after hashing)
    skill_content       STRING,
    content_snippet     STRING,
    -- Parsed frontmatter fields
    description         STRING,
    version             STRING,
    author              STRING,
    tags                STRING[] DEFAULT '{}',
    requires            STRING[] DEFAULT '{}',
    category            STRING,
    frontmatter_raw     JSONB DEFAULT '{}',
    -- Lifecycle: active | archived | removed | flagged
    status              STRING NOT NULL DEFAULT 'active',
    last_crawled_at     TIMESTAMPTZ,
    last_crawl_error    STRING,
    content_changed_at  TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (skill_name, skill_source),
    INDEX idx_catalog_source (skill_source),
    INDEX idx_catalog_status (status),
    INDEX idx_catalog_current_hash (current_hash),
    INDEX idx_catalog_category (category) WHERE category IS NOT NULL,
    INDEX idx_catalog_updated (updated_at DESC),
    INDEX idx_catalog_changed (content_changed_at DESC) WHERE content_changed_at IS NOT NULL
);

-- Full-text search vector (computed, stored) with GIN index.
-- Searches across name, description, author, tags, category, and content snippet.
-- Full-text search: CockroachDB does not allow array_to_string() in STORED
-- computed columns. Use scalar fields only. Tags are searchable via the
-- && (overlap) operator separately.
ALTER TABLE skill_catalog ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    AS (to_tsvector('english',
        COALESCE(skill_name, '') || ' ' ||
        COALESCE(description, '') || ' ' ||
        COALESCE(author, '') || ' ' ||
        COALESCE(category, '') || ' ' ||
        COALESCE(content_snippet, '')
    )) STORED;

CREATE INDEX IF NOT EXISTS idx_catalog_search ON skill_catalog USING GIN (search_vector);

-- Separate index for tag-based filtering
CREATE INDEX IF NOT EXISTS idx_catalog_tags ON skill_catalog USING GIN (tags);

-- =============================================================================
-- skill_version_history: Every content change for a canonical skill.
-- Preserves old content for diffing and audit.
-- =============================================================================
CREATE TABLE IF NOT EXISTS skill_version_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id            UUID NOT NULL,
    skill_hash          STRING NOT NULL,
    version             STRING,
    previous_version    STRING,
    change_type         STRING DEFAULT 'unknown',
    skill_content       STRING,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    INDEX idx_version_history_skill (skill_id, detected_at DESC),
    INDEX idx_version_history_hash (skill_hash)
);

-- =============================================================================
-- crawl_sources: Registry of skill sources to crawl continuously.
-- =============================================================================
CREATE TABLE IF NOT EXISTS crawl_sources (
    source_id           STRING PRIMARY KEY,
    source_type         STRING NOT NULL,
    base_url            STRING NOT NULL,
    crawl_interval_mins INT NOT NULL DEFAULT 1440,
    last_crawl_at       TIMESTAMPTZ,
    last_crawl_status   STRING DEFAULT 'pending',
    last_crawl_stats    JSONB DEFAULT '{}',
    enabled             BOOLEAN NOT NULL DEFAULT true,
    config              JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- crawl_errors: Per-skill error tracking for reliability monitoring.
-- =============================================================================
CREATE TABLE IF NOT EXISTS crawl_errors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_name          STRING NOT NULL,
    skill_source        STRING NOT NULL,
    source_url          STRING,
    error_type          STRING NOT NULL,
    error_detail        STRING,
    http_status         INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    INDEX idx_crawl_errors_skill (skill_name, skill_source, created_at DESC),
    INDEX idx_crawl_errors_time (created_at DESC)
);

-- =============================================================================
-- Link skill_hashes back to canonical identity in skill_catalog.
-- =============================================================================
ALTER TABLE skill_hashes ADD COLUMN IF NOT EXISTS catalog_skill_id UUID;
CREATE INDEX IF NOT EXISTS idx_skill_hashes_catalog ON skill_hashes (catalog_skill_id)
    WHERE catalog_skill_id IS NOT NULL;

-- =============================================================================
-- Seed crawl sources.
-- =============================================================================
INSERT INTO crawl_sources (source_id, source_type, base_url, crawl_interval_mins) VALUES
    ('clawhub', 'registry',       'https://clawhub.ai',          1440),
    ('github',  'github_search',  'https://api.github.com',       360),
    ('npm',     'npm_search',     'https://registry.npmjs.org',   1440)
ON CONFLICT (source_id) DO NOTHING;
