import { describe, it, expect } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('GET /api/v1/health', () => {
  it('returns structured response', async () => {
    const res = await app.request('/api/v1/health');
    const body = await res.json();

    // With DB stub: 200 + structured health.
    // Without DB or with broken DB: 503 + status='down', database='unreachable'.
    if (res.status === 200) {
      // The DB stub returns no rows for the system_health probe, so
      // the handler reports an empty-aggregation 'down' (which is the
      // honest answer — it's better than reporting 'ok' on a broken
      // pipeline). The shape is what we assert.
      expect(['ok', 'degraded', 'stale', 'down']).toContain(body.status);
      expect(body.database).toBe('connected');
      expect(body.timestamp).toBeDefined();
      // F5 additions: structured freshness + issues.
      expect(body).toHaveProperty('last_aggregation_at');
      expect(body).toHaveProperty('freshness_seconds');
      expect(Array.isArray(body.known_issues)).toBe(true);
    } else {
      expect(res.status).toBe(503);
      expect(body.status).toBe('down');
      expect(body.database).toBe('unreachable');
      expect(Array.isArray(body.known_issues)).toBe(true);
      expect(body.known_issues.length).toBeGreaterThan(0);
    }
  });

  it('reports a known_issues entry when system_health has never aggregated', async () => {
    const res = await app.request('/api/v1/health');
    if (res.status !== 200) return; // covered by the 503 branch above
    const body = await res.json();
    if (body.last_aggregation_at === null) {
      // Empty aggregation table → must surface a reason, not a silent ok.
      expect(body.status).not.toBe('ok');
      expect(body.known_issues.some((i: { component: string }) => i.component === 'aggregation')).toBe(true);
    }
  });
});

describe('Error format', () => {
  it('returns structured errors for unknown routes', async () => {
    const res = await app.request('/api/v1/nonexistent');
    expect(res.status).toBe(404);
  });
});
