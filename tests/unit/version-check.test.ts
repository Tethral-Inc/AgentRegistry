import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseSemver,
  isNewerVersion,
  renderUpgradeBanner,
  checkLatestVersion,
} from '../../packages/mcp-server/src/version-check.js';

describe('parseSemver', () => {
  it('parses plain "major.minor.patch"', () => {
    expect(parseSemver('2.4.0')).toEqual([2, 4, 0]);
    expect(parseSemver('10.0.3')).toEqual([10, 0, 3]);
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0]);
  });

  it('strips a leading "v"', () => {
    expect(parseSemver('v2.4.0')).toEqual([2, 4, 0]);
    expect(parseSemver('V1.2.3')).toEqual([1, 2, 3]);
  });

  it('drops pre-release and build metadata', () => {
    expect(parseSemver('2.4.0-beta.1')).toEqual([2, 4, 0]);
    expect(parseSemver('2.4.0+build.77')).toEqual([2, 4, 0]);
    expect(parseSemver('v3.1.0-rc1')).toEqual([3, 1, 0]);
  });

  it('returns null for non-triples', () => {
    expect(parseSemver('2.4')).toBeNull();
    expect(parseSemver('2.4.0.1')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });

  it('returns null for negative or non-numeric parts', () => {
    expect(parseSemver('2.x.0')).toBeNull();
    expect(parseSemver('2.-1.0')).toBeNull();
    expect(parseSemver('a.b.c')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseSemver(undefined as unknown as string)).toBeNull();
    expect(parseSemver(null as unknown as string)).toBeNull();
    expect(parseSemver(240 as unknown as string)).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('returns true when candidate > baseline on any level', () => {
    expect(isNewerVersion('2.4.1', '2.4.0')).toBe(true);
    expect(isNewerVersion('2.5.0', '2.4.9')).toBe(true);
    expect(isNewerVersion('3.0.0', '2.99.99')).toBe(true);
  });

  it('returns false when equal', () => {
    expect(isNewerVersion('2.4.0', '2.4.0')).toBe(false);
  });

  it('returns false when candidate < baseline', () => {
    expect(isNewerVersion('2.3.9', '2.4.0')).toBe(false);
    expect(isNewerVersion('1.99.99', '2.0.0')).toBe(false);
  });

  it('treats pre-release equal to released (ignores pre-release tag)', () => {
    // 2.4.1-beta parses as 2.4.1; not greater than 2.4.1.
    expect(isNewerVersion('2.4.1-beta', '2.4.1')).toBe(false);
    // But 2.4.1-beta is still greater than 2.4.0.
    expect(isNewerVersion('2.4.1-beta', '2.4.0')).toBe(true);
  });

  it('returns false on parse failure (quiet no-op)', () => {
    expect(isNewerVersion('latest', '2.4.0')).toBe(false);
    expect(isNewerVersion('2.4.0', 'latest')).toBe(false);
    expect(isNewerVersion('', '')).toBe(false);
  });
});

describe('renderUpgradeBanner', () => {
  it('returns empty string for null result', () => {
    expect(renderUpgradeBanner(null)).toBe('');
  });

  it('returns empty string when no upgrade available', () => {
    expect(
      renderUpgradeBanner({
        current: '2.4.0',
        latest: '2.4.0',
        upgradeAvailable: false,
        checkedAt: new Date(),
      }),
    ).toBe('');
  });

  it('returns empty string when latest is null', () => {
    expect(
      renderUpgradeBanner({
        current: '2.4.0',
        latest: null,
        upgradeAvailable: false,
        checkedAt: new Date(),
      }),
    ).toBe('');
  });

  it('renders a banner with current, latest, update command, and opt-out when upgrade available', () => {
    const banner = renderUpgradeBanner({
      current: '2.4.0',
      latest: '2.4.1',
      upgradeAvailable: true,
      checkedAt: new Date(),
    });
    expect(banner).toContain('2.4.0');
    expect(banner).toContain('2.4.1');
    expect(banner).toContain('@tethral/acr-mcp');
    expect(banner).toContain('npx');
    expect(banner).toContain('ACR_DISABLE_VERSION_CHECK=1');
    expect(banner.endsWith('\n\n')).toBe(true);
  });
});

describe('checkLatestVersion', () => {
  const origEnv = process.env.ACR_DISABLE_VERSION_CHECK;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.ACR_DISABLE_VERSION_CHECK;
    else process.env.ACR_DISABLE_VERSION_CHECK = origEnv;
  });

  it('returns upgradeAvailable=true when registry reports a newer version', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '2.4.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(result.current).toBe('2.4.0');
    expect(result.latest).toBe('2.4.1');
    expect(result.upgradeAvailable).toBe(true);
  });

  it('returns upgradeAvailable=false when versions match', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '2.4.0' })),
    );
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(result.latest).toBe('2.4.0');
    expect(result.upgradeAvailable).toBe(false);
  });

  it('returns latest=null on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(result.latest).toBeNull();
    expect(result.upgradeAvailable).toBe(false);
  });

  it('returns latest=null when fetch throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(result.latest).toBeNull();
    expect(result.upgradeAvailable).toBe(false);
  });

  it('returns latest=null when body has no version field', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'foo' })),
    );
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(result.latest).toBeNull();
  });

  it('short-circuits with latest=null when ACR_DISABLE_VERSION_CHECK=1', async () => {
    process.env.ACR_DISABLE_VERSION_CHECK = '1';
    const fetchImpl = vi.fn();
    const result = await checkLatestVersion('2.4.0', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.latest).toBeNull();
    expect(result.upgradeAvailable).toBe(false);
  });
});
