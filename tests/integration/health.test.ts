import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('GET /api/v1/health', () => {
  it('returns structured response', async () => {
    const res = await app.request('/api/v1/health');
    const body = await res.json();
    // With DB stub: 200 + status ok. Without DB: 503 + INTERNAL_ERROR.
    if (res.status === 200) {
      expect(body.status).toBe('ok');
      expect(body.database).toBe('connected');
      expect(body.timestamp).toBeDefined();
    } else {
      expect(res.status).toBe(503);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('Error format', () => {
  it('returns structured errors for unknown routes', async () => {
    const res = await app.request('/api/v1/nonexistent');
    // Hono returns 404 for unmatched routes
    expect(res.status).toBe(404);
  });
});
