/**
 * Client-side proof-of-possession helpers for /register.
 *
 * Mirror of the client-facing surface of `shared/crypto/pop.ts`. Inlined
 * here because this package ships as a zero-dependency esbuild bundle
 * and can't import the workspace @acr/shared tree. The canonical
 * specification (signed-payload format, version prefix, timestamp
 * window) lives in `shared/crypto/pop.ts` — update both in lockstep.
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  sign as nodeSign,
} from 'node:crypto';

/** Signed-payload version prefix. Must match shared/crypto/pop.ts POP_VERSION. */
const POP_VERSION = 'v1';

/** base64url public key (43 chars). */
const POP_PUBLIC_KEY_REGEX = /^[A-Za-z0-9_-]{43}$/;

function canonicalRegistrationMessage(publicKey: string, timestampMs: number): string {
  return `register:${POP_VERSION}:${publicKey}:${timestampMs}`;
}

/**
 * Generate a fresh Ed25519 keypair. Returned as base64url strings for
 * direct persistence in the ACR state file. Private key is the raw
 * 32-byte seed; public key is the raw 32-byte point.
 */
export function generateAgentKeypair(): { publicKey: string; privateKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x?: string };
  const privJwk = privateKey.export({ format: 'jwk' }) as { d?: string };
  if (!pubJwk.x || !privJwk.d) {
    throw new Error('Ed25519 keypair export missing x/d fields');
  }
  return { publicKey: pubJwk.x, privateKey: privJwk.d };
}

/**
 * Sign a registration payload with the agent's Ed25519 private key.
 * Returns a base64url signature to ship alongside public_key and
 * registration_timestamp_ms in the /register request body.
 */
export function signRegistration(
  privateKeyBase64url: string,
  publicKeyBase64url: string,
  timestampMs: number,
): string {
  if (!POP_PUBLIC_KEY_REGEX.test(publicKeyBase64url)) {
    throw new Error('public_key must be base64url-encoded raw Ed25519 key (43 chars)');
  }
  const priv = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: privateKeyBase64url, x: '' },
    format: 'jwk',
  } as Parameters<typeof createPrivateKey>[0]);
  const message = Buffer.from(
    canonicalRegistrationMessage(publicKeyBase64url, timestampMs),
    'utf8',
  );
  const sig = nodeSign(null, message, priv);
  return sig.toString('base64url');
}
