import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REGISTER_CHURN_THRESHOLD,
  parseRegisterChurnThreshold,
  shouldRejectRegistration,
  extractClientIp,
} from '../../packages/ingestion-api/src/lib/register-churn.js';

describe('parseRegisterChurnThreshold', () => {
  it('returns default on undefined', () => {
    expect(parseRegisterChurnThreshold(undefined)).toBe(DEFAULT_REGISTER_CHURN_THRESHOLD);
  });

  it('returns default on empty string', () => {
    expect(parseRegisterChurnThreshold('')).toBe(DEFAULT_REGISTER_CHURN_THRESHOLD);
  });

  it('returns default on non-numeric', () => {
    expect(parseRegisterChurnThreshold('banana')).toBe(DEFAULT_REGISTER_CHURN_THRESHOLD);
  });

  it('returns default on zero', () => {
    // Zero would effectively reject everything; treat as misconfiguration.
    expect(parseRegisterChurnThreshold('0')).toBe(DEFAULT_REGISTER_CHURN_THRESHOLD);
  });

  it('returns default on negative', () => {
    expect(parseRegisterChurnThreshold('-5')).toBe(DEFAULT_REGISTER_CHURN_THRESHOLD);
  });

  it('parses a valid positive integer', () => {
    expect(parseRegisterChurnThreshold('50')).toBe(50);
  });

  it('parses large values', () => {
    expect(parseRegisterChurnThreshold('10000')).toBe(10000);
  });
});

describe('shouldRejectRegistration', () => {
  it('accepts well below threshold', () => {
    expect(shouldRejectRegistration(5, 100)).toBe(false);
  });

  it('accepts one below threshold', () => {
    // threshold=100 means "accept the 99th, then accept the 100th".
    // This test pins the intent: count<threshold is always accepted.
    expect(shouldRejectRegistration(99, 100)).toBe(false);
  });

  it('rejects at threshold exactly', () => {
    // count=threshold is the first rejected. Reads naturally in logs:
    // "100 agents this hour (limit 100)" → rejected.
    expect(shouldRejectRegistration(100, 100)).toBe(true);
  });

  it('rejects above threshold', () => {
    expect(shouldRejectRegistration(500, 100)).toBe(true);
  });

  it('accepts at zero', () => {
    expect(shouldRejectRegistration(0, 100)).toBe(false);
  });

  it('accepts when count is negative (shouldnt happen but safe default)', () => {
    expect(shouldRejectRegistration(-1, 100)).toBe(false);
  });

  it('does not reject when count is NaN', () => {
    // If the DB returned something weird, fail open rather than locking
    // out legitimate callers.
    expect(shouldRejectRegistration(Number.NaN, 100)).toBe(false);
  });

  it('does not reject when threshold is misconfigured to 0', () => {
    // Matches parseRegisterChurnThreshold's behavior — a zero threshold
    // is treated as "no threshold," not "reject everything."
    expect(shouldRejectRegistration(5, 0)).toBe(false);
  });
});

describe('extractClientIp', () => {
  it('prefers x-forwarded-for first hop', () => {
    expect(extractClientIp('1.2.3.4, 5.6.7.8', '9.9.9.9')).toBe('1.2.3.4');
  });

  it('trims whitespace in x-forwarded-for', () => {
    expect(extractClientIp('   1.2.3.4  , 5.6.7.8', undefined)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(extractClientIp(undefined, '9.9.9.9')).toBe('9.9.9.9');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty', () => {
    expect(extractClientIp('', '9.9.9.9')).toBe('9.9.9.9');
  });

  it('returns unknown when both are missing', () => {
    expect(extractClientIp(undefined, undefined)).toBe('unknown');
  });

  it('returns unknown when both are empty', () => {
    expect(extractClientIp('', '')).toBe('unknown');
  });
});
