import { describe, it, expect } from 'vitest';
import {
  getSigningKeyPair,
  issueCredential,
  verifyCredential,
  getPublicKeyJwk,
} from '@acr/shared';

describe('JWT', () => {
  it('issues and verifies a credential round-trip', async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();

    const token = await issueCredential(privateKey, {
      agent_id: 'acr_test123456',
      public_key: 'test_public_key_hex_at_least_32chars',
      provider_class: 'openclaw',
      composition_hash: 'abc123',
    });

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const payload = await verifyCredential(token, publicKey);
    expect(payload.sub).toBe('acr_test123456');
    expect(payload.agent_id).toBe('acr_test123456');
    expect(payload.provider_class).toBe('openclaw');
    expect(payload.composition_hash).toBe('abc123');
    expect(payload.iss).toBe('https://acr.tethral.ai');
  });

  it('rejects tampered tokens', async () => {
    const { privateKey, publicKey } = await getSigningKeyPair();

    const token = await issueCredential(privateKey, {
      agent_id: 'acr_test123456',
      public_key: 'test_public_key_hex_at_least_32chars',
      provider_class: 'openclaw',
      composition_hash: 'abc123',
    });

    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifyCredential(tampered, publicKey)).rejects.toThrow();
  });

  it('exports public key as JWK', async () => {
    const { publicKey } = await getSigningKeyPair();
    const jwk = await getPublicKeyJwk(publicKey);
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
  });
});
