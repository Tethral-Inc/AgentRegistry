import { describe, it, expect, beforeAll } from 'vitest';
import app from '../../packages/ingestion-api/src/index.js';

describe('POST /api/v1/register', () => {
  it('rejects missing public_key', async () => {
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_class: 'openclaw' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid provider_class', async () => {
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: 'a'.repeat(32),
        provider_class: 'invalid_provider',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects short public_key', async () => {
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: 'short',
        provider_class: 'openclaw',
      }),
    });

    expect(res.status).toBe(400);
  });
});
