/**
 * Crawler factory: maps source_type to the appropriate adapter.
 */
import type { CrawlSourceAdapter, CrawlSourceRow } from './types.js';
import { ClawHubCrawler } from './clawhub.js';
import { GitHubCrawler } from './github.js';
import { NpmCrawler } from './npm.js';
import { CustomRegistryCrawler } from './custom.js';

export function getCrawler(source: CrawlSourceRow): CrawlSourceAdapter {
  switch (source.source_type) {
    case 'registry':
      // ClawHub and similar registries
      if (source.source_id === 'clawhub') return new ClawHubCrawler(source);
      return new CustomRegistryCrawler(source);
    case 'github_search':
      return new GitHubCrawler(source);
    case 'npm_search':
      return new NpmCrawler(source);
    case 'custom':
      return new CustomRegistryCrawler(source);
    default:
      return new CustomRegistryCrawler(source);
  }
}

export type { CrawlSourceAdapter, CrawlSourceRow, DiscoveredSkill, CrawlResult } from './types.js';
