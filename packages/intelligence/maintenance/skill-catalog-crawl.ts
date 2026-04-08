/**
 * Unified skill catalog crawler Lambda handler.
 * Queries crawl_sources, instantiates per-source adapters, discovers skills,
 * fetches content, detects changes, and populates skill_catalog + version history.
 */
import {
  query,
  queryOne,
  execute,
  hashSkillFile,
  parseFrontmatter,
  extractTags,
  extractRequires,
  createLogger,
} from '@acr/shared';
import type { ParsedFrontmatter } from '@acr/shared';
import { getCrawler } from './crawlers/index.js';
import type { CrawlSourceRow, CrawlResult, DiscoveredSkill } from './crawlers/types.js';

const log = createLogger({ name: 'skill-catalog-crawl' });

// Known malicious skills (shared with clawhub-crawl.ts threat intel)
const KNOWN_BAD_NAMES = [
  'solana-wallet-tracker', 'youtube-summarize-pro',
  'clawhub-oihpl', 'auto-updater-sxdg2', 'openclaw-agent',
];
const KNOWN_BAD_AUTHORS = ['hightower6eu', 'moonshine-100rze'];

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const STALE_LOCK_HOURS = 1;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isKnownBad(skillName: string): boolean {
  if (KNOWN_BAD_NAMES.includes(skillName)) return true;
  if (KNOWN_BAD_AUTHORS.some((a) => skillName.includes(a))) return true;
  return false;
}

function computeQualityScore(params: {
  frontmatter: ParsedFrontmatter | null;
  content: string;
  tags: string[];
  requires: string[];
  threatLevel: string;
}): number {
  let score = 0;
  const fm = params.frontmatter;
  if (fm?.name) score += 10;
  if (fm?.description && String(fm.description).length > 20) score += 20;
  if (fm?.version) score += 15;
  if (fm?.author) score += 10;
  if (params.tags.length > 0) score += 5;
  if (fm?.category) score += 5;
  if (params.requires.length > 0) score += 5;
  if (params.content.length > 500) score += 10;
  if (params.threatLevel === 'none') score += 10;
  return Math.min(score, 100);
}

function compareSemver(oldVer: string | null, newVer: string | null): string {
  if (!oldVer || !newVer) return 'unknown';
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [oMaj, oMin, oPat] = parse(oldVer);
  const [nMaj, nMin, nPat] = parse(newVer);
  if (nMaj !== oMaj) return 'major';
  if (nMin !== oMin) return 'minor';
  if (nPat !== oPat) return 'patch';
  return 'unknown';
}

async function fetchWithRetry(
  adapter: { fetchContent(url: string): Promise<string | null> },
  url: string,
): Promise<{ content: string | null; error?: string; httpStatus?: number }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const content = await adapter.fetchContent(url);
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        log.debug({ attempt, delay, url }, 'Retrying fetch');
        await sleep(delay);
      } else {
        return { content: null, error: msg };
      }
    }
  }
  return { content: null, error: 'Max retries exceeded' };
}

function classifyError(error: string, httpStatus?: number): string {
  if (httpStatus === 404) return 'not_found';
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus && httpStatus >= 500) return 'fetch_failed';
  if (error.includes('parse') || error.includes('YAML')) return 'parse_failed';
  return 'fetch_failed';
}

interface CatalogRow {
  skill_id: string;
  current_hash: string | null;
  version: string | null;
  skill_content: string | null;
}

async function processSkill(
  skill: DiscoveredSkill,
  adapter: { fetchContent(url: string): Promise<string | null> },
  result: CrawlResult,
): Promise<void> {
  // Fetch content
  const { content, error, httpStatus } = await fetchWithRetry(adapter, skill.sourceUrl);

  if (!content) {
    result.errors++;
    result.errorDetails.push({ name: skill.name, error: error ?? 'No content', httpStatus });

    // Log crawl error
    await execute(
      `INSERT INTO crawl_errors (skill_name, skill_source, source_url, error_type, error_detail, http_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [skill.name, skill.source, skill.sourceUrl, classifyError(error ?? '', httpStatus), error, httpStatus ?? null],
    ).catch(() => {});

    // If known skill returned 404, mark as removed
    if (httpStatus === 404) {
      await execute(
        `UPDATE skill_catalog SET status = 'removed', last_crawled_at = now(), last_crawl_error = $1, updated_at = now()
         WHERE skill_name = $2 AND skill_source = $3 AND status = 'active'`,
        [error, skill.name, skill.source],
      ).catch(() => {});
    }

    return;
  }

  result.totalCrawled++;

  // Hash and parse
  const skillHash = hashSkillFile(content);
  const { frontmatter, contentSnippet } = parseFrontmatter(content);

  const name = frontmatter?.name ?? skill.name;
  const description = frontmatter?.description ?? null;
  const version = frontmatter?.version ?? null;
  const author = frontmatter?.author ?? null;
  const tags = extractTags(frontmatter);
  const requires = extractRequires(frontmatter);
  const category = frontmatter?.category ?? null;
  const threatLevel = isKnownBad(name) ? 'critical' : 'none';
  const qualityScore = computeQualityScore({ frontmatter, content, tags, requires, threatLevel });

  // Check existing catalog entry
  const existing = await queryOne<CatalogRow>(
    `SELECT skill_id AS "skill_id", current_hash AS "current_hash",
            version AS "version", skill_content AS "skill_content"
     FROM skill_catalog WHERE skill_name = $1 AND skill_source = $2`,
    [name, skill.source],
  );

  if (!existing) {
    // ---------- NEW SKILL ----------
    result.newSkills++;

    // Insert catalog entry
    const catalogRow = await queryOne<{ skill_id: string }>(
      `INSERT INTO skill_catalog
       (skill_name, skill_source, source_url, current_hash, skill_content, content_snippet,
        description, version, author, tags, requires, category, frontmatter_raw,
        status, quality_score, last_crawled_at, content_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
       RETURNING skill_id AS "skill_id"`,
      [
        name, skill.source, skill.sourceUrl, skillHash, content, contentSnippet,
        description, version, author, tags, requires, category,
        JSON.stringify(frontmatter ?? {}),
        threatLevel === 'critical' ? 'flagged' : 'active',
        qualityScore,
      ],
    );

    if (catalogRow) {
      // Insert version history (initial version)
      await execute(
        `INSERT INTO skill_version_history (skill_id, skill_hash, version, change_type, skill_content)
         VALUES ($1, $2, $3, 'initial', $4)`,
        [catalogRow.skill_id, skillHash, version, content],
      );

      // UPSERT into skill_hashes with catalog link
      await execute(
        `INSERT INTO skill_hashes (skill_hash, skill_name, skill_source, threat_level, catalog_skill_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (skill_hash) DO UPDATE SET
           skill_name = COALESCE(EXCLUDED.skill_name, skill_hashes.skill_name),
           skill_source = COALESCE(EXCLUDED.skill_source, skill_hashes.skill_source),
           catalog_skill_id = COALESCE(EXCLUDED.catalog_skill_id, skill_hashes.catalog_skill_id),
           threat_level = CASE
             WHEN EXCLUDED.threat_level = 'critical' THEN 'critical'
             ELSE skill_hashes.threat_level
           END,
           last_updated = now()`,
        [skillHash, name, skill.source, threatLevel, catalogRow.skill_id],
      );
    }
  } else if (existing.current_hash === skillHash) {
    // ---------- UNCHANGED ----------
    result.unchangedSkills++;

    await execute(
      `UPDATE skill_catalog SET last_crawled_at = now(), last_crawl_error = NULL,
              status = CASE WHEN status = 'removed' THEN 'active' ELSE status END,
              updated_at = now()
       WHERE skill_id = $1`,
      [existing.skill_id],
    );
  } else {
    // ---------- CONTENT CHANGED ----------
    result.updatedSkills++;

    const changeType = compareSemver(existing.version, version);

    // Store old content in version history before overwriting
    await execute(
      `INSERT INTO skill_version_history (skill_id, skill_hash, version, previous_version, change_type, skill_content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [existing.skill_id, skillHash, version, existing.version, changeType, content],
    );

    // Update catalog with new content
    await execute(
      `UPDATE skill_catalog SET
        current_hash = $1, previous_hash = $2, skill_content = $3, content_snippet = $4,
        description = $5, version = $6, author = $7, tags = $8, requires = $9,
        category = $10, frontmatter_raw = $11,
        last_crawled_at = now(), last_crawl_error = NULL, content_changed_at = now(),
        status = CASE WHEN $12 = 'critical' THEN 'flagged' ELSE 'active' END,
        quality_score = $13,
        updated_at = now()
       WHERE skill_id = $14`,
      [
        skillHash, existing.current_hash, content, contentSnippet,
        description, version, author, tags, requires,
        category, JSON.stringify(frontmatter ?? {}),
        threatLevel, qualityScore, existing.skill_id,
      ],
    );

    // UPSERT new hash into skill_hashes
    await execute(
      `INSERT INTO skill_hashes (skill_hash, skill_name, skill_source, threat_level, catalog_skill_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (skill_hash) DO UPDATE SET
         skill_name = COALESCE(EXCLUDED.skill_name, skill_hashes.skill_name),
         skill_source = COALESCE(EXCLUDED.skill_source, skill_hashes.skill_source),
         catalog_skill_id = COALESCE(EXCLUDED.catalog_skill_id, skill_hashes.catalog_skill_id),
         threat_level = CASE
           WHEN EXCLUDED.threat_level = 'critical' THEN 'critical'
           ELSE skill_hashes.threat_level
         END,
         last_updated = now()`,
      [skillHash, name, skill.source, threatLevel, existing.skill_id],
    );

    log.info(
      { name, source: skill.source, oldHash: existing.current_hash?.slice(0, 12), newHash: skillHash.slice(0, 12), changeType },
      'Skill content changed',
    );

    // Slack notification for content changes
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `ACR Skill Update: *${name}* (${skill.source}) changed [${changeType}]\nOld: ${existing.version ?? 'unknown'} → New: ${version ?? 'unknown'}\nHash: ${skillHash.slice(0, 16)}...`,
        }),
      }).catch(() => {});
    }
  }
}

export async function handler() {
  const totalResult: CrawlResult = {
    totalDiscovered: 0,
    totalCrawled: 0,
    newSkills: 0,
    updatedSkills: 0,
    unchangedSkills: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    // Find sources due for crawling
    const sources = await query<CrawlSourceRow>(
      `SELECT source_id AS "source_id", source_type AS "source_type",
              base_url AS "base_url", crawl_interval_mins AS "crawl_interval_mins",
              last_crawl_at::text AS "last_crawl_at",
              last_crawl_status AS "last_crawl_status",
              config AS "config", enabled AS "enabled"
       FROM crawl_sources
       WHERE enabled = true
         AND (last_crawl_at IS NULL
              OR last_crawl_at < now() - (crawl_interval_mins || ' minutes')::INTERVAL)
         AND (last_crawl_status != 'running'
              OR last_crawl_at < now() - INTERVAL '${STALE_LOCK_HOURS} hours')`,
    );

    if (sources.length === 0) {
      log.info('No sources due for crawling');
      return { statusCode: 200, body: JSON.stringify({ message: 'No sources due', ...totalResult }) };
    }

    for (const source of sources) {
      log.info({ sourceId: source.source_id }, 'Starting crawl');

      // Acquire lock
      await execute(
        `UPDATE crawl_sources SET last_crawl_status = 'running', last_crawl_at = now() WHERE source_id = $1`,
        [source.source_id],
      );

      const sourceResult: CrawlResult = {
        totalDiscovered: 0, totalCrawled: 0, newSkills: 0,
        updatedSkills: 0, unchangedSkills: 0, errors: 0, errorDetails: [],
      };

      try {
        const crawler = getCrawler(source);
        const skills = await crawler.discover();
        sourceResult.totalDiscovered = skills.length;

        for (const skill of skills) {
          try {
            await processSkill(skill, crawler, sourceResult);
          } catch (err) {
            sourceResult.errors++;
            const msg = err instanceof Error ? err.message : 'Unknown error';
            sourceResult.errorDetails.push({ name: skill.name, error: msg });
            log.error({ err, skill: skill.name, source: source.source_id }, 'Failed to process skill');
          }
        }

        // Update source status
        await execute(
          `UPDATE crawl_sources SET last_crawl_status = 'success', last_crawl_stats = $1 WHERE source_id = $2`,
          [JSON.stringify(sourceResult), source.source_id],
        );
      } catch (err) {
        log.error({ err, sourceId: source.source_id }, 'Source crawl failed');
        await execute(
          `UPDATE crawl_sources SET last_crawl_status = 'failed',
           last_crawl_stats = $1 WHERE source_id = $2`,
          [JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown' }), source.source_id],
        ).catch(() => {});
      }

      // Accumulate totals
      totalResult.totalDiscovered += sourceResult.totalDiscovered;
      totalResult.totalCrawled += sourceResult.totalCrawled;
      totalResult.newSkills += sourceResult.newSkills;
      totalResult.updatedSkills += sourceResult.updatedSkills;
      totalResult.unchangedSkills += sourceResult.unchangedSkills;
      totalResult.errors += sourceResult.errors;
      totalResult.errorDetails.push(...sourceResult.errorDetails);
    }

    log.info(totalResult, 'Skill catalog crawl completed');

    return {
      statusCode: 200,
      body: JSON.stringify(totalResult),
    };
  } catch (err) {
    log.error({ err }, 'Skill catalog crawl failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
