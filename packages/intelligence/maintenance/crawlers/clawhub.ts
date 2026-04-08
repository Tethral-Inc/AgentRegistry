/**
 * ClawHub skill source adapter.
 * Extracts discovery logic from the original clawhub-crawl.ts.
 * Tries 3 methods: Public API → GitHub registry → Web scraping.
 */
import { createLogger } from '@acr/shared';
import type { CrawlSourceAdapter, DiscoveredSkill, CrawlSourceRow } from './types.js';

const log = createLogger({ name: 'crawler-clawhub' });
const RATE_LIMIT_MS = 1000;
const USER_AGENT = 'ACR-Crawler/0.3 (+https://acr.nfkey.ai)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClawHubCrawler implements CrawlSourceAdapter {
  readonly sourceId = 'clawhub';
  private baseUrl: string;

  constructor(source: CrawlSourceRow) {
    this.baseUrl = source.base_url;
  }

  async discover(): Promise<DiscoveredSkill[]> {
    // Method 1: Public API
    try {
      const res = await fetch(`${this.baseUrl}/api/skills`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const data = (await res.json()) as { skills?: Array<{ name: string; url?: string }> };
        if (data.skills && Array.isArray(data.skills)) {
          log.info({ method: 'api', count: data.skills.length }, 'Discovered skills via API');
          return data.skills.map((s) => ({
            name: s.name,
            source: this.sourceId,
            sourceUrl: s.url || `${this.baseUrl}/skills/${s.name}/SKILL.md`,
          }));
        }
      }
    } catch {
      log.info('ClawHub API not available, trying alternatives');
    }

    // Method 2: GitHub registry index
    try {
      const res = await fetch(
        'https://raw.githubusercontent.com/clawhub/registry/main/skills.json',
        { headers: { 'User-Agent': USER_AGENT } },
      );
      if (res.ok) {
        const data = (await res.json()) as Array<{ name: string; url?: string }>;
        if (Array.isArray(data)) {
          log.info({ method: 'github', count: data.length }, 'Discovered skills via GitHub');
          return data.map((s) => ({
            name: s.name,
            source: this.sourceId,
            sourceUrl: s.url || `${this.baseUrl}/skills/${s.name}/SKILL.md`,
          }));
        }
      }
    } catch {
      log.info('GitHub registry not available, trying scrape');
    }

    // Method 3: Scrape web page
    try {
      const res = await fetch(`${this.baseUrl}/skills`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) {
        const html = await res.text();
        const matches = html.matchAll(/href="\/skills\/([a-zA-Z0-9_-]+)"/g);
        const skills: DiscoveredSkill[] = [];
        for (const match of matches) {
          skills.push({
            name: match[1]!,
            source: this.sourceId,
            sourceUrl: `${this.baseUrl}/skills/${match[1]}/SKILL.md`,
          });
        }
        if (skills.length > 0) {
          log.info({ method: 'scrape', count: skills.length }, 'Discovered skills via scraping');
          return skills;
        }
      }
    } catch {
      log.warn('Web scraping failed');
    }

    log.error('No ClawHub discovery method succeeded');
    return [];
  }

  async fetchContent(url: string): Promise<string | null> {
    await sleep(RATE_LIMIT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) return res.text();
      if (res.status === 404) return null;
      log.warn({ status: res.status, url }, 'Unexpected status fetching skill');
      return null;
    } catch (err) {
      log.warn({ err, url }, 'Failed to fetch skill content');
      return null;
    }
  }
}
