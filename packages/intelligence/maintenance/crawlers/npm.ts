/**
 * npm registry skill source adapter.
 * Searches npm for packages with SKILL.md files.
 * Fetches content via unpkg CDN.
 */
import { createLogger } from '@acr/shared';
import type { CrawlSourceAdapter, DiscoveredSkill, CrawlSourceRow } from './types.js';

const log = createLogger({ name: 'crawler-npm' });
const USER_AGENT = 'ACR-Crawler/0.3 (+https://acr.nfkey.ai)';
const RATE_LIMIT_MS = 1000;
const MAX_RESULTS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description?: string;
      keywords?: string[];
      links?: { repository?: string };
    };
  }>;
  total: number;
}

export class NpmCrawler implements CrawlSourceAdapter {
  readonly sourceId = 'npm';
  private baseUrl: string;

  constructor(source: CrawlSourceRow) {
    this.baseUrl = source.base_url;
  }

  async discover(): Promise<DiscoveredSkill[]> {
    const skills: DiscoveredSkill[] = [];
    const seen = new Set<string>();

    // Search for packages with skill-related keywords
    const searchTerms = ['SKILL.md', 'agent-skill', 'mcp-skill', 'openclaw-skill'];

    for (const term of searchTerms) {
      await sleep(RATE_LIMIT_MS);

      try {
        const url = `${this.baseUrl}/-/v1/search?text=${encodeURIComponent(term)}&size=${MAX_RESULTS}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
        });

        if (!res.ok) {
          log.warn({ status: res.status, term }, 'npm search failed');
          continue;
        }

        const data = (await res.json()) as NpmSearchResult;

        for (const obj of data.objects) {
          const pkg = obj.package;
          if (seen.has(pkg.name)) continue;
          seen.add(pkg.name);

          skills.push({
            name: pkg.name,
            source: this.sourceId,
            sourceUrl: `https://unpkg.com/${pkg.name}@${pkg.version}/SKILL.md`,
            metadata: {
              version: pkg.version,
              description: pkg.description,
              keywords: pkg.keywords,
            },
          });
        }
      } catch (err) {
        log.error({ err, term }, 'npm search failed');
      }
    }

    log.info({ count: skills.length }, 'Discovered potential skills via npm');
    return skills;
  }

  async fetchContent(url: string): Promise<string | null> {
    await sleep(RATE_LIMIT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const content = await res.text();
        // Validate it looks like a SKILL.md (has frontmatter or markdown headings)
        if (content.startsWith('---') || content.includes('# ')) {
          return content;
        }
        // Might be an HTML 404 page from unpkg
        log.debug({ url }, 'Content does not look like SKILL.md');
        return null;
      }
      if (res.status === 404) return null;
      log.warn({ status: res.status, url }, 'Unexpected status fetching npm skill');
      return null;
    } catch (err) {
      log.warn({ err, url }, 'Failed to fetch npm skill content');
      return null;
    }
  }
}
