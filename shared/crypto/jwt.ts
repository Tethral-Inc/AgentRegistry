import * as jose from 'jose';
import { createHash } from 'node:crypto';

const ISSUER = process.env.ACR_ISSUER ?? 'https://acr.nfkey.ai';

let cachedKeyPair: { privateKey: jose.KeyLike; publicKey: jose.KeyLike } | null = null;

/**
 * Get or create the signing key pair.
 * If TETHRAL_SIGNING_KEY_SEED is set, derives the key deterministically
 * so all serverless instances produce the same key (critical for JWT verification).
 * Falls back to random key generation for local dev.
 */
export async function getSigningKeyPair(): Promise<{
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  if (cachedKeyPair) return cachedKeyPair;

  const seed = process.env.TETHRAL_SIGNING_KEY_SEED;
  if (seed) {
    // Derive deterministic Ed25519 key from seed
    // PKCS8 DER wrapper for Ed25519: fixed 16-byte prefix + 32-byte private key
    const seedBytes = Buffer.from(seed, 'hex');
    const derived = createHash('sha512').update(seedBytes).digest().subarray(0, 32);
    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
      0x04, 0x22, 0x04, 0x20,
    ]);
    const pkcs8Der = Buffer.concat([pkcs8Prefix, derived]);
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8Der.toString('base64')}\n-----END PRIVATE KEY-----`;
    const privateKey = await jose.importPKCS8(pem, 'EdDSA') as jose.KeyLike;
    const jwk = await jose.exportJWK(privateKey);
    delete jwk.d;
    const publicKey = await jose.importJWK(jwk, 'EdDSA') as jose.KeyLike;
    cachedKeyPair = { privateKey, publicKey };
  } else {
    // Local dev / test: random key (JWTs won't survive restarts)
    cachedKeyPair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
  }

  return cachedKeyPair!;
}

export async function issueCredential(
  privateKey: jose.KeyLike,
  claims: {
    agent_id: string;
    public_key: string;
    provider_class: string;
    composition_hash: string;
  },
): Promise<string> {
  return new jose.SignJWT({
    sub: claims.agent_id,
    agent_id: claims.agent_id,
    public_key: claims.public_key,
    provider_class: claims.provider_class,
    composition_hash: claims.composition_hash,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(privateKey);
}

export async function verifyCredential(
  token: string,
  publicKey: jose.KeyLike,
): Promise<jose.JWTPayload> {
  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer: ISSUER,
  });
  return payload;
}

export async function getPublicKeyJwk(publicKey: jose.KeyLike): Promise<jose.JWK> {
  return jose.exportJWK(publicKey);
}
