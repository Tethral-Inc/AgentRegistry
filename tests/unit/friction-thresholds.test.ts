/**
 * Tests for friction-report verdict thresholds. The constants are the
 * truth — these tests lock in the boundary conditions so a future tweak
 * to the numbers is a conscious change, not a silent drift.
 */

import { describe, expect, it } from 'vitest';
import {
  BETTER_RATIO,
  CONFIG_RATIO,
  LOCAL_CONFIG_FLOOR_PCT,
  LOCAL_MIN_INTERACTIONS,
  NETWORK_HEALTHY_PCT,
  NETWORK_MIN_AGENTS,
  NETWORK_MIN_INTERACTIONS,
  NETWORK_WIDE_PCT,
  VERDICT_BETTER_THAN_NETWORK,
  VERDICT_CONSISTENT,
  VERDICT_LIKELY_CONFIG,
  VERDICT_NETWORK_WIDE,
  hasEnoughSampleForVerdict,
  renderVerdict,
} from '../../packages/mcp-server/src/config/friction-thresholds.ts';

describe('friction-thresholds constants', () => {
  it('has sane defaults', () => {
    expect(LOCAL_MIN_INTERACTIONS).toBe(10);
    expect(NETWORK_MIN_AGENTS).toBe(3);
    expect(NETWORK_MIN_INTERACTIONS).toBe(50);
    expect(NETWORK_HEALTHY_PCT).toBe(5);
    expect(LOCAL_CONFIG_FLOOR_PCT).toBe(5);
    expect(CONFIG_RATIO).toBe(2);
    expect(BETTER_RATIO).toBe(2);
    expect(NETWORK_WIDE_PCT).toBe(20);
  });
});

describe('hasEnoughSampleForVerdict', () => {
  it('requires local floor', () => {
    const r = hasEnoughSampleForVerdict({
      localInteractionCount: 5,
      networkAgentCount: 10,
      networkInteractionCount: 1000,
    });
    expect(r.enough).toBe(false);
    expect(r.missing).toBe('local');
  });

  it('requires network agent floor', () => {
    const r = hasEnoughSampleForVerdict({
      localInteractionCount: 50,
      networkAgentCount: 2,
      networkInteractionCount: 1000,
    });
    expect(r.enough).toBe(false);
    expect(r.missing).toBe('network');
  });

  it('requires network interaction floor when known', () => {
    const r = hasEnoughSampleForVerdict({
      localInteractionCount: 50,
      networkAgentCount: 5,
      networkInteractionCount: 20,
    });
    expect(r.enough).toBe(false);
    expect(r.missing).toBe('network');
  });

  it('accepts unknown network interaction count', () => {
    // If the server didn't surface the number, we don't block — agent
    // count alone is enough signal.
    const r = hasEnoughSampleForVerdict({
      localInteractionCount: 50,
      networkAgentCount: 5,
      networkInteractionCount: null,
    });
    expect(r.enough).toBe(true);
    expect(r.missing).toBe(null);
  });

  it('enough when all floors cleared', () => {
    const r = hasEnoughSampleForVerdict({
      localInteractionCount: 10,
      networkAgentCount: 3,
      networkInteractionCount: 50,
    });
    expect(r.enough).toBe(true);
  });
});

describe('renderVerdict', () => {
  it('fires "likely your config" when net healthy and local elevated', () => {
    const r = renderVerdict({ localFailRate: 0.12, networkFailRate: 0.02 });
    expect(r.verdict).toBe(VERDICT_LIKELY_CONFIG);
    expect(r.clause).toBe('likely_config');
    expect(r.math.yoursPct).toBeCloseTo(12);
    expect(r.math.netPct).toBeCloseTo(2);
    expect(r.math.rule).toContain('yours>2×net');
  });

  it('does not fire "likely your config" without absolute floor', () => {
    // 4% local > 2 * 0.5% = 1%, but local < 5% floor → should not fire.
    const r = renderVerdict({ localFailRate: 0.04, networkFailRate: 0.005 });
    expect(r.clause).not.toBe('likely_config');
  });

  it('fires "better than network" when you fail half as often', () => {
    const r = renderVerdict({ localFailRate: 0.05, networkFailRate: 0.20 });
    expect(r.verdict).toBe(VERDICT_BETTER_THAN_NETWORK);
    expect(r.clause).toBe('better');
  });

  it('does not fire "better" when local is zero', () => {
    // yoursPct > 0 guards divide-by-zero. Zero failures → "consistent."
    const r = renderVerdict({ localFailRate: 0, networkFailRate: 0.30 });
    expect(r.clause).not.toBe('better');
  });

  it('fires "network-wide" when both rates are elevated', () => {
    const r = renderVerdict({ localFailRate: 0.25, networkFailRate: 0.30 });
    expect(r.verdict).toBe(VERDICT_NETWORK_WIDE);
    expect(r.clause).toBe('network_wide');
  });

  it('defaults to "consistent" when no clause fires', () => {
    const r = renderVerdict({ localFailRate: 0.03, networkFailRate: 0.04 });
    expect(r.verdict).toBe(VERDICT_CONSISTENT);
    expect(r.clause).toBe('consistent');
  });

  it('puts threshold rule in math.rule for all clauses', () => {
    for (const input of [
      { localFailRate: 0.12, networkFailRate: 0.01 }, // likely_config
      { localFailRate: 0.05, networkFailRate: 0.20 }, // better
      { localFailRate: 0.25, networkFailRate: 0.30 }, // network_wide
      { localFailRate: 0.03, networkFailRate: 0.04 }, // consistent
    ]) {
      const r = renderVerdict(input);
      expect(r.math.rule).toBeTruthy();
      expect(r.math.rule.length).toBeGreaterThan(0);
    }
  });
});
