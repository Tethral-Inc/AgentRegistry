import { createLogger } from '@acr/shared';
import type { CrawlSourceAdapter, DiscoveredSkill, CrawlSourceRow } from './types.js';

const log = createLogger({ name: 'crawler-pypi' });
const USER_AGENT = 'ACR-Crawler/0.3 (+https://acr.nfkey.ai)';
const RATE_LIMIT_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PyPICrawler implements CrawlSourceAdapter {
  readonly sourceId = 'pypi';
  private baseUrl: string;

  constructor(source: CrawlSourceRow) {
    this.baseUrl = source.base_url;
  }

  async discover(): Promise<DiscoveredSkill[]> {
    const skills: DiscoveredSkill[] = [];
    const seen = new Set<string>();
    const searchTerms = ['openclaw-skill', 'agent-skill', 'mcp-skill', 'claude-skill', 'tethral'];

    for (const term of searchTerms) {
      await sleep(RATE_LIMIT_MS);
      try {
        // PyPI Simple JSON API search
        const url = `${this.baseUrl}/search/?q=${encodeURIComponent(term)}&o=`;
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });

        if (!res.ok) {
          // PyPI search returns HTML, try the JSON API for known package names instead
          // Fallback: check if package exists directly
          const pkgRes = await fetch(`${this.baseUrl}/pypi/${term}/json`, { headers: { 'User-Agent': USER_AGENT } });
          if (pkgRes.ok) {
            const data = await pkgRes.json() as { info: { name: string; version: string; project_urls?: Record<string, string> } };
            if (!seen.has(data.info.name)) {
              seen.add(data.info.name);
              const githubUrl = this.extractGitHubUrl(data.info.project_urls);
              if (githubUrl) {
                skills.push({
                  name: data.info.name,
                  source: this.sourceId,
                  sourceUrl: `${githubUrl}/raw/main/SKILL.md`,
                  metadata: { version: data.info.version },
                });
              }
            }
          }
          continue;
        }
      } catch (err) {
        log.debug({ err, term }, 'PyPI search failed for term');
      }
    }

    // Also try known package name patterns directly
    const directPackages = [
      'tethral-acr', 'openclaw', 'openclaw-skill', 'agent-skill-sdk',
      'mcp-skill-sdk', 'claude-skill', 'skill-scanner',
    ];

    for (const pkg of directPackages) {
      if (seen.has(pkg)) continue;
      await sleep(RATE_LIMIT_MS);
      try {
        const res = await fetch(`${this.baseUrl}/pypi/${pkg}/json`, { headers: { 'User-Agent': USER_AGENT } });
        if (res.ok) {
          const data = await res.json() as { info: { name: string; version: string; project_urls?: Record<string, string> } };
          seen.add(data.info.name);
          const githubUrl = this.extractGitHubUrl(data.info.project_urls);
          if (githubUrl) {
            skills.push({
              name: data.info.name,
              source: this.sourceId,
              sourceUrl: `${githubUrl}/raw/main/SKILL.md`,
              metadata: { version: data.info.version },
            });
          }
        }
      } catch { /* package doesn't exist */ }
    }

    log.info({ count: skills.length }, 'Discovered potential skills via PyPI');
    return skills;
  }

  private extractGitHubUrl(projectUrls?: Record<string, string>): string | null {
    if (!projectUrls) return null;
    for (const [key, url] of Object.entries(projectUrls)) {
      if (url.includes('github.com')) {
        // Normalize: remove trailing .git, ensure no trailing slash
        return url.replace(/\.git$/, '').replace(/\/$/, '');
      }
    }
    return null;
  }

  async fetchContent(url: string): Promise<string | null> {
    await sleep(RATE_LIMIT_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) {
        const content = await res.text();
        if (content.startsWith('---') || content.includes('# ')) {
          return content;
        }
        return null;
      }
      // Try alternate branch
      if (res.status === 404) {
        const altUrl = url.replace('/raw/main/', '/raw/master/');
        const altRes = await fetch(altUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (altRes.ok) return altRes.text();
      }
      return null;
    } catch {
      return null;
    }
  }
}
