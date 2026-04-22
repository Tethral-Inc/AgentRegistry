/**
 * Unit tests for the cross-session npm version-check cache.
 *
 * The cache exists so bursty HTTP sessions don't each re-hit npm on
 * startup. These tests lock in:
 *   - Version-match invalidation: if the user upgrades, the cache is
 *     ignored (the whole point of a version check is to catch
 *     upgrades).
 *   - TTL invalidation: old cache entries fall through to a live
 *     check.
 *   - Fail-result suppression: a cache write with `latest=null` is a
 *     no-op, so a failed check doesn't stick for the whole TTL.
 *
 * The cache lives at `~/.claude/.acr-version-check.json`. The tests
 * mock `node:os` so `homedir()` deterministically returns a fresh
 * temp dir — relying on HOME/USERPROFILE env overrides is flaky
 * because Node/libuv may resolve the home directory through paths
 * that don't pick up runtime env mutations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempHome: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

// Import after the mock is registered so the module under test picks
// up the mocked homedir.
const { readCachedVersionCheck, writeCachedVersionCheck } = await import(
  '../../packages/mcp-server/src/version-check-cache.js'
);

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'acr-vcache-'));
});

afterEach(() => {
  try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('readCachedVersionCheck', () => {
  it('returns null when no cache file exists', () => {
    expect(readCachedVersionCheck('2.7.2')).toBeNull();
  });

  it('round-trips a written check', () => {
    const when = new Date('2026-04-22T10:00:00Z');
    writeCachedVersionCheck({
      current: '2.7.2',
      latest: '2.7.2',
      upgradeAvailable: false,
      checkedAt: when,
    });
    const cached = readCachedVersionCheck('2.7.2', when);
    expect(cached).not.toBeNull();
    expect(cached?.current).toBe('2.7.2');
    expect(cached?.latest).toBe('2.7.2');
    expect(cached?.upgradeAvailable).toBe(false);
    expect(cached?.checkedAt.toISOString()).toBe(when.toISOString());
  });

  it('invalidates when the running version differs from the cached version', () => {
    const when = new Date('2026-04-22T10:00:00Z');
    writeCachedVersionCheck({
      current: '2.7.1',
      latest: '2.7.2',
      upgradeAvailable: true,
      checkedAt: when,
    });
    // Caller upgraded locally. Cache must be ignored so we go and
    // verify against the registry.
    expect(readCachedVersionCheck('2.7.2', when)).toBeNull();
  });

  it('invalidates after 6h TTL', () => {
    const written = new Date('2026-04-22T10:00:00Z');
    const readAt = new Date(written.getTime() + 6 * 60 * 60 * 1000 + 1000);
    writeCachedVersionCheck({
      current: '2.7.2',
      latest: '2.7.3',
      upgradeAvailable: true,
      checkedAt: written,
    });
    expect(readCachedVersionCheck('2.7.2', readAt)).toBeNull();
  });

  it('returns the cached value just inside the TTL', () => {
    const written = new Date('2026-04-22T10:00:00Z');
    const readAt = new Date(written.getTime() + 6 * 60 * 60 * 1000 - 1000);
    writeCachedVersionCheck({
      current: '2.7.2',
      latest: '2.7.3',
      upgradeAvailable: true,
      checkedAt: written,
    });
    expect(readCachedVersionCheck('2.7.2', readAt)).not.toBeNull();
  });

  it('returns null on malformed cache contents', () => {
    // Simulate a partial write or hand-edited file.
    const dir = join(tempHome, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.acr-version-check.json'), '{not json');
    expect(readCachedVersionCheck('2.7.2')).toBeNull();
  });
});

describe('writeCachedVersionCheck', () => {
  it('does not write fail results (latest=null)', () => {
    writeCachedVersionCheck({
      current: '2.7.2',
      latest: null,
      upgradeAvailable: false,
      checkedAt: new Date(),
    });
    const cachePath = join(tempHome, '.claude', '.acr-version-check.json');
    expect(existsSync(cachePath)).toBe(false);
  });

  it('writes successful results', () => {
    writeCachedVersionCheck({
      current: '2.7.2',
      latest: '2.7.3',
      upgradeAvailable: true,
      checkedAt: new Date('2026-04-22T10:00:00Z'),
    });
    const cachePath = join(tempHome, '.claude', '.acr-version-check.json');
    expect(existsSync(cachePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(parsed.current).toBe('2.7.2');
    expect(parsed.latest).toBe('2.7.3');
    expect(parsed.upgradeAvailable).toBe(true);
  });
});
