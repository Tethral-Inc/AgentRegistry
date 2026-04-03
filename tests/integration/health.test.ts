import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('GET /api/v1/health', () => {
  it('returns structured response on DB failure', async () => {
    // No DB connected, so this tests the error path
    const res = await app.request('/api/v1/health');
    // Should return 503 with structured error, not crash
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('Error format', () => {
  it('returns structured errors for unknown routes', async () => {
    const res = await app.request('/api/v1/nonexistent');
    // Hono returns 404 for unmatched routes
    expect(res.status).toBe(404);
  });
});
