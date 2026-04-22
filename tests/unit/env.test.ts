/**
 * Unit tests for the env-var parsing helpers.
 *
 * These helpers unify three historical conventions (`'true'`/`'false'`,
 * `'1'`, and default-true opt-out) that used to live scattered across
 * the server. A test here pins down exactly which strings are truthy
 * and falsy so a later refactor can't quietly widen the accepted set
 * and toggle someone's env var by accident.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envBool, envInt } from '../../packages/mcp-server/src/utils/env.js';

const KEY = '__ACR_TEST_ENV_VAR__';

describe('envBool', () => {
  beforeEach(() => { delete process.env[KEY]; });
  afterEach(() => { delete process.env[KEY]; });

  it('returns default when unset', () => {
    expect(envBool(KEY, true)).toBe(true);
    expect(envBool(KEY, false)).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'on', 'TRUE', 'On', 'Yes'])(
    'treats %s as truthy',
    (v) => {
      process.env[KEY] = v;
      expect(envBool(KEY, false)).toBe(true);
    },
  );

  it.each(['0', 'false', 'no', 'off', 'FALSE', 'Off', 'No'])(
    'treats %s as falsy',
    (v) => {
      process.env[KEY] = v;
      expect(envBool(KEY, true)).toBe(false);
    },
  );

  it('trims surrounding whitespace', () => {
    process.env[KEY] = '  true  ';
    expect(envBool(KEY, false)).toBe(true);
  });

  it('falls back to default on unrecognised values', () => {
    process.env[KEY] = 'verbose';
    expect(envBool(KEY, true)).toBe(true);
    expect(envBool(KEY, false)).toBe(false);
  });

  it('treats empty string as unrecognised (not falsy)', () => {
    // Defensive: a shell that exports an empty var shouldn't flip a
    // default-true flag to false.
    process.env[KEY] = '';
    expect(envBool(KEY, true)).toBe(true);
  });
});

describe('envInt', () => {
  beforeEach(() => { delete process.env[KEY]; });
  afterEach(() => { delete process.env[KEY]; });

  it('returns default when unset', () => {
    expect(envInt(KEY, 3001)).toBe(3001);
  });

  it('parses a valid integer', () => {
    process.env[KEY] = '8080';
    expect(envInt(KEY, 3001)).toBe(8080);
  });

  it('falls back on empty string', () => {
    process.env[KEY] = '';
    expect(envInt(KEY, 3001)).toBe(3001);
  });

  it('falls back on non-numeric', () => {
    process.env[KEY] = 'not-a-port';
    expect(envInt(KEY, 3001)).toBe(3001);
  });

  it('parses leading-integer strings via parseInt semantics', () => {
    // parseInt stops at the first non-digit. Documented behavior.
    process.env[KEY] = '8080x';
    expect(envInt(KEY, 3001)).toBe(8080);
  });
});
