import * as jose from 'jose';

let cachedKeyPair: { privateKey: jose.KeyLike; publicKey: jose.KeyLike } | null = null;

export async function getSigningKeyPair(): Promise<{
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  if (cachedKeyPair) return cachedKeyPair;

  const pair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
  cachedKeyPair = pair;
  return pair;
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
    .setIssuer('https://acr.tethral.ai')
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(privateKey);
}

export async function verifyCredential(
  token: string,
  publicKey: jose.KeyLike,
): Promise<jose.JWTPayload> {
  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer: 'https://acr.tethral.ai',
  });
  return payload;
}

export async function getPublicKeyJwk(publicKey: jose.KeyLike): Promise<jose.JWK> {
  return jose.exportJWK(publicKey);
}
