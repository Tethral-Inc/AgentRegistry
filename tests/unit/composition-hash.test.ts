/**
 * Unit tests for composition-hash derivation.
 *
 * Covers the Phase 3 fix where the server previously hashed only
 * `skill_hashes` — collapsing every rich-only composition to sha256('').
 * The helper now folds flat + rich + sub_components into a stable
 * identity list.
 *
 * Invariants asserted:
 *   1. Backwards compat: a caller sending only `skill_hashes` produces
 *      the same `composition_hash` as the old logic.
 *   2. Rich-only compositions no longer collapse — two distinct rich
 *      payloads yield distinct hashes.
 *   3. Hash is stable against reordering within every field.
 *   4. Sub_components participate — adding/removing one changes the hash.
 *   5. Type namespace prevents name collisions between e.g. a skill and
 *      an mcp that happen to share a name.
 *   6. Version bumps change the hash so we can attribute signal drift
 *      to a specific version.
 */
import { describe, it, expect } from 'vitest';
import {
  computeCompositionHash,
  extractCompositionComponentHashes,
} from '../../shared/crypto/hash.js';

function hashOf(composition: Parameters<typeof extractCompositionComponentHashes>[0]): string {
  return computeCompositionHash(extractCompositionComponentHashes(composition));
}

describe('extractCompositionComponentHashes — backwards compat', () => {
  it('flat skill_hashes-only payload produces the same hash as the pre-Phase-3 logic', () => {
    const hashes = ['aaa', 'bbb', 'ccc'];
    const legacy = computeCompositionHash(hashes);
    const next = hashOf({ skill_hashes: hashes });
    expect(next).toBe(legacy);
  });

  it('empty composition matches the pre-Phase-3 sha256("") sentinel', () => {
    const legacy = computeCompositionHash([]);
    expect(hashOf({})).toBe(legacy);
  });
});

describe('extractCompositionComponentHashes — rich composition no longer collapses', () => {
  it('two distinct rich-only compositions produce distinct hashes', () => {
    const a = hashOf({
      skill_components: [{ id: 'skill-foo' }],
    });
    const b = hashOf({
      skill_components: [{ id: 'skill-bar' }],
    });
    expect(a).not.toBe(b);
  });

  it('rich-only and empty are distinguishable', () => {
    const empty = hashOf({});
    const rich = hashOf({
      skill_components: [{ id: 'skill-foo' }],
    });
    expect(rich).not.toBe(empty);
  });
});

describe('extractCompositionComponentHashes — stability under reordering', () => {
  it('hash is order-independent for skill_hashes', () => {
    const a = hashOf({ skill_hashes: ['x', 'y', 'z'] });
    const b = hashOf({ skill_hashes: ['z', 'y', 'x'] });
    expect(a).toBe(b);
  });

  it('hash is order-independent for rich skill_components', () => {
    const a = hashOf({
      skill_components: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    const b = hashOf({
      skill_components: [{ id: 'c' }, { id: 'a' }, { id: 'b' }],
    });
    expect(a).toBe(b);
  });

  it('hash is order-independent across distinct component arrays', () => {
    const a = hashOf({
      skill_components: [{ id: 's' }],
      mcp_components: [{ id: 'm' }],
    });
    const b = hashOf({
      mcp_components: [{ id: 'm' }],
      skill_components: [{ id: 's' }],
    });
    expect(a).toBe(b);
  });
});

describe('extractCompositionComponentHashes — sub_components participate', () => {
  it('adding a sub_component changes the hash', () => {
    const before = hashOf({
      skill_components: [{ id: 'skill-foo' }],
    });
    const after = hashOf({
      skill_components: [
        {
          id: 'skill-foo',
          sub_components: [{ id: 'sub-a' }],
        },
      ],
    });
    expect(after).not.toBe(before);
  });

  it('removing a sub_component changes the hash', () => {
    const two = hashOf({
      skill_components: [
        {
          id: 'skill-foo',
          sub_components: [{ id: 'sub-a' }, { id: 'sub-b' }],
        },
      ],
    });
    const one = hashOf({
      skill_components: [
        {
          id: 'skill-foo',
          sub_components: [{ id: 'sub-a' }],
        },
      ],
    });
    expect(two).not.toBe(one);
  });
});

describe('extractCompositionComponentHashes — namespace isolation', () => {
  it('a skill and an mcp with the same id yield different hashes', () => {
    const asSkill = hashOf({ skill_components: [{ id: 'shared-name' }] });
    const asMcp = hashOf({ mcp_components: [{ id: 'shared-name' }] });
    expect(asSkill).not.toBe(asMcp);
  });

  it('a flat skill name and a flat mcp name with the same label yield different hashes', () => {
    const asSkill = hashOf({ skills: ['slack'] });
    const asMcp = hashOf({ mcps: ['slack'] });
    expect(asSkill).not.toBe(asMcp);
  });
});

describe('extractCompositionComponentHashes — version bumps matter', () => {
  it('bumping the version of a component changes the hash', () => {
    const v1 = hashOf({
      skill_components: [{ id: 'skill-foo', version: '1.0.0' }],
    });
    const v2 = hashOf({
      skill_components: [{ id: 'skill-foo', version: '2.0.0' }],
    });
    expect(v1).not.toBe(v2);
  });

  it('missing version is distinct from an explicit version', () => {
    const noVersion = hashOf({
      skill_components: [{ id: 'skill-foo' }],
    });
    const withVersion = hashOf({
      skill_components: [{ id: 'skill-foo', version: '1.0.0' }],
    });
    expect(noVersion).not.toBe(withVersion);
  });
});

describe('extractCompositionComponentHashes — flat + rich combined', () => {
  it('mixing flat and rich is deterministic and order-independent', () => {
    const a = hashOf({
      skills: ['a', 'b'],
      skill_hashes: ['hash1', 'hash2'],
      skill_components: [{ id: 'comp-x' }],
    });
    const b = hashOf({
      skill_components: [{ id: 'comp-x' }],
      skill_hashes: ['hash2', 'hash1'],
      skills: ['b', 'a'],
    });
    expect(a).toBe(b);
  });
});
