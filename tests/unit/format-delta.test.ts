/**
 * Unit tests for the Phase 3 `get_trend` delta renderers.
 *
 * The server returns:
 *   - `latency_change_ratio`: fraction `(curr - prev) / prev`, i.e. a
 *     proportional change in [-1, +∞). Despite the name, this is NOT a
 *     ratio like 1.12 — it's a fraction like 0.12. The MCP must render
 *     it with an explicit sign so the operator can distinguish "slower"
 *     from "faster" at a glance.
 *   - `failure_rate_delta`: raw subtraction of two rates in [0, 1],
 *     rendered in percentage points.
 *
 * Pre-Phase 3 the MCP rendered these as `(x * 100).toFixed(1) + '%'` /
 * `+ ' pp'` with no sign — positive values looked identical to negative
 * ones on a quick scan. These tests lock the signed output format in.
 */
import { describe, it, expect } from 'vitest';
import {
  formatLatencyChangeFraction,
  formatFailureRateDelta,
} from '../../packages/mcp-server/src/utils/format-delta.js';

describe('formatLatencyChangeFraction — latency got slower', () => {
  it('renders +12.0% for fraction 0.12', () => {
    expect(formatLatencyChangeFraction(0.12)).toBe('+12.0%');
  });

  it('renders +100.0% for fraction 1.00 (latency doubled)', () => {
    expect(formatLatencyChangeFraction(1.0)).toBe('+100.0%');
  });

  it('renders +0.1% for a small positive change', () => {
    expect(formatLatencyChangeFraction(0.001)).toBe('+0.1%');
  });
});

describe('formatLatencyChangeFraction — latency got faster', () => {
  it('renders -3.4% for fraction -0.034', () => {
    expect(formatLatencyChangeFraction(-0.034)).toBe('-3.4%');
  });

  it('renders -50.0% for fraction -0.5 (latency halved)', () => {
    expect(formatLatencyChangeFraction(-0.5)).toBe('-50.0%');
  });
});

describe('formatLatencyChangeFraction — no change', () => {
  it('renders 0.0% for fraction 0', () => {
    // Intentional: zero gets no sign so the output reads as "unchanged"
    // rather than "+0.0%" (which could look like a tiny improvement).
    expect(formatLatencyChangeFraction(0)).toBe('0.0%');
  });
});

describe('formatFailureRateDelta — failures up', () => {
  it('renders +5.0 pp for delta 0.05', () => {
    expect(formatFailureRateDelta(0.05)).toBe('+5.0 pp');
  });

  it('renders +100.0 pp for a worst-case flip from 0% to 100%', () => {
    expect(formatFailureRateDelta(1.0)).toBe('+100.0 pp');
  });
});

describe('formatFailureRateDelta — failures down', () => {
  it('renders -1.2 pp for delta -0.012', () => {
    expect(formatFailureRateDelta(-0.012)).toBe('-1.2 pp');
  });

  it('renders -100.0 pp for a best-case flip from 100% to 0%', () => {
    expect(formatFailureRateDelta(-1.0)).toBe('-100.0 pp');
  });
});

describe('formatFailureRateDelta — no change', () => {
  it('renders 0.0 pp for delta 0', () => {
    expect(formatFailureRateDelta(0)).toBe('0.0 pp');
  });
});
