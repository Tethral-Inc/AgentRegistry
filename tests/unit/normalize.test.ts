import { describe, it, expect } from 'vitest';
import { normalizeSystemId } from '@acr/shared';

describe('normalizeSystemId', () => {
  it('normalizes known variants to canonical form', () => {
    expect(normalizeSystemId('mcp:github-server')).toBe('mcp:github');
    expect(normalizeSystemId('mcp:github-mcp')).toBe('mcp:github');
    expect(normalizeSystemId('mcp:gh')).toBe('mcp:github');
  });

  it('returns canonical names unchanged', () => {
    expect(normalizeSystemId('mcp:github')).toBe('mcp:github');
    expect(normalizeSystemId('mcp:slack')).toBe('mcp:slack');
  });

  it('lowercases input', () => {
    expect(normalizeSystemId('MCP:GitHub')).toBe('mcp:github');
    expect(normalizeSystemId('API:Stripe.com')).toBe('api:stripe.com');
  });

  it('returns unknown names lowercased but unchanged', () => {
    expect(normalizeSystemId('mcp:custom-server')).toBe('mcp:custom-server');
    expect(normalizeSystemId('api:unknown.io')).toBe('api:unknown.io');
  });

  it('normalizes all seed entries', () => {
    // Filesystem variants
    expect(normalizeSystemId('mcp:fs')).toBe('mcp:filesystem');
    expect(normalizeSystemId('mcp:file-system')).toBe('mcp:filesystem');
    expect(normalizeSystemId('mcp:filesystem-server')).toBe('mcp:filesystem');

    // Postgres variants
    expect(normalizeSystemId('mcp:postgresql')).toBe('mcp:postgres');
    expect(normalizeSystemId('mcp:pg')).toBe('mcp:postgres');

    // API variants
    expect(normalizeSystemId('api:api.openai.com')).toBe('api:openai.com');
    expect(normalizeSystemId('api:api.anthropic.com')).toBe('api:anthropic.com');

    // Platform variants
    expect(normalizeSystemId('platform:clawhub.ai')).toBe('platform:clawhub');
    expect(normalizeSystemId('platform:claw-hub')).toBe('platform:clawhub');
  });
});
