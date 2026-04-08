import { parse as parseYaml } from 'yaml';
import { createLogger } from '../logger/index.js';

const log = createLogger({ name: 'frontmatter' });

export interface ParsedFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  requires?: Record<string, unknown> | string[];
  category?: string;
  [key: string]: unknown;
}

export interface FrontmatterResult {
  frontmatter: ParsedFrontmatter | null;
  body: string;
  contentSnippet: string;
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const SNIPPET_LENGTH = 500;

// Strip HTML/script tags for safe storage
const HTML_TAG_REGEX = /<\/?[a-z][^>]*>/gi;
const SCRIPT_REGEX = /<script[\s\S]*?<\/script>/gi;

function sanitizeContent(content: string): string {
  return content
    .replace(SCRIPT_REGEX, '')
    .replace(HTML_TAG_REGEX, '');
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 *
 * SKILL.md files begin with `---` delimited YAML containing metadata
 * like name, description, version, author, tags, requires, and category.
 *
 * Returns parsed frontmatter (or null if none/malformed), the body text,
 * and a content snippet (first 500 chars of body).
 */
export function parseFrontmatter(rawContent: string): FrontmatterResult {
  const content = rawContent.replace(/\r\n/g, '\n').trim();
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    const sanitized = sanitizeContent(content);
    return {
      frontmatter: null,
      body: sanitized,
      contentSnippet: sanitized.slice(0, SNIPPET_LENGTH).trim(),
    };
  }

  const yamlStr = match[1]!;
  const body = sanitizeContent(content.slice(match[0].length));
  const contentSnippet = body.slice(0, SNIPPET_LENGTH).trim();

  try {
    const parsed = parseYaml(yamlStr) as Record<string, unknown> | null;

    if (!parsed || typeof parsed !== 'object') {
      log.warn({ yamlStr: yamlStr.slice(0, 100) }, 'Frontmatter parsed to non-object');
      return { frontmatter: null, body, contentSnippet };
    }

    const frontmatter: ParsedFrontmatter = {};

    // Extract known fields with type safety
    if (typeof parsed.name === 'string') frontmatter.name = parsed.name;
    if (typeof parsed.description === 'string') frontmatter.description = parsed.description;
    if (typeof parsed.version === 'string') frontmatter.version = String(parsed.version);
    if (typeof parsed.author === 'string') frontmatter.author = parsed.author;
    if (typeof parsed.category === 'string') frontmatter.category = parsed.category;

    // Tags: accept string[] or comma-separated string
    if (Array.isArray(parsed.tags)) {
      frontmatter.tags = parsed.tags.filter((t): t is string => typeof t === 'string');
    } else if (typeof parsed.tags === 'string') {
      frontmatter.tags = parsed.tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    // Requires: accept object or string[]
    if (Array.isArray(parsed.requires)) {
      frontmatter.requires = parsed.requires.filter((r): r is string => typeof r === 'string');
    } else if (parsed.requires && typeof parsed.requires === 'object') {
      frontmatter.requires = parsed.requires as Record<string, unknown>;
    }

    // Preserve all raw fields
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in frontmatter)) {
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body, contentSnippet };
  } catch (err) {
    log.warn({ err, yamlStr: yamlStr.slice(0, 100) }, 'Failed to parse YAML frontmatter');
    return { frontmatter: null, body, contentSnippet };
  }
}

/**
 * Extract tags from frontmatter as a flat string array.
 * Normalizes various tag formats to lowercase strings.
 */
export function extractTags(frontmatter: ParsedFrontmatter | null): string[] {
  if (!frontmatter?.tags) return [];
  if (Array.isArray(frontmatter.tags)) {
    return frontmatter.tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  }
  return [];
}

/**
 * Extract requires as a flat string array of dependency names.
 */
export function extractRequires(frontmatter: ParsedFrontmatter | null): string[] {
  if (!frontmatter?.requires) return [];
  if (Array.isArray(frontmatter.requires)) {
    return frontmatter.requires.filter((r): r is string => typeof r === 'string');
  }
  if (typeof frontmatter.requires === 'object') {
    // Handle { env: [...], skills: [...] } format
    const reqs: string[] = [];
    for (const value of Object.values(frontmatter.requires)) {
      if (Array.isArray(value)) {
        reqs.push(...value.filter((v): v is string => typeof v === 'string'));
      }
    }
    return reqs;
  }
  return [];
}
