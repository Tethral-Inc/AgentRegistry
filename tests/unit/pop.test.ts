import { describe, it, expect } from 'vitest';
import {
  POP_TIMESTAMP_WINDOW_MS,
  POP_VERSION,
  POP_PUBLIC_KEY_REGEX,
  POP_SIGNATURE_REGEX,
  canonicalRegistrationMessage,
  generateAgentKeypair,
  signRegistration,
  verifyRegistrationSignature,
  isTimestampFresh,
} from '../../shared/crypto/pop.js';

describe('canonicalRegistrationMessage', () => {
  it('produces the versioned register: message', () => {
    expect(canonicalRegistrationMessage('PUB', 1234567890)).toBe(
      `register:${POP_VERSION}:PUB:1234567890`,
    );
  });
});

describe('generateAgentKeypair', () => {
  it('returns a 43-char base64url public key and 43-char private key', () => {
    const kp = generateAgentKeypair();
    // Raw Ed25519 pub key is 32 bytes → base64url unpadded = 43 chars.
    // Raw Ed25519 private seed is also 32 bytes → 43 chars.
    expect(kp.publicKey).toMatch(POP_PUBLIC_KEY_REGEX);
    expect(kp.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates distinct keypairs on each call', () => {
    const a = generateAgentKeypair();
    const b = generateAgentKeypair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe('signRegistration / verifyRegistrationSignature', () => {
  it('round-trips: a signed payload verifies against its public key', () => {
    const kp = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(kp.privateKey, kp.publicKey, ts);
    expect(sig).toMatch(POP_SIGNATURE_REGEX);
    expect(verifyRegistrationSignature(kp.publicKey, ts, sig)).toBe(true);
  });

  it('rejects a signature with tampered public_key', () => {
    const a = generateAgentKeypair();
    const b = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(a.privateKey, a.publicKey, ts);
    // Swap the public key — must not validate.
    expect(verifyRegistrationSignature(b.publicKey, ts, sig)).toBe(false);
  });

  it('rejects a signature with tampered timestamp', () => {
    const kp = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(kp.privateKey, kp.publicKey, ts);
    expect(verifyRegistrationSignature(kp.publicKey, ts + 1, sig)).toBe(false);
  });

  it('rejects a signature signed by a different private key', () => {
    const a = generateAgentKeypair();
    const b = generateAgentKeypair();
    const ts = Date.now();
    // Sign with a's private key, claim it's from b — verify against b's
    // public key must fail. This is the "attacker knows your public_key
    // but not the private key" case the whole module exists to block.
    const sig = signRegistration(a.privateKey, b.publicKey, ts);
    expect(verifyRegistrationSignature(b.publicKey, ts, sig)).toBe(false);
  });

  it('rejects malformed public_key', () => {
    const kp = generateAgentKeypair();
    const ts = Date.now();
    const sig = signRegistration(kp.privateKey, kp.publicKey, ts);
    // Too short.
    expect(verifyRegistrationSignature('short', ts, sig)).toBe(false);
  });

  it('rejects malformed signature', () => {
    const kp = generateAgentKeypair();
    const ts = Date.now();
    expect(verifyRegistrationSignature(kp.publicKey, ts, 'not-a-sig')).toBe(false);
  });

  it('returns false on NaN timestamp', () => {
    const kp = generateAgentKeypair();
    const sig = signRegistration(kp.privateKey, kp.publicKey, Date.now());
    expect(verifyRegistrationSignature(kp.publicKey, Number.NaN, sig)).toBe(false);
  });

  it('signRegistration rejects malformed public_key', () => {
    const kp = generateAgentKeypair();
    expect(() => signRegistration(kp.privateKey, 'bad', Date.now())).toThrow();
  });
});

describe('isTimestampFresh', () => {
  it('accepts a timestamp within the window', () => {
    const now = 1_000_000_000;
    expect(isTimestampFresh(now, now)).toBe(true);
    expect(isTimestampFresh(now - POP_TIMESTAMP_WINDOW_MS + 1, now)).toBe(true);
    expect(isTimestampFresh(now + POP_TIMESTAMP_WINDOW_MS - 1, now)).toBe(true);
  });

  it('rejects a stale timestamp', () => {
    const now = 1_000_000_000;
    expect(isTimestampFresh(now - POP_TIMESTAMP_WINDOW_MS - 1, now)).toBe(false);
  });

  it('rejects a future timestamp outside the window', () => {
    // Catches clients with badly-drifted clocks — better to fail loudly
    // than accept a sig that would reject on the next request.
    const now = 1_000_000_000;
    expect(isTimestampFresh(now + POP_TIMESTAMP_WINDOW_MS + 1, now)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isTimestampFresh(Number.NaN)).toBe(false);
  });
});
