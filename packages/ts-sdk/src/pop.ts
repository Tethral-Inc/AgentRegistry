/**
 * Client-side proof-of-possession helpers for /register.
 *
 * Mirror of the client-facing surface of the server's
 * `shared/crypto/pop.ts`. Inlined here because this SDK is
 * zero-dependency (published to npm without workspace references).
 * The canonical specification lives in the server package — update
 * both in lockstep.
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  sign as nodeSign,
} from 'node:crypto';

import type {
  AgentKeypair,
  RegistrationRequest,
  UnsignedRegistrationRequest,
} from './types.js';

/** Signed-payload version prefix. Must match server POP_VERSION. */
const POP_VERSION = 'v1';

const POP_PUBLIC_KEY_REGEX = /^[A-Za-z0-9_-]{43}$/;

function canonicalRegistrationMessage(publicKey: string, timestampMs: number): string {
  return `register:${POP_VERSION}:${publicKey}:${timestampMs}`;
}

/**
 * Generate a fresh Ed25519 keypair. Returned as base64url strings
 * (raw 32-byte values) so callers can persist them verbatim.
 */
export function generateAgentKeypair(): AgentKeypair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' }) as { x?: string };
  const privJwk = privateKey.export({ format: 'jwk' }) as { d?: string };
  if (!pubJwk.x || !privJwk.d) {
    throw new Error('Ed25519 keypair export missing x/d fields');
  }
  return { publicKey: pubJwk.x, privateKey: privJwk.d };
}

/**
 * Take an unsigned registration body and a keypair, return a body with
 * `public_key`, `registration_timestamp_ms`, and `signature` filled in.
 *
 * The `publicKey` on the keypair overrides any value the caller put on
 * the unsigned body — the signature only validates against the public
 * key that actually signed it, so keeping the two in sync here avoids
 * a confusing 401 at call time.
 */
export function signRegistrationRequest(
  unsigned: UnsignedRegistrationRequest,
  keypair: AgentKeypair,
  nowMs: number = Date.now(),
): RegistrationRequest {
  if (!POP_PUBLIC_KEY_REGEX.test(keypair.publicKey)) {
    throw new Error('public_key must be base64url-encoded raw Ed25519 key (43 chars)');
  }
  const priv = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: keypair.privateKey, x: '' },
    format: 'jwk',
  } as Parameters<typeof createPrivateKey>[0]);
  const message = Buffer.from(
    canonicalRegistrationMessage(keypair.publicKey, nowMs),
    'utf8',
  );
  const signature = nodeSign(null, message, priv).toString('base64url');
  return {
    ...unsigned,
    public_key: keypair.publicKey,
    registration_timestamp_ms: nowMs,
    signature,
  };
}
