import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('Skill Catalog API', () => {
  describe('GET /api/v1/skill-catalog/search', () => {
    it('requires a query parameter', async () => {
      const res = await app.request('/api/v1/skill-catalog/search');
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('INVALID_INPUT');
    });

    it('returns empty results for unknown query', async () => {
      const res = await app.request('/api/v1/skill-catalog/search?q=nonexistent-skill-xyz123');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.skills).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('accepts valid search parameters', async () => {
      const res = await app.request('/api/v1/skill-catalog/search?q=test&source=clawhub&limit=5');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('skills');
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('limit');
      expect(data.limit).toBe(5);
    });
  });

  describe('GET /api/v1/skill-catalog', () => {
    it('returns paginated list', async () => {
      const res = await app.request('/api/v1/skill-catalog?limit=10');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('skills');
      expect(data).toHaveProperty('next_cursor');
    });
  });

  describe('GET /api/v1/skill-catalog/sources', () => {
    it('returns crawl sources', async () => {
      const res = await app.request('/api/v1/skill-catalog/sources');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('sources');
      expect(Array.isArray(data.sources)).toBe(true);
    });
  });

  describe('GET /api/v1/skill-catalog/changes', () => {
    it('returns changes feed', async () => {
      const res = await app.request('/api/v1/skill-catalog/changes');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('changes');
      expect(data).toHaveProperty('count');
    });
  });

  describe('GET /api/v1/skill-catalog/:skill_id', () => {
    it('returns 404 for unknown skill', async () => {
      const res = await app.request('/api/v1/skill-catalog/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/skill-catalog/:skill_id/versions', () => {
    it('returns 404 for unknown skill', async () => {
      const res = await app.request('/api/v1/skill-catalog/00000000-0000-0000-0000-000000000000/versions');
      expect(res.status).toBe(404);
    });
  });
});
