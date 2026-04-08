import { describe, it, expect } from 'vitest';
import { parseFrontmatter, extractTags, extractRequires } from '../../shared/parsers/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const content = `---
name: test-skill
version: 1.0.0
description: A test skill for unit tests
author: tester
tags: [security, monitoring]
category: testing
requires:
  env: [API_KEY]
---

# Test Skill

This is a test skill.`;

    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.name).toBe('test-skill');
    expect(result.frontmatter!.version).toBe('1.0.0');
    expect(result.frontmatter!.description).toBe('A test skill for unit tests');
    expect(result.frontmatter!.author).toBe('tester');
    expect(result.frontmatter!.tags).toEqual(['security', 'monitoring']);
    expect(result.frontmatter!.category).toBe('testing');
    expect(result.body).toContain('# Test Skill');
    expect(result.contentSnippet).toContain('Test Skill');
  });

  it('returns null frontmatter when none present', () => {
    const content = '# Just a Markdown File\n\nNo frontmatter here.';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toContain('Just a Markdown File');
  });

  it('handles malformed YAML gracefully', () => {
    const content = `---
name: [invalid yaml
this is not valid: {
---

# Content`;

    const result = parseFrontmatter(content);
    // Should not throw, returns null frontmatter
    expect(result.frontmatter).toBeNull();
    expect(result.body).toContain('Content');
  });

  it('normalizes CRLF line endings', () => {
    const content = '---\r\nname: test\r\nversion: 1.0.0\r\n---\r\n\r\n# Content';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter!.name).toBe('test');
  });

  it('strips HTML/script tags from content', () => {
    const content = `---
name: clean
---

# Title

Some text <script>alert('xss')</script> more text <b>bold</b>.`;

    const result = parseFrontmatter(content);
    expect(result.body).not.toContain('<script>');
    expect(result.body).not.toContain('<b>');
    expect(result.body).toContain('more text');
  });

  it('limits content snippet to 500 chars', () => {
    const longBody = 'A'.repeat(1000);
    const content = `---\nname: test\n---\n\n${longBody}`;
    const result = parseFrontmatter(content);

    expect(result.contentSnippet.length).toBeLessThanOrEqual(500);
  });

  it('handles comma-separated tags string', () => {
    const content = '---\nname: test\ntags: security, monitoring, compliance\n---\n\n# Content';
    const result = parseFrontmatter(content);

    expect(result.frontmatter!.tags).toEqual(['security', 'monitoring', 'compliance']);
  });

  it('handles empty content', () => {
    const result = parseFrontmatter('');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('');
  });
});

describe('extractTags', () => {
  it('extracts and lowercases tags', () => {
    const tags = extractTags({ tags: ['Security', 'MONITORING', 'compliance'] });
    expect(tags).toEqual(['security', 'monitoring', 'compliance']);
  });

  it('returns empty array when no tags', () => {
    expect(extractTags(null)).toEqual([]);
    expect(extractTags({})).toEqual([]);
  });
});

describe('extractRequires', () => {
  it('extracts from string array', () => {
    const reqs = extractRequires({ requires: ['skill-a', 'skill-b'] });
    expect(reqs).toEqual(['skill-a', 'skill-b']);
  });

  it('extracts from nested object', () => {
    const reqs = extractRequires({ requires: { env: ['API_KEY'], skills: ['dep-skill'] } });
    expect(reqs).toContain('API_KEY');
    expect(reqs).toContain('dep-skill');
  });

  it('returns empty array when no requires', () => {
    expect(extractRequires(null)).toEqual([]);
  });
});
