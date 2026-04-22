import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@acr/shared';
import app from '../../packages/ingestion-api/src/index.js';

const VALID_PUB = 'a'.repeat(40);

describe('POST /api/v1/register', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    // Default: empty results for any uncoached call. Tests that rely on
    // specific shapes stack `mockImplementationOnce` before the request.
    vi.mocked(query).mockImplementation(async () => []);
  });

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
        public_key: VALID_PUB,
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

  it('rejects skill_hashes array longer than 64', async () => {
    // Composition-level cap from 000022 hardening — an unbounded
    // skill_hashes array would previously trigger N sequential INSERTs
    // on skill_subscriptions, pinning a serverless worker.
    const tooMany = Array.from({ length: 65 }, (_, i) => `h${i}`);
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: VALID_PUB,
        provider_class: 'anthropic',
        composition: { skill_hashes: tooMany },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 429 when IP has exceeded the churn threshold', async () => {
    // First query() is the churn SELECT COUNT — mock it above threshold.
    // Default threshold is 100 (see lib/register-churn.ts).
    vi.mocked(query).mockImplementationOnce(async () => [
      { count: 200 } as never,
    ]);
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        public_key: VALID_PUB,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('returns 200 + reregistered=true without api_key when public_key already exists', async () => {
    // Sequence of query() calls in the re-registration path:
    // 1. churn SELECT COUNT → 0 (accept)
    // 2. idempotent INSERT RETURNING → empty (row already exists)
    // 3. SELECT existing agent row → populated
    // 4. system_health SELECT for briefing → []
    // 5. skill_hashes SELECT for briefing → []
    vi.mocked(query)
      .mockImplementationOnce(async () => [{ count: 0 } as never])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [
        {
          agent_id: 'acr_existing1',
          name: 'existing-agent',
          credential_jwt: 'jwt-fake',
          current_composition_hash: 'hash-abc',
        } as never,
      ])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => []);

    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        public_key: VALID_PUB,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent_id).toBe('acr_existing1');
    expect(body.reregistered).toBe(true);
    // Critical: re-registration must NOT mint a new api_key. That would
    // let anyone who knows a public_key steal the operator's credentials.
    expect(body.api_key).toBeUndefined();
    expect(body.credential).toBe('jwt-fake');
    expect(body.composition_hash).toBe('hash-abc');
  });

  it('returns 201 + reregistered=false with api_key on fresh registration', async () => {
    // Fresh path:
    // 1. churn COUNT → 0
    // 2. idempotent INSERT RETURNING → [{ agent_id }] (non-empty = fresh)
    // 3. briefing system_health → []
    // 4. briefing skill_hashes → []
    vi.mocked(query)
      .mockImplementationOnce(async () => [{ count: 0 } as never])
      .mockImplementationOnce(async () => [{ agent_id: 'acr_fresh99' } as never])
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => []);

    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        public_key: VALID_PUB,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reregistered).toBe(false);
    expect(body.api_key).toMatch(/^acr_[0-9a-f]{48}$/);
    expect(body.credential).toBeTruthy();
  });
});
