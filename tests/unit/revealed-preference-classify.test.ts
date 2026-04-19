import { describe, it, expect } from 'vitest';
import {
  classifyRevealedPreference,
  UNDERUSED_THRESHOLD,
} from '../../packages/ingestion-api/src/lib/revealed-preference-classify.js';

describe('classifyRevealedPreference()', () => {
  it('called and unbound → called_unbound regardless of count', () => {
    expect(classifyRevealedPreference(false, 1)).toBe('called_unbound');
    expect(classifyRevealedPreference(false, 100)).toBe('called_unbound');
  });

  it('unbound with zero calls is a degenerate case → called_unbound', () => {
    // Callers should filter these out upstream, but defensive behavior:
    // we still treat it as "not bound, not called", and the
    // called_unbound branch wins because the "bound" predicate is false.
    expect(classifyRevealedPreference(false, 0)).toBe('called_unbound');
  });

  it('bound with zero calls → bound_uncalled', () => {
    expect(classifyRevealedPreference(true, 0)).toBe('bound_uncalled');
  });

  it('bound with call_count < threshold → bound_underused', () => {
    for (let n = 1; n < UNDERUSED_THRESHOLD; n++) {
      expect(classifyRevealedPreference(true, n)).toBe('bound_underused');
    }
  });

  it('bound with call_count == threshold → bound_active (boundary flip)', () => {
    expect(classifyRevealedPreference(true, UNDERUSED_THRESHOLD)).toBe('bound_active');
  });

  it('bound with call_count >> threshold → bound_active', () => {
    expect(classifyRevealedPreference(true, 1000)).toBe('bound_active');
  });

  it('threshold is 3 (documented value)', () => {
    expect(UNDERUSED_THRESHOLD).toBe(3);
  });
});
