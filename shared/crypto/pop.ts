/**
 * Proof-of-possession (PoP) for /register.
 *
 * The /register endpoint is intentionally public — no API key is required —
 * so anonymous callers can onboard. Before this module existed, anyone who
 * knew a public_key could call /register and receive a freshly minted
 * credential + api_key bound to that public_key. That trivially hijacks
 * any agent whose public_key has ever been exposed.
 *
 * This module is the fix: every /register request MUST include a
 * cryptographic signature proving the caller holds the Ed25519 private
 * key corresponding to the submitted public_key. The server rejects
 * unsigned requests, invalid signatures, and stale timestamps before any
 * row is written.
 *
 * Wire format:
 *   - public_key:  base64url-encoded raw 32-byte Ed25519 public key (43 chars)
 *   - signature:   base64url-encoded raw 64-byte Ed25519 signature  (86 chars)
 *   - timestamp:   registration_timestamp_ms (client unix-ms)
 *
 * Signed payload: `register:v1:${public_key}:${timestamp_ms}`
 *   - The `register:v1:` prefix domain-separates this from any other
 *     signature scheme so a sig leaked from another protocol can't be
 *     replayed here (or vice versa).
 *   - Version prefix leaves room for format evolution.
 *
 * Replay note: the agents table has UNIQUE(public_key). A second request
 * with identical (public_key, sig, timestamp) is a no-op at the storage
 * layer — no new api_key is minted. The ±5 min window below is enough
 * to neutralize replay without a nonce table.
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

/** Window (ms) during which a registration_timestamp_ms is accepted. */
export const POP_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

/** Signed-payload version prefix. Bump if the canonicalization changes. */
export const POP_VERSION = 'v1';

/** Length (chars) of base64url-encoded raw Ed25519 public key. */
export const POP_PUBLIC_KEY_LENGTH = 43;

/** Length (chars) of base64url-encoded raw Ed25519 signature. */
export const POP_SIGNATURE_LENGTH = 86;

/** Regex for base64url public key — unpadded, URL-safe base64, exactly 43 chars. */
export const POP_PUBLIC_KEY_REGEX = /^[A-Za-z0-9_-]{43}$/;

/** Regex for base64url signature — unpadded, URL-safe base64, exactly 86 chars. */
export const POP_SIGNATURE_REGEX = /^[A-Za-z0-9_-]{86}$/;

/**
 * Canonical string the client signs and the server re-derives.
 * Keep this single-source-of-truth — divergence on either side silently
 * locks everyone out.
 */
export function canonicalRegistrationMessage(
  publicKey: string,
  timestampMs: number,
): string {
  return `register:${POP_VERSION}:${publicKey}:${timestampMs}`;
}

/**
 * Generate a fresh Ed25519 keypair for an agent.
 * Returns both keys as base64url strings. Private key is the raw 32-byte
 * seed; public key is the raw 32-byte point. Both are the "wire" form —
 * callers persist these verbatim.
 */
export function generateAgentKeypair(): {
  publicKey: string;
  privateKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  // jose/node export Ed25519 jwk with `x` (pub) and `d` (priv) as base64url.
  if (!pubJwk.x || !privJwk.d) {
    throw new Error('Ed25519 keypair export missing x/d fields');
  }
  return { publicKey: pubJwk.x, privateKey: privJwk.d };
}

/** Convert a base64url raw-32-byte Ed25519 private key (seed) to a Node KeyObject. */
function importPrivateKey(base64urlPriv: string) {
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: base64urlPriv, x: '' },
    format: 'jwk',
  } as Parameters<typeof createPrivateKey>[0]);
}

/** Convert a base64url raw-32-byte Ed25519 public key to a Node KeyObject. */
function importPublicKey(base64urlPub: string) {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: base64urlPub },
    format: 'jwk',
  } as Parameters<typeof createPublicKey>[0]);
}

/**
 * Client-side: sign a registration payload.
 * Returns a base64url signature string. The caller ships this alongside
 * public_key + registration_timestamp_ms in the /register request body.
 *
 * Private-key-only flow for clients that persist just the seed: we
 * materialize the keypair for signing, never leak it past this function.
 */
export function signRegistration(
  privateKeyBase64url: string,
  publicKeyBase64url: string,
  timestampMs: number,
): string {
  if (!POP_PUBLIC_KEY_REGEX.test(publicKeyBase64url)) {
    throw new Error('public_key must be base64url-encoded raw Ed25519 key (43 chars)');
  }
  const priv = importPrivateKey(privateKeyBase64url);
  const message = Buffer.from(
    canonicalRegistrationMessage(publicKeyBase64url, timestampMs),
    'utf8',
  );
  // Node's Ed25519 sign uses algorithm=null; it does internal hashing per RFC 8032.
  const sig = nodeSign(null, message, priv);
  return sig.toString('base64url');
}

/**
 * Server-side: verify a registration payload signature.
 * Returns true iff the signature is well-formed and validates the
 * canonical message against the supplied public key. Returns false on
 * any error — a thrown error here is treated as an auth failure, not an
 * infra failure.
 */
export function verifyRegistrationSignature(
  publicKeyBase64url: string,
  timestampMs: number,
  signatureBase64url: string,
): boolean {
  try {
    if (!POP_PUBLIC_KEY_REGEX.test(publicKeyBase64url)) return false;
    if (!POP_SIGNATURE_REGEX.test(signatureBase64url)) return false;
    if (!Number.isFinite(timestampMs)) return false;

    const pub = importPublicKey(publicKeyBase64url);
    const message = Buffer.from(
      canonicalRegistrationMessage(publicKeyBase64url, timestampMs),
      'utf8',
    );
    const sig = Buffer.from(signatureBase64url, 'base64url');
    return nodeVerify(null, message, pub, sig);
  } catch {
    return false;
  }
}

/**
 * Check that `timestampMs` is within ±POP_TIMESTAMP_WINDOW_MS of `now`.
 * A stale signature (replay beyond the window) returns false; a future
 * timestamp beyond the window also returns false so a client with a
 * badly-drifted clock is surfaced early instead of silently succeeding.
 */
export function isTimestampFresh(
  timestampMs: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(timestampMs)) return false;
  return Math.abs(now - timestampMs) <= POP_TIMESTAMP_WINDOW_MS;
}
