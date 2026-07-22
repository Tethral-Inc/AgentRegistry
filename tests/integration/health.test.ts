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
      expect(['ok', 'degraded', 'paused', 'stale', 'down']).toContain(body.status);
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

  it('exposes declared schedule intent alongside observed freshness', async () => {
    const res = await app.request('/api/v1/health');
    if (res.status !== 200) return;
    const body = await res.json();

    // Readers need intent AND observation to tell "off on purpose" from
    // "broken" — reporting lag alone is what produced 10 days of false-red.
    expect(body).toHaveProperty('schedule');
    expect(body.schedule).toHaveProperty('expected_interval_minutes');
    expect(body.schedule).toHaveProperty('reason');

    if (body.status === 'paused') {
      // A pause is never an incident: 200, and the reason must be stated.
      expect(res.status).toBe(200);
      expect(body.known_issues.some((i: { message: string }) => /suspended/.test(i.message))).toBe(true);
    }
  });
});

describe('Error format', () => {
  it('returns structured errors for unknown routes', async () => {
    const res = await app.request('/api/v1/nonexistent');
    expect(res.status).toBe(404);
  });
});
