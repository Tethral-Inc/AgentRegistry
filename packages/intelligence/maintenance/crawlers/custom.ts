/**
 * Custom registry skill source adapter.
 * Fetches a JSON index of skills from a configurable URL.
 * Supports any registry that exposes a JSON skill listing.
 */
import { createLogger } from '@acr/shared';
import type { CrawlSourceAdapter, DiscoveredSkill, CrawlSourceRow } from './types.js';

const log = createLogger({ name: 'crawler-custom' });
const USER_AGENT = 'ACR-Crawler/0.3 (+https://acr.nfkey.ai)';
const RATE_LIMIT_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SkillIndexEntry {
  name: string;
  url?: string;
  description?: string;
}

export class CustomRegistryCrawler implements CrawlSourceAdapter {
  readonly sourceId: string;
  private baseUrl: string;
  private indexPath: string;

  constructor(source: CrawlSourceRow) {
    this.sourceId = source.source_id;
    this.baseUrl = source.base_url;
    this.indexPath = (source.config as Record<string, unknown>).index_path as string ?? '/skills.json';
  }

  async discover(): Promise<DiscoveredSkill[]> {
    try {
      const url = `${this.baseUrl}${this.indexPath}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!res.ok) {
        log.warn({ status: res.status, url }, 'Custom registry index fetch failed');
        return [];
      }

      const data = (await res.json()) as SkillIndexEntry[] | { skills: SkillIndexEntry[] };
      const entries = Array.isArray(data) ? data : data.skills ?? [];

      const skills: DiscoveredSkill[] = entries.map((entry) => ({
        name: entry.name,
        source: this.sourceId,
        sourceUrl: entry.url || `${this.baseUrl}/skills/${entry.name}/SKILL.md`,
        metadata: { description: entry.description },
      }));

      log.info({ count: skills.length, source: this.sourceId }, 'Discovered skills via custom registry');
      return skills;
    } catch (err) {
      log.error({ err, source: this.sourceId }, 'Custom registry discovery failed');
      return [];
    }
  }

  async fetchContent(url: string): Promise<string | null> {
    await sleep(RATE_LIMIT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.ok) return res.text();
      if (res.status === 404) return null;
      log.warn({ status: res.status, url }, 'Unexpected status from custom registry');
      return null;
    } catch (err) {
      log.warn({ err, url }, 'Failed to fetch from custom registry');
      return null;
    }
  }
}
