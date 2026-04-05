import { execute, query, hashSkillFile, createLogger } from '@acr/shared';

const threatIntel = {
  known_malicious_authors: ['hightower6eu', 'moonshine-100rze'],
  known_malicious_skill_names: [
    'solana-wallet-tracker', 'youtube-summarize-pro',
    'clawhub-oihpl', 'auto-updater-sxdg2', 'openclaw-agent',
  ],
  known_c2_ips: ['91.92.242.30'],
  hashes: {} as Record<string, string>,
};

const log = createLogger({ name: 'clawhub-crawl' });

const CLAWHUB_BASE = 'https://clawhub.ai';
const RATE_LIMIT_MS = 1000; // 1 request per second

interface CrawlResult {
  totalCrawled: number;
  newHashes: number;
  knownBadMatches: number;
  errors: number;
}

interface SkillEntry {
  name: string;
  url: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to discover skills from ClawHub.
 * Tries multiple access methods in order:
 * 1. Public API endpoint
 * 2. GitHub registry manifest
 * 3. Web page scraping
 */
async function discoverSkills(): Promise<SkillEntry[]> {
  // Method 1: Try public API
  try {
    const res = await fetch(`${CLAWHUB_BASE}/api/skills`, {
      headers: { 'User-Agent': 'ACR-Crawler/0.1 (+https://acr.tethral.ai)' },
    });
    if (res.ok) {
      const data = await res.json() as { skills?: SkillEntry[] };
      if (data.skills && Array.isArray(data.skills)) {
        log.info({ method: 'api', count: data.skills.length }, 'Discovered skills via API');
        return data.skills;
      }
    }
  } catch {
    log.info('ClawHub API not available, trying alternatives');
  }

  // Method 2: Try GitHub registry index
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/clawhub/registry/main/skills.json',
      { headers: { 'User-Agent': 'ACR-Crawler/0.1 (+https://acr.tethral.ai)' } },
    );
    if (res.ok) {
      const data = await res.json() as SkillEntry[];
      if (Array.isArray(data)) {
        log.info({ method: 'github', count: data.length }, 'Discovered skills via GitHub');
        return data;
      }
    }
  } catch {
    log.info('GitHub registry not available, trying scrape');
  }

  // Method 3: Scrape the web page
  try {
    const res = await fetch(`${CLAWHUB_BASE}/skills`, {
      headers: { 'User-Agent': 'ACR-Crawler/0.1 (+https://acr.tethral.ai)' },
    });
    if (res.ok) {
      const html = await res.text();
      // Extract skill links from HTML - pattern: /skills/{name}
      const matches = html.matchAll(/href="\/skills\/([a-zA-Z0-9_-]+)"/g);
      const skills: SkillEntry[] = [];
      for (const match of matches) {
        skills.push({
          name: match[1]!,
          url: `${CLAWHUB_BASE}/skills/${match[1]}/SKILL.md`,
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

  log.error('No skill discovery method succeeded');
  return [];
}

async function fetchSkillContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ACR-Crawler/0.1 (+https://acr.tethral.ai)' },
    });
    if (res.ok) {
      return res.text();
    }
    return null;
  } catch {
    return null;
  }
}

function isKnownBad(skillName: string): string | null {
  if (threatIntel.known_malicious_skill_names.includes(skillName)) {
    return 'clawhavoc-seed';
  }
  if (threatIntel.known_malicious_authors.some((a) => skillName.includes(a))) {
    return 'clawhavoc-author';
  }
  return null;
}

export async function handler() {
  const result: CrawlResult = {
    totalCrawled: 0,
    newHashes: 0,
    knownBadMatches: 0,
    errors: 0,
  };

  try {
    const skills = await discoverSkills();

    if (skills.length === 0) {
      log.warn('No skills discovered, nothing to crawl');
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    for (const skill of skills) {
      await sleep(RATE_LIMIT_MS);

      const skillUrl = skill.url || `${CLAWHUB_BASE}/skills/${skill.name}/SKILL.md`;
      const content = await fetchSkillContent(skillUrl);

      if (!content) {
        result.errors++;
        continue;
      }

      result.totalCrawled++;
      const skillHash = hashSkillFile(content);
      const knownBadSource = isKnownBad(skill.name);

      if (knownBadSource) {
        result.knownBadMatches++;
      }

      // Check if hash already exists
      const existing = await query<{ skill_hash: string }>(
        `SELECT skill_hash AS "skill_hash" FROM skill_hashes WHERE skill_hash = $1`,
        [skillHash],
      );

      if (existing.length === 0) {
        result.newHashes++;
      }

      // UPSERT
      await execute(
        `INSERT INTO skill_hashes (skill_hash, skill_name, skill_source, threat_level, known_bad_source)
         VALUES ($1, $2, 'clawhub', $3, $4)
         ON CONFLICT (skill_hash) DO UPDATE SET
           skill_name = COALESCE(EXCLUDED.skill_name, skill_hashes.skill_name),
           skill_source = COALESCE(EXCLUDED.skill_source, skill_hashes.skill_source),
           threat_level = CASE
             WHEN EXCLUDED.threat_level = 'critical' THEN 'critical'
             ELSE skill_hashes.threat_level
           END,
           known_bad_source = COALESCE(EXCLUDED.known_bad_source, skill_hashes.known_bad_source),
           last_updated = now()`,
        [
          skillHash,
          skill.name,
          knownBadSource ? 'critical' : 'none',
          knownBadSource,
        ],
      );
    }

    log.info(result, 'ClawHub crawl completed');

    // Store crawl snapshot metadata
    const snapshot = {
      timestamp: new Date().toISOString(),
      ...result,
      discoveryMethod: skills.length > 0 ? 'success' : 'none',
    };

    log.info({ snapshot }, 'Crawl snapshot');

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (err) {
    log.error({ err }, 'ClawHub crawl failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
