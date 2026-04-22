/**
 * Unit tests for the four pattern detectors.
 *
 * Detectors are pure functions that take a pre-built DetectionInput
 * and return a PatternDetection or null. That shape keeps them trivial
 * to test without a database: every test builds the input it needs and
 * asserts on the single return value.
 *
 * Each detector is tested for:
 *   - The main "fires" case (expected confidence, metadata shape).
 *   - The "doesn't fire" gates that keep false positives out.
 *   - Where applicable, confidence scaling boundaries.
 */
import { describe, it, expect } from 'vitest';
import { detectCompositionStaleness } from '../../packages/intelligence/patterns/composition-staleness.js';
import { detectRetryBurst } from '../../packages/intelligence/patterns/retry-burst.js';
import { detectLensCallSpike } from '../../packages/intelligence/patterns/lens-call-spike.js';
import { detectSkillVersionDrift } from '../../packages/intelligence/patterns/skill-version-drift.js';
import type { DetectionInput } from '../../packages/intelligence/patterns/types.js';

function baseInput(overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    agent_id: 'agt_01test',
    composition_updated_at: null,
    declared_targets: new Set(),
    recent_targets: [],
    lens_calls: { this_period: 0, prior_period: 0 },
    declared_skills: [],
    total_receipts_last_7d: 0,
    ...overrides,
  };
}

const NOW = new Date('2026-04-22T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('detectCompositionStaleness', () => {
  it('returns null when composition never set', () => {
    expect(detectCompositionStaleness(baseInput(), NOW)).toBeNull();
  });

  it('returns null when composition is fresh (<4 days old)', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 2 * DAY),
      declared_targets: new Set(),
      recent_targets: [
        { target_system_id: 'api:openai.com', call_count: 10, retry_count: 0 },
      ],
    });
    expect(detectCompositionStaleness(input, NOW)).toBeNull();
  });

  it('returns null when stale but all targets are declared', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 5 * DAY),
      declared_targets: new Set(['api:openai.com', 'mcp:filesystem']),
      recent_targets: [
        { target_system_id: 'api:openai.com', call_count: 50, retry_count: 0 },
        { target_system_id: 'mcp:filesystem', call_count: 20, retry_count: 0 },
      ],
    });
    expect(detectCompositionStaleness(input, NOW)).toBeNull();
  });

  it('ignores targets with <3 calls (too sparse)', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 5 * DAY),
      declared_targets: new Set(['api:openai.com']),
      recent_targets: [
        { target_system_id: 'api:openai.com', call_count: 50, retry_count: 0 },
        { target_system_id: 'api:one-off.com', call_count: 2, retry_count: 0 },
      ],
    });
    expect(detectCompositionStaleness(input, NOW)).toBeNull();
  });

  it('fires with 0.55 on a single undeclared target', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 5 * DAY),
      declared_targets: new Set(['api:openai.com']),
      recent_targets: [
        { target_system_id: 'api:openai.com', call_count: 50, retry_count: 0 },
        { target_system_id: 'api:slack.com', call_count: 8, retry_count: 0 },
      ],
    });
    const result = detectCompositionStaleness(input, NOW);
    expect(result).not.toBeNull();
    expect(result?.pattern_type).toBe('composition_staleness');
    expect(result?.confidence).toBe(0.55);
    expect(result?.metadata.undeclared_targets).toEqual(['api:slack.com']);
  });

  it('fires with 0.70 on two undeclared targets', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 5 * DAY),
      declared_targets: new Set(),
      recent_targets: [
        { target_system_id: 'api:a.com', call_count: 10, retry_count: 0 },
        { target_system_id: 'api:b.com', call_count: 10, retry_count: 0 },
      ],
    });
    expect(detectCompositionStaleness(input, NOW)?.confidence).toBe(0.70);
  });

  it('fires with 0.85 on 3+ undeclared targets', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 5 * DAY),
      declared_targets: new Set(),
      recent_targets: [
        { target_system_id: 'api:a.com', call_count: 10, retry_count: 0 },
        { target_system_id: 'api:b.com', call_count: 10, retry_count: 0 },
        { target_system_id: 'api:c.com', call_count: 10, retry_count: 0 },
        { target_system_id: 'api:d.com', call_count: 10, retry_count: 0 },
      ],
    });
    expect(detectCompositionStaleness(input, NOW)?.confidence).toBe(0.85);
  });

  it('reports composition age in days in metadata', () => {
    const input = baseInput({
      composition_updated_at: new Date(NOW.getTime() - 7 * DAY),
      declared_targets: new Set(),
      recent_targets: [
        { target_system_id: 'api:x.com', call_count: 10, retry_count: 0 },
      ],
    });
    const result = detectCompositionStaleness(input, NOW);
    expect(result?.metadata.composition_age_days).toBe(7);
  });
});

describe('detectRetryBurst', () => {
  it('returns null on empty targets', () => {
    expect(detectRetryBurst(baseInput())).toBeNull();
  });

  it('returns null when target has too few calls (<10)', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 8, retry_count: 6 },
      ],
    });
    expect(detectRetryBurst(input)).toBeNull();
  });

  it('returns null when retry count is too low (<5)', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 20, retry_count: 4 },
      ],
    });
    expect(detectRetryBurst(input)).toBeNull();
  });

  it('returns null when retry share is below threshold (<30%)', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 100, retry_count: 20 },
      ],
    });
    expect(detectRetryBurst(input)).toBeNull();
  });

  it('fires with 0.65 at 30%–50% retry share', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 20, retry_count: 7 },
      ],
    });
    const result = detectRetryBurst(input);
    expect(result).not.toBeNull();
    expect(result?.pattern_type).toBe('retry_burst');
    expect(result?.confidence).toBe(0.65);
    expect(result?.metadata.target_system_id).toBe('api:slack.com');
  });

  it('fires with 0.80 at 50%–70% retry share', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 20, retry_count: 12 },
      ],
    });
    expect(detectRetryBurst(input)?.confidence).toBe(0.80);
  });

  it('fires with 0.92 at ≥70% retry share', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:slack.com', call_count: 20, retry_count: 16 },
      ],
    });
    expect(detectRetryBurst(input)?.confidence).toBe(0.92);
  });

  it('reports the worst offender when multiple targets qualify', () => {
    const input = baseInput({
      recent_targets: [
        { target_system_id: 'api:a.com', call_count: 20, retry_count: 7 },    // 35%
        { target_system_id: 'api:b.com', call_count: 20, retry_count: 14 },   // 70%
      ],
    });
    const result = detectRetryBurst(input);
    expect(result?.metadata.target_system_id).toBe('api:b.com');
  });
});

describe('detectLensCallSpike', () => {
  it('returns null with no activity', () => {
    expect(detectLensCallSpike(baseInput())).toBeNull();
  });

  it('returns null when current period < 5 (absolute floor)', () => {
    const input = baseInput({
      lens_calls: { this_period: 4, prior_period: 1 },
    });
    expect(detectLensCallSpike(input)).toBeNull();
  });

  it('returns null when prior period < 3 (no baseline)', () => {
    const input = baseInput({
      lens_calls: { this_period: 20, prior_period: 2 },
    });
    expect(detectLensCallSpike(input)).toBeNull();
  });

  it('returns null when ratio < 2×', () => {
    const input = baseInput({
      lens_calls: { this_period: 10, prior_period: 8 },
    });
    expect(detectLensCallSpike(input)).toBeNull();
  });

  it('fires with 0.65 at 2–3× ratio', () => {
    const input = baseInput({
      lens_calls: { this_period: 10, prior_period: 4 },
    });
    const result = detectLensCallSpike(input);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0.65);
  });

  it('fires with 0.80 at 3–5× ratio', () => {
    const input = baseInput({
      lens_calls: { this_period: 15, prior_period: 4 },
    });
    expect(detectLensCallSpike(input)?.confidence).toBe(0.80);
  });

  it('fires with 0.90 at ≥5× ratio', () => {
    const input = baseInput({
      lens_calls: { this_period: 30, prior_period: 5 },
    });
    expect(detectLensCallSpike(input)?.confidence).toBe(0.90);
  });

  it('reports raw counts in metadata', () => {
    const input = baseInput({
      lens_calls: { this_period: 10, prior_period: 4 },
    });
    const result = detectLensCallSpike(input);
    expect(result?.metadata.this_period).toBe(10);
    expect(result?.metadata.prior_period).toBe(4);
  });
});

describe('detectSkillVersionDrift', () => {
  it('returns null when no declared skills', () => {
    expect(detectSkillVersionDrift(baseInput())).toBeNull();
  });

  it('returns null when all declared skills match the network version', () => {
    const input = baseInput({
      declared_skills: [
        { skill_hash: 'abc', skill_name: 'tool-a', current_hash_in_network: 'abc' },
      ],
    });
    expect(detectSkillVersionDrift(input)).toBeNull();
  });

  it('returns null when network version is unknown (null)', () => {
    // The catalog doesn't know the declared hash — could be a private
    // or freshly-authored skill. Don't fire on lack of knowledge.
    const input = baseInput({
      declared_skills: [
        { skill_hash: 'abc', skill_name: null, current_hash_in_network: null },
      ],
    });
    expect(detectSkillVersionDrift(input)).toBeNull();
  });

  it('fires with 0.80 when network has a newer hash', () => {
    const input = baseInput({
      declared_skills: [
        { skill_hash: 'old', skill_name: 'tool-a', current_hash_in_network: 'new' },
      ],
    });
    const result = detectSkillVersionDrift(input);
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0.80);
    const drifted = result?.metadata.drifted_skills as Array<{ skill_hash: string }>;
    expect(drifted).toHaveLength(1);
    expect(drifted[0].skill_hash).toBe('old');
  });

  it('aggregates multiple drifted skills in one detection', () => {
    const input = baseInput({
      declared_skills: [
        { skill_hash: 'a', skill_name: 'alpha', current_hash_in_network: 'a2' },
        { skill_hash: 'b', skill_name: 'beta', current_hash_in_network: 'b2' },
        { skill_hash: 'c', skill_name: 'gamma', current_hash_in_network: 'c' }, // match
      ],
    });
    const result = detectSkillVersionDrift(input);
    expect(result).not.toBeNull();
    const drifted = result?.metadata.drifted_skills as Array<{ skill_hash: string }>;
    expect(drifted).toHaveLength(2);
  });
});
