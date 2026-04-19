import { describe, it, expect } from 'vitest';
import { extractBoundTargets } from '../../packages/ingestion-api/src/lib/composition-targets.js';

describe('extractBoundTargets()', () => {
  it('returns empty set for null/undefined/non-object', () => {
    expect(extractBoundTargets(null).size).toBe(0);
    expect(extractBoundTargets(undefined).size).toBe(0);
    expect(extractBoundTargets('not-an-object').size).toBe(0);
    expect(extractBoundTargets(42).size).toBe(0);
  });

  it('returns empty set for empty composition', () => {
    expect(extractBoundTargets({}).size).toBe(0);
  });

  it('prefixes flat mcps with mcp:', () => {
    const out = extractBoundTargets({ mcps: ['github', 'filesystem'] });
    expect(out.has('mcp:github')).toBe(true);
    expect(out.has('mcp:filesystem')).toBe(true);
  });

  it('prefixes flat skills with skill:', () => {
    const out = extractBoundTargets({ skills: ['skill-a'] });
    expect(out.has('skill:skill-a')).toBe(true);
  });

  it('prefixes flat tools with mcp: (tools live inside MCPs)', () => {
    const out = extractBoundTargets({ tools: ['create-issue'] });
    expect(out.has('mcp:create-issue')).toBe(true);
  });

  it('preserves already-typed strings verbatim', () => {
    const out = extractBoundTargets({ mcps: ['mcp:github', 'api:stripe.com'] });
    expect(out.has('mcp:github')).toBe(true);
    expect(out.has('api:stripe.com')).toBe(true);
  });

  it('also includes the bare name as a fallback candidate', () => {
    const out = extractBoundTargets({ mcps: ['github'] });
    expect(out.has('mcp:github')).toBe(true);
    expect(out.has('github')).toBe(true);
  });

  it('extracts names and ids from mcp_components', () => {
    const out = extractBoundTargets({
      mcp_components: [{ id: 'mcp-github-hash', name: 'github' }],
    });
    expect(out.has('mcp:github')).toBe(true);
    expect(out.has('mcp:mcp-github-hash')).toBe(true);
  });

  it('extracts names and ids from api_components', () => {
    const out = extractBoundTargets({
      api_components: [{ id: 'stripe-api-id', name: 'stripe.com' }],
    });
    expect(out.has('api:stripe.com')).toBe(true);
    expect(out.has('api:stripe-api-id')).toBe(true);
  });

  it('extracts names and ids from skill_components', () => {
    const out = extractBoundTargets({
      skill_components: [{ id: 'skill-a-hash', name: 'skill-a' }],
    });
    expect(out.has('skill:skill-a')).toBe(true);
    expect(out.has('skill:skill-a-hash')).toBe(true);
  });

  it('treats tool_components as mcp-hosted', () => {
    const out = extractBoundTargets({
      tool_components: [{ id: 'tool-id', name: 'create-file' }],
    });
    expect(out.has('mcp:create-file')).toBe(true);
    expect(out.has('mcp:tool-id')).toBe(true);
  });

  it('merges flat and nested fields', () => {
    const out = extractBoundTargets({
      mcps: ['github'],
      mcp_components: [{ id: 'fs-hash', name: 'filesystem' }],
    });
    expect(out.has('mcp:github')).toBe(true);
    expect(out.has('mcp:filesystem')).toBe(true);
    expect(out.has('mcp:fs-hash')).toBe(true);
  });

  it('ignores empty strings and whitespace-only entries', () => {
    const out = extractBoundTargets({ mcps: ['', '  ', 'real'] });
    expect(out.has('mcp:real')).toBe(true);
    expect(out.has('mcp:')).toBe(false);
    expect(out.has('mcp:  ')).toBe(false);
  });

  it('ignores components missing both name and id', () => {
    const out = extractBoundTargets({
      mcp_components: [{ id: undefined as unknown as string }],
    });
    expect(out.size).toBe(0);
  });
});
