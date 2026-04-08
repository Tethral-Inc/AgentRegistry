/**
 * GitHub skill source adapter.
 * Uses GitHub Search API to find repos containing SKILL.md files.
 * Fetches raw content via raw.githubusercontent.com.
 */
import { createLogger } from '@acr/shared';
import type { CrawlSourceAdapter, DiscoveredSkill, CrawlSourceRow } from './types.js';

const log = createLogger({ name: 'crawler-github' });
const USER_AGENT = 'ACR-Crawler/0.3 (+https://acr.nfkey.ai)';
const MAX_PAGES = 10;
const PER_PAGE = 30;
const RATE_LIMIT_MS = 2000; // Conservative: GitHub API has strict rate limits

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GitHubSearchItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
    default_branch: string;
  };
  html_url: string;
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubSearchItem[];
}

export class GitHubCrawler implements CrawlSourceAdapter {
  readonly sourceId = 'github';
  private baseUrl: string;
  private pat: string | null;

  constructor(source: CrawlSourceRow) {
    this.baseUrl = source.base_url;
    this.pat = (source.config as Record<string, unknown>).github_pat as string | null ?? null;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github.v3+json',
    };
    if (this.pat) {
      headers['Authorization'] = `Bearer ${this.pat}`;
    }
    return headers;
  }

  async discover(): Promise<DiscoveredSkill[]> {
    const skills: DiscoveredSkill[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      await sleep(RATE_LIMIT_MS);

      try {
        const url = `${this.baseUrl}/search/code?q=filename:SKILL.md+extension:md&per_page=${PER_PAGE}&page=${page}`;
        const res = await fetch(url, { headers: this.getHeaders() });

        // Respect rate limits
        const remaining = res.headers.get('X-RateLimit-Remaining');
        if (remaining && parseInt(remaining, 10) <= 1) {
          const resetAt = res.headers.get('X-RateLimit-Reset');
          const waitMs = resetAt
            ? Math.max(0, parseInt(resetAt, 10) * 1000 - Date.now()) + 1000
            : 60000;
          log.warn({ remaining, waitMs }, 'GitHub rate limit approaching, pausing');
          await sleep(Math.min(waitMs, 120000));
        }

        if (res.status === 403 || res.status === 429) {
          log.warn({ status: res.status }, 'GitHub rate limited, stopping discovery');
          break;
        }

        if (!res.ok) {
          log.warn({ status: res.status }, 'GitHub search failed');
          break;
        }

        const data = (await res.json()) as GitHubSearchResponse;

        if (data.items.length === 0) break;

        for (const item of data.items) {
          const repoName = item.repository.full_name;
          const branch = item.repository.default_branch;
          const key = `${repoName}/${item.path}`;

          if (seen.has(key)) continue;
          seen.add(key);

          // Derive skill name from repo name or directory
          const pathParts = item.path.split('/');
          const skillName = pathParts.length > 1
            ? pathParts[pathParts.length - 2]!  // Directory name containing SKILL.md
            : repoName.split('/')[1]!;            // Repo name

          // Use GitHub Contents API instead of raw.githubusercontent.com
          // This handles branch resolution correctly (main vs master vs custom)
          skills.push({
            name: skillName,
            source: this.sourceId,
            sourceUrl: `${this.baseUrl}/repos/${repoName}/contents/${item.path}`,
            metadata: { repo: repoName, branch, path: item.path },
          });
        }

        // Check if more pages
        if (data.items.length < PER_PAGE) break;
      } catch (err) {
        log.error({ err, page }, 'GitHub search page failed');
        break;
      }
    }

    log.info({ count: skills.length }, 'Discovered skills via GitHub');
    return skills;
  }

  async fetchContent(url: string): Promise<string | null> {
    await sleep(RATE_LIMIT_MS);
    try {
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github.v3.raw',  // Get raw content directly
      };
      if (this.pat) {
        headers['Authorization'] = `Bearer ${this.pat}`;
      }
      const res = await fetch(url, { headers });
      if (res.ok) return res.text();
      if (res.status === 404) return null;
      log.warn({ status: res.status, url }, 'Unexpected status fetching GitHub skill');
      return null;
    } catch (err) {
      log.warn({ err, url }, 'Failed to fetch GitHub skill content');
      return null;
    }
  }
}
