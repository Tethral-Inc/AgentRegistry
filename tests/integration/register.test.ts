import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@acr/shared';
import { generateAgentKeypair, signRegistration, POP_TIMESTAMP_WINDOW_MS } from '../../shared/crypto/pop.js';
import app from '../../packages/ingestion-api/src/index.js';

/**
 * Build a valid, freshly-signed registration body. Each call generates
 * a new keypair + timestamp so the signature verifies on the server.
 * Returns the body verbatim so individual tests can override fields
 * (e.g. tamper with the signature) to drive negative cases.
 */
function freshSignedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const keypair = generateAgentKeypair();
  const ts = Date.now();
  const sig = signRegistration(keypair.privateKey, keypair.publicKey, ts);
  return {
    public_key: keypair.publicKey,
    registration_timestamp_ms: ts,
    signature: sig,
    provider_class: 'anthropic',
    ...overrides,
  };
}

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
      body: JSON.stringify(freshSignedBody({ provider_class: 'invalid_provider' })),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects public_key that is not a 43-char base64url Ed25519 key', async () => {
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(freshSignedBody({ public_key: 'short' })),
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
      body: JSON.stringify(freshSignedBody({ composition: { skill_hashes: tooMany } })),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('rejects a registration with a tampered signature', async () => {
    // The whole point of PoP: a caller who doesn't hold the private key
    // cannot mint a credential for someone else's public_key. Flipping
    // any bit in the signature must cause 401.
    const keypair = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(keypair.privateKey, keypair.publicKey, ts);
    // Swap the last character — still a valid base64url shape, but
    // cryptographically garbage.
    const tampered = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: keypair.publicKey,
        registration_timestamp_ms: ts,
        signature: tampered,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a registration with a stale timestamp', async () => {
    // 10 minutes in the past — well outside the 5-min freshness window.
    // Must fail with 400 BEFORE sig verification runs, so the server
    // returns a clear error about clock skew instead of a generic 401.
    const keypair = generateAgentKeypair();
    const staleTs = Date.now() - POP_TIMESTAMP_WINDOW_MS - 60_000;
    const sig = signRegistration(keypair.privateKey, keypair.publicKey, staleTs);
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: keypair.publicKey,
        registration_timestamp_ms: staleTs,
        signature: sig,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/registration_timestamp_ms/);
  });

  it('rejects a signature for a public_key the caller does not own', async () => {
    // Attacker learns someone's public_key. They sign `register:v1:<victim_pub>:<ts>`
    // with their OWN private key and submit it. Must fail — this is the
    // textbook attack PoP exists to block.
    const victim = generateAgentKeypair();
    const attacker = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(attacker.privateKey, victim.publicKey, ts);
    const res = await app.request('/api/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: victim.publicKey,
        registration_timestamp_ms: ts,
        signature: sig,
        provider_class: 'anthropic',
      }),
    });
    expect(res.status).toBe(401);
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
      body: JSON.stringify(freshSignedBody()),
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
      body: JSON.stringify(freshSignedBody()),
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
      body: JSON.stringify(freshSignedBody()),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reregistered).toBe(false);
    expect(body.api_key).toMatch(/^acr_[0-9a-f]{48}$/);
    expect(body.credential).toBeTruthy();
  });
});
