/**
 * Unit tests for the watch evaluation decision function.
 *
 * `evaluateWatch` is pure — it takes (metricValue, watch, now) and
 * returns one of three outcomes. The cron handler wraps it with I/O
 * on one side (bulk metrics from SQL) and notification writes on the
 * other, but the decision itself is trivial to test in isolation.
 *
 * The cooldown gate is the only non-obvious rule: a persistent breach
 * shouldn't generate a daily stream of notifications. We test the
 * boundary (exactly 24h since last match) and both sides of it.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateWatch,
  crossesThreshold,
  COOLDOWN_MS,
  type WatchLike,
} from '../../packages/intelligence/watches/evaluate.js';

const NOW = new Date('2026-04-22T10:00:00Z');

function watch(overrides: Partial<WatchLike> = {}): WatchLike {
  return {
    threshold: 0.2,
    condition: 'above',
    last_matched_at: null,
    ...overrides,
  };
}

describe('crossesThreshold', () => {
  it('"above" fires when metric > threshold', () => {
    expect(crossesThreshold(0.3, watch({ threshold: 0.2, condition: 'above' }))).toBe(true);
  });

  it('"above" does not fire at exactly the threshold (strict)', () => {
    expect(crossesThreshold(0.2, watch({ threshold: 0.2, condition: 'above' }))).toBe(false);
  });

  it('"above" does not fire below the threshold', () => {
    expect(crossesThreshold(0.1, watch({ threshold: 0.2, condition: 'above' }))).toBe(false);
  });

  it('"below" fires when metric < threshold', () => {
    expect(crossesThreshold(0.1, watch({ threshold: 0.2, condition: 'below' }))).toBe(true);
  });

  it('"below" does not fire at exactly the threshold (strict)', () => {
    expect(crossesThreshold(0.2, watch({ threshold: 0.2, condition: 'below' }))).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(crossesThreshold(Infinity, watch())).toBe(false);
    expect(crossesThreshold(NaN, watch())).toBe(false);
  });
});

describe('evaluateWatch', () => {
  it('no_match when metric is null', () => {
    expect(evaluateWatch(null, watch(), NOW)).toBe('no_match');
  });

  it('no_match when metric is NaN', () => {
    expect(evaluateWatch(NaN, watch(), NOW)).toBe('no_match');
  });

  it('no_match when value does not cross threshold', () => {
    expect(evaluateWatch(0.1, watch({ threshold: 0.2, condition: 'above' }), NOW)).toBe('no_match');
  });

  it('match_new on first crossing (no prior match)', () => {
    expect(evaluateWatch(0.3, watch({ last_matched_at: null }), NOW)).toBe('match_new');
  });

  it('match_ongoing when within cooldown window', () => {
    const lastMatch = new Date(NOW.getTime() - COOLDOWN_MS + 60 * 1000); // 1 min before cooldown expires
    expect(evaluateWatch(0.3, watch({ last_matched_at: lastMatch }), NOW)).toBe('match_ongoing');
  });

  it('match_ongoing at exactly 23h59m since last match', () => {
    const lastMatch = new Date(NOW.getTime() - (COOLDOWN_MS - 60 * 1000));
    expect(evaluateWatch(0.3, watch({ last_matched_at: lastMatch }), NOW)).toBe('match_ongoing');
  });

  it('match_new once cooldown has expired', () => {
    const lastMatch = new Date(NOW.getTime() - COOLDOWN_MS - 60 * 1000); // 1 min past cooldown
    expect(evaluateWatch(0.3, watch({ last_matched_at: lastMatch }), NOW)).toBe('match_new');
  });

  it('match_new for "below" condition crossing', () => {
    expect(evaluateWatch(0.05, watch({ threshold: 0.2, condition: 'below' }), NOW)).toBe('match_new');
  });

  it('no_match for "below" when value is above threshold', () => {
    expect(evaluateWatch(0.3, watch({ threshold: 0.2, condition: 'below' }), NOW)).toBe('no_match');
  });

  it('cooldown only applies after a crossing — non-match ignores last_matched_at', () => {
    // Metric is below threshold, last match was 1 minute ago. Outcome
    // should be 'no_match' regardless of cooldown state.
    const recentMatch = new Date(NOW.getTime() - 60 * 1000);
    expect(evaluateWatch(0.1, watch({ threshold: 0.2, condition: 'above', last_matched_at: recentMatch }), NOW))
      .toBe('no_match');
  });
});
