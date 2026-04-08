/**
 * Shared types for multi-source skill crawlers.
 */

export interface DiscoveredSkill {
  /** Skill name (from filename, frontmatter, or registry) */
  name: string;
  /** Source identifier matching crawl_sources.source_id */
  source: string;
  /** URL to fetch the raw SKILL.md content */
  sourceUrl: string;
  /** Source-specific metadata (repo, author, package info, etc.) */
  metadata?: Record<string, unknown>;
}

export interface CrawlSourceAdapter {
  /** Source ID matching crawl_sources.source_id */
  sourceId: string;
  /** Discover available skills from this source */
  discover(): Promise<DiscoveredSkill[]>;
  /** Fetch raw SKILL.md content from a URL */
  fetchContent(url: string): Promise<string | null>;
}

export interface CrawlResult {
  totalDiscovered: number;
  totalCrawled: number;
  newSkills: number;
  updatedSkills: number;
  unchangedSkills: number;
  errors: number;
  errorDetails: Array<{ name: string; error: string; httpStatus?: number }>;
}

export interface CrawlSourceRow {
  source_id: string;
  source_type: string;
  base_url: string;
  crawl_interval_mins: number;
  last_crawl_at: string | null;
  last_crawl_status: string;
  config: Record<string, unknown>;
  enabled: boolean;
}
