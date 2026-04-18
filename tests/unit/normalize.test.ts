import { describe, it, expect } from 'vitest';
import { normalizeSystemId } from '@acr/shared';

describe('normalizeSystemId', () => {
  describe('seed-map aliases', () => {
    it('normalizes known MCP variants to canonical form', () => {
      expect(normalizeSystemId('mcp:github-server')).toBe('mcp:github');
      expect(normalizeSystemId('mcp:github-mcp')).toBe('mcp:github');
      expect(normalizeSystemId('mcp:gh')).toBe('mcp:github');
    });

    it('returns canonical names unchanged', () => {
      expect(normalizeSystemId('mcp:github')).toBe('mcp:github');
      expect(normalizeSystemId('mcp:slack')).toBe('mcp:slack');
    });

    it('normalizes filesystem variants', () => {
      expect(normalizeSystemId('mcp:fs')).toBe('mcp:filesystem');
      expect(normalizeSystemId('mcp:file-system')).toBe('mcp:filesystem');
      expect(normalizeSystemId('mcp:filesystem-server')).toBe('mcp:filesystem');
    });

    it('normalizes postgres variants', () => {
      expect(normalizeSystemId('mcp:postgresql')).toBe('mcp:postgres');
      expect(normalizeSystemId('mcp:pg')).toBe('mcp:postgres');
    });

    it('normalizes newer MCPs', () => {
      expect(normalizeSystemId('mcp:notion-mcp')).toBe('mcp:notion');
      expect(normalizeSystemId('mcp:linear-server')).toBe('mcp:linear');
      expect(normalizeSystemId('mcp:google-drive')).toBe('mcp:gdrive');
      expect(normalizeSystemId('mcp:playwright-mcp')).toBe('mcp:playwright');
    });

    it('normalizes platform variants', () => {
      expect(normalizeSystemId('platform:clawhub.ai')).toBe('platform:clawhub');
      expect(normalizeSystemId('platform:claw-hub')).toBe('platform:clawhub');
    });
  });

  describe('case normalization', () => {
    it('lowercases input', () => {
      expect(normalizeSystemId('MCP:GitHub')).toBe('mcp:github');
      expect(normalizeSystemId('API:Stripe.com')).toBe('api:stripe.com');
    });
  });

  describe('structural normalization (api)', () => {
    it('strips leading api. subdomain', () => {
      expect(normalizeSystemId('api:api.openai.com')).toBe('api:openai.com');
      expect(normalizeSystemId('api:api.anthropic.com')).toBe('api:anthropic.com');
      expect(normalizeSystemId('api:api.github.com')).toBe('api:github.com');
    });

    it('strips leading www. subdomain', () => {
      expect(normalizeSystemId('api:www.googleapis.com')).toBe('api:googleapis.com');
    });

    it('strips protocol prefix', () => {
      expect(normalizeSystemId('api:https://api.openai.com')).toBe('api:openai.com');
      expect(normalizeSystemId('api:http://example.com')).toBe('api:example.com');
    });

    it('strips path components', () => {
      expect(normalizeSystemId('api:api.openai.com/v1/chat/completions')).toBe('api:openai.com');
      expect(normalizeSystemId('api:example.com/')).toBe('api:example.com');
    });

    it('strips query and fragment', () => {
      expect(normalizeSystemId('api:example.com?key=value')).toBe('api:example.com');
      expect(normalizeSystemId('api:example.com#section')).toBe('api:example.com');
    });

    it('strips port', () => {
      expect(normalizeSystemId('api:example.com:8080')).toBe('api:example.com');
      expect(normalizeSystemId('api:localhost:3000')).toBe('api:localhost');
    });

    it('handles messy real-world input', () => {
      expect(normalizeSystemId('API:https://api.OpenAI.com/v1/chat/completions?stream=true'))
        .toBe('api:openai.com');
    });
  });

  describe('structural normalization (mcp)', () => {
    it('does NOT strip api./www. for mcp type', () => {
      // mcp:api.something is unusual but we shouldn't silently rewrite it
      expect(normalizeSystemId('mcp:api.custom')).toBe('mcp:api.custom');
    });

    it('strips paths for mcp type', () => {
      expect(normalizeSystemId('mcp:github/repos')).toBe('mcp:github');
      expect(normalizeSystemId('mcp:custom-server/tool')).toBe('mcp:custom-server');
    });
  });

  describe('unknown targets', () => {
    it('returns unknown names lowercased but unchanged', () => {
      expect(normalizeSystemId('mcp:custom-server')).toBe('mcp:custom-server');
      expect(normalizeSystemId('api:unknown.io')).toBe('api:unknown.io');
    });

    it('passes through IDs without a type prefix', () => {
      expect(normalizeSystemId('just-a-name')).toBe('just-a-name');
    });

    it('does not structurally modify unknown type prefixes', () => {
      expect(normalizeSystemId('weird:api.example.com/path')).toBe('weird:api.example.com/path');
    });
  });

  describe('idempotence', () => {
    it('is a fixpoint on canonical output', () => {
      const inputs = [
        'api:api.openai.com/v1/chat',
        'MCP:GitHub-Server',
        'API:https://api.anthropic.com',
        'platform:clawhub.ai',
        'mcp:pg',
      ];
      for (const input of inputs) {
        const once = normalizeSystemId(input);
        const twice = normalizeSystemId(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe('empty and edge cases', () => {
    it('handles empty string', () => {
      expect(normalizeSystemId('')).toBe('');
    });

    it('handles whitespace', () => {
      expect(normalizeSystemId('  api:openai.com  ')).toBe('api:openai.com');
    });
  });
});
