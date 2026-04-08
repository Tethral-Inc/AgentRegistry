import { Hono } from 'hono';
import { query, queryOne, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'skill-catalog' });
const app = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog/search — Full-text search across the skill catalog.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog/search', async (c) => {
  const q = c.req.query('q');
  if (!q || q.length < 1) {
    return c.json(makeError('INVALID_INPUT', 'Query parameter "q" is required'), 400);
  }

  const source = c.req.query('source');
  const category = c.req.query('category');
  const threatLevel = c.req.query('threat_level');
  const tagsParam = c.req.query('tags');
  const minScanScore = c.req.query('min_scan_score');
  const status = c.req.query('status') ?? 'active';
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)), 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10));

  const conditions: string[] = ['sc.status = $1'];
  const params: unknown[] = [status];

  if (source) {
    params.push(source);
    conditions.push(`sc.skill_source = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`sc.category = $${params.length}`);
  }
  if (threatLevel) {
    params.push(threatLevel);
    conditions.push(`sh.threat_level = $${params.length}`);
  }
  if (tagsParam) {
    const tags = tagsParam.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) {
      params.push(tags);
      conditions.push(`sc.tags && $${params.length}`);
    }
  }
  if (minScanScore) {
    params.push(parseInt(minScanScore, 10));
    conditions.push(`sc.scan_score >= $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Try full-text search first
  params.push(q);
  const tsQueryParam = params.length;
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  let rows = await query<{
    skill_id: string;
    skill_name: string;
    skill_source: string;
    source_url: string;
    current_hash: string | null;
    description: string | null;
    version: string | null;
    author: string | null;
    tags: string[];
    requires: string[];
    category: string | null;
    content_snippet: string | null;
    status: string;
    threat_level: string | null;
    agent_count: number | null;
    last_crawled_at: string | null;
    content_changed_at: string | null;
    quality_score: number | null;
    scan_score: number | null;
    threat_patterns: string[] | null;
    rank: number;
  }>(
    `SELECT sc.skill_id AS "skill_id", sc.skill_name AS "skill_name",
            sc.skill_source AS "skill_source", sc.source_url AS "source_url",
            sc.current_hash AS "current_hash", sc.description AS "description",
            sc.version AS "version", sc.author AS "author",
            sc.tags AS "tags", sc.requires AS "requires",
            sc.category AS "category", sc.content_snippet AS "content_snippet",
            sc.status AS "status",
            sh.threat_level AS "threat_level", sh.agent_count AS "agent_count",
            sc.last_crawled_at::text AS "last_crawled_at",
            sc.content_changed_at::text AS "content_changed_at",
            sc.quality_score AS "quality_score",
            sc.scan_score AS "scan_score",
            sc.threat_patterns AS "threat_patterns",
            ts_rank(sc.search_vector, plainto_tsquery('english', $${tsQueryParam})) AS "rank"
     FROM skill_catalog sc
     LEFT JOIN skill_hashes sh ON sh.skill_hash = sc.current_hash
     ${whereClause}
       AND sc.search_vector @@ plainto_tsquery('english', $${tsQueryParam})
     ORDER BY "rank" DESC, sc.updated_at DESC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  ).catch(() => []);

  // Fallback to ILIKE if full-text returns nothing
  if (rows.length === 0) {
    const likePattern = `%${q}%`;
    // Replace the tsquery param with ILIKE pattern
    params[tsQueryParam - 1] = likePattern;

    rows = await query<{
      skill_id: string; skill_name: string; skill_source: string; source_url: string;
      current_hash: string | null; description: string | null; version: string | null;
      author: string | null; tags: string[]; requires: string[]; category: string | null;
      content_snippet: string | null; status: string; threat_level: string | null;
      agent_count: number | null; last_crawled_at: string | null;
      content_changed_at: string | null; quality_score: number | null;
      scan_score: number | null; threat_patterns: string[] | null; rank: number;
    }>(
      `SELECT sc.skill_id AS "skill_id", sc.skill_name AS "skill_name",
              sc.skill_source AS "skill_source", sc.source_url AS "source_url",
              sc.current_hash AS "current_hash", sc.description AS "description",
              sc.version AS "version", sc.author AS "author",
              sc.tags AS "tags", sc.requires AS "requires",
              sc.category AS "category", sc.content_snippet AS "content_snippet",
              sc.status AS "status",
              sh.threat_level AS "threat_level", sh.agent_count AS "agent_count",
              sc.last_crawled_at::text AS "last_crawled_at",
              sc.content_changed_at::text AS "content_changed_at",
              sc.quality_score AS "quality_score",
              sc.scan_score AS "scan_score",
              sc.threat_patterns AS "threat_patterns",
              0 AS "rank"
       FROM skill_catalog sc
       LEFT JOIN skill_hashes sh ON sh.skill_hash = sc.current_hash
       ${whereClause}
         AND (sc.skill_name ILIKE $${tsQueryParam} OR sc.description ILIKE $${tsQueryParam})
       ORDER BY sc.updated_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    ).catch(() => []);
  }

  // Get total count
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM skill_catalog sc
     LEFT JOIN skill_hashes sh ON sh.skill_hash = sc.current_hash
     ${whereClause}`,
    params.slice(0, conditions.length),
  );

  c.header('Cache-Control', 'public, max-age=60');

  return c.json({
    skills: rows,
    total: parseInt(countRow?.total ?? '0', 10),
    limit,
    offset,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog — Browse/list with filters and sorting.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog', async (c) => {
  const source = c.req.query('source');
  const category = c.req.query('category');
  const status = c.req.query('status') ?? 'active';
  const sortKey = c.req.query('sort') ?? 'updated_at';
  const limitParam = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200);
  const cursor = c.req.query('cursor');

  const validSorts: Record<string, string> = {
    updated_at: 'sc.updated_at',
    skill_name: 'sc.skill_name',
    content_changed_at: 'sc.content_changed_at',
    agent_count: 'sh.agent_count',
    quality_score: 'sc.quality_score',
  };
  const sortExpr = validSorts[sortKey] ?? 'sc.updated_at';

  const conditions: string[] = ['sc.status = $1'];
  const params: unknown[] = [status];

  if (source) {
    params.push(source);
    conditions.push(`sc.skill_source = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`sc.category = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor);
    conditions.push(`sc.updated_at < $${params.length}`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  params.push(limitParam + 1);

  const rows = await query<{
    skill_id: string;
    skill_name: string;
    skill_source: string;
    source_url: string;
    current_hash: string | null;
    description: string | null;
    version: string | null;
    author: string | null;
    tags: string[];
    requires: string[];
    category: string | null;
    content_snippet: string | null;
    status: string;
    threat_level: string | null;
    agent_count: number | null;
    last_crawled_at: string | null;
    content_changed_at: string | null;
    quality_score: number | null;
    scan_score: number | null;
    threat_patterns: string[] | null;
  }>(
    `SELECT sc.skill_id AS "skill_id", sc.skill_name AS "skill_name",
            sc.skill_source AS "skill_source", sc.source_url AS "source_url",
            sc.current_hash AS "current_hash", sc.description AS "description",
            sc.version AS "version", sc.author AS "author",
            sc.tags AS "tags", sc.requires AS "requires",
            sc.category AS "category", sc.content_snippet AS "content_snippet",
            sc.status AS "status",
            sh.threat_level AS "threat_level", sh.agent_count AS "agent_count",
            sc.last_crawled_at::text AS "last_crawled_at",
            sc.content_changed_at::text AS "content_changed_at",
            sc.quality_score AS "quality_score",
            sc.scan_score AS "scan_score",
            sc.threat_patterns AS "threat_patterns"
     FROM skill_catalog sc
     LEFT JOIN skill_hashes sh ON sh.skill_hash = sc.current_hash
     ${whereClause}
     ORDER BY ${sortExpr} DESC NULLS LAST, sc.updated_at DESC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > limitParam;
  const skills = hasMore ? rows.slice(0, limitParam) : rows;
  const nextCursor = hasMore && skills.length > 0
    ? skills[skills.length - 1]!.last_crawled_at
    : null;

  c.header('Cache-Control', 'public, max-age=60');

  return c.json({ skills, next_cursor: nextCursor, limit: limitParam });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog/sources — List crawl sources with status.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog/sources', async (c) => {
  const rows = await query<{
    source_id: string;
    source_type: string;
    base_url: string;
    crawl_interval_mins: number;
    last_crawl_at: string | null;
    last_crawl_status: string;
    last_crawl_stats: Record<string, unknown>;
    enabled: boolean;
  }>(
    `SELECT source_id AS "source_id", source_type AS "source_type",
            base_url AS "base_url", crawl_interval_mins AS "crawl_interval_mins",
            last_crawl_at::text AS "last_crawl_at",
            last_crawl_status AS "last_crawl_status",
            last_crawl_stats AS "last_crawl_stats",
            enabled AS "enabled"
     FROM crawl_sources ORDER BY source_id`,
  );

  return c.json({ sources: rows });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog/changes — Recent skill changes feed.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog/changes', async (c) => {
  const since = c.req.query('since') ?? new Date(Date.now() - 86400000).toISOString();
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200);

  const rows = await query<{
    skill_id: string;
    skill_name: string;
    skill_source: string;
    version: string | null;
    current_hash: string | null;
    previous_hash: string | null;
    content_changed_at: string;
    description: string | null;
  }>(
    `SELECT skill_id AS "skill_id", skill_name AS "skill_name",
            skill_source AS "skill_source", version AS "version",
            current_hash AS "current_hash", previous_hash AS "previous_hash",
            content_changed_at::text AS "content_changed_at",
            description AS "description"
     FROM skill_catalog
     WHERE content_changed_at > $1
     ORDER BY content_changed_at DESC
     LIMIT $2`,
    [since, limit],
  );

  return c.json({
    changes: rows,
    since,
    count: rows.length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog/:skill_id — Single skill detail with version history.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog/:skill_id', async (c) => {
  const skillId = c.req.param('skill_id');

  const skill = await queryOne<{
    skill_id: string;
    skill_name: string;
    skill_source: string;
    source_url: string;
    current_hash: string | null;
    skill_content: string | null;
    description: string | null;
    version: string | null;
    author: string | null;
    tags: string[];
    requires: string[];
    category: string | null;
    content_snippet: string | null;
    status: string;
    frontmatter_raw: Record<string, unknown>;
    last_crawled_at: string | null;
    content_changed_at: string | null;
    created_at: string;
    threat_level: string | null;
    agent_count: number | null;
    quality_score: number | null;
    scan_score: number | null;
    threat_patterns: string[] | null;
    scan_result: Record<string, unknown> | null;
  }>(
    `SELECT sc.skill_id AS "skill_id", sc.skill_name AS "skill_name",
            sc.skill_source AS "skill_source", sc.source_url AS "source_url",
            sc.current_hash AS "current_hash", sc.skill_content AS "skill_content",
            sc.description AS "description", sc.version AS "version",
            sc.author AS "author", sc.tags AS "tags", sc.requires AS "requires",
            sc.category AS "category", sc.content_snippet AS "content_snippet",
            sc.status AS "status", sc.frontmatter_raw AS "frontmatter_raw",
            sc.last_crawled_at::text AS "last_crawled_at",
            sc.content_changed_at::text AS "content_changed_at",
            sc.created_at::text AS "created_at",
            sh.threat_level AS "threat_level", sh.agent_count AS "agent_count",
            sc.quality_score AS "quality_score",
            sc.scan_score AS "scan_score",
            sc.threat_patterns AS "threat_patterns",
            sc.scan_result AS "scan_result"
     FROM skill_catalog sc
     LEFT JOIN skill_hashes sh ON sh.skill_hash = sc.current_hash
     WHERE sc.skill_id = $1`,
    [skillId],
  );

  if (!skill) {
    return c.json(makeError('NOT_FOUND', `Skill ${skillId} not found`), 404);
  }

  // Get recent version history
  const versions = await query<{
    skill_hash: string;
    version: string | null;
    previous_version: string | null;
    change_type: string;
    detected_at: string;
    threat_level: string | null;
    agent_count: number | null;
  }>(
    `SELECT vh.skill_hash AS "skill_hash", vh.version AS "version",
            vh.previous_version AS "previous_version",
            vh.change_type AS "change_type",
            vh.detected_at::text AS "detected_at",
            sh.threat_level AS "threat_level",
            sh.agent_count AS "agent_count"
     FROM skill_version_history vh
     LEFT JOIN skill_hashes sh ON sh.skill_hash = vh.skill_hash
     WHERE vh.skill_id = $1
     ORDER BY vh.detected_at DESC
     LIMIT 20`,
    [skillId],
  );

  // Query for related skills (same name, different source)
  const related = await query<{
    skill_id: string; skill_name: string; skill_source: string;
    version: string | null; current_hash: string | null;
  }>(
    `SELECT skill_id AS "skill_id", skill_name AS "skill_name",
            skill_source AS "skill_source", version AS "version",
            current_hash AS "current_hash"
     FROM skill_catalog
     WHERE skill_name = $1 AND skill_id != $2 AND status = 'active'`,
    [skill.skill_name, skillId],
  );

  // CONTENT REDACTION: Only block and redact truly dangerous skills (scan_score < 50).
  // Skills with minor findings (75+) are flagged but content remains viewable.
  const scanScore = skill.scan_score ?? 100;
  const isBlocked = skill.status === 'flagged' && scanScore < 50;
  const response: Record<string, unknown> = { ...skill, versions, related_skills: related };

  if (isBlocked) {
    response.skill_content = null;
    response.content_snippet = '[REDACTED — This skill has been blocked by ACR content security scanning. Critical threat patterns detected.]';
    response.blocked = true;
    response.blocked_reason = 'Content security scan detected critical threat patterns. Skill content is not available for download, copy, or viewing.';
    response.source_url = null;
  } else if (skill.status === 'flagged') {
    // Flagged but not blocked — warn but allow viewing
    response.warned = true;
    response.warn_reason = 'Content security scan detected potential issues. Review threat_patterns before installing.';
  }

  return c.json(response);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /skill-catalog/:skill_id/versions — Complete version history.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/skill-catalog/:skill_id/versions', async (c) => {
  const skillId = c.req.param('skill_id');

  const skill = await queryOne<{ skill_name: string; skill_source: string; version: string | null }>(
    `SELECT skill_name AS "skill_name", skill_source AS "skill_source", version AS "version"
     FROM skill_catalog WHERE skill_id = $1`,
    [skillId],
  );

  if (!skill) {
    return c.json(makeError('NOT_FOUND', `Skill ${skillId} not found`), 404);
  }

  const versions = await query<{
    skill_hash: string;
    version: string | null;
    previous_version: string | null;
    change_type: string;
    detected_at: string;
    threat_level: string | null;
    agent_count: number | null;
  }>(
    `SELECT vh.skill_hash AS "skill_hash", vh.version AS "version",
            vh.previous_version AS "previous_version",
            vh.change_type AS "change_type",
            vh.detected_at::text AS "detected_at",
            sh.threat_level AS "threat_level",
            sh.agent_count AS "agent_count"
     FROM skill_version_history vh
     LEFT JOIN skill_hashes sh ON sh.skill_hash = vh.skill_hash
     WHERE vh.skill_id = $1
     ORDER BY vh.detected_at DESC`,
    [skillId],
  );

  return c.json({
    skill_id: skillId,
    skill_name: skill.skill_name,
    skill_source: skill.skill_source,
    current_version: skill.version,
    versions,
  });
});

export { app as skillCatalogRoute };
