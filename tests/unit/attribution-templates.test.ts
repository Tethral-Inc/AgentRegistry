import { describe, it, expect } from 'vitest';
import {
  ATTRIBUTION_TEMPLATES,
  renderAttribution,
  type AttributionLabel,
} from '../../packages/mcp-server/src/presenter/attribution-templates.js';

describe('ATTRIBUTION_TEMPLATES linting — rhetorical invariant', () => {
  // The rhetorical invariant from proposals/open-items-plan.md Item 4:
  // The subject of attribution sentences is "your interaction profile"
  // or "your composition". Never "you", "your fault", "your side".

  const FORBIDDEN_SUBSTRINGS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\byour\s+fault\b/i, label: 'your fault' },
    { pattern: /\byour\s+side\b/i, label: 'your side' },
    { pattern: /\byou\s+caused\b/i, label: 'you caused' },
    { pattern: /\byou\s+made\b/i, label: 'you made' },
    { pattern: /\byou\s+are\s+slow\b/i, label: 'you are slow' },
    { pattern: /\byou\s+were\s+slow\b/i, label: 'you were slow' },
    { pattern: /\byou\s+have\s+to\b/i, label: 'you have to' },
    { pattern: /\byou\s+should\s+have\b/i, label: 'you should have' },
  ];

  // A weaker form: the sentence's subject shouldn't be a bare "You".
  // This is harder to grep for, so we check that templates mentioning
  // the word "you" also mention "interaction profile" or "composition"
  // or refer to the target (target_dominant family talks about the target).
  function mentionsAllowedSubject(text: string): boolean {
    return (
      /interaction profile/i.test(text) ||
      /composition/i.test(text) ||
      /\{target\}|target/i.test(text)
    );
  }

  for (const [costSide, magnitudes] of Object.entries(ATTRIBUTION_TEMPLATES)) {
    for (const [mag, text] of Object.entries(magnitudes)) {
      it(`[${costSide}/${mag}] contains no forbidden substrings`, () => {
        for (const { pattern, label } of FORBIDDEN_SUBSTRINGS) {
          expect(
            pattern.test(text),
            `Template "${text}" matches forbidden substring "${label}"`,
          ).toBe(false);
        }
      });

      it(`[${costSide}/${mag}] uses an allowed subject (profile, composition, or target)`, () => {
        expect(
          mentionsAllowedSubject(text),
          `Template "${text}" does not mention "interaction profile", "composition", or "{target}" / "target"`,
        ).toBe(true);
      });

      it(`[${costSide}/${mag}] is non-empty`, () => {
        expect(text.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('renderAttribution', () => {
  const baseLabel: AttributionLabel = {
    target_system_id: 'mcp:github',
    cost_side: 'profile_dominant',
    magnitude_category: 'moderate',
  };

  it('renders profile_dominant/moderate with target substitution', () => {
    const text = renderAttribution(baseLabel);
    expect(text.toLowerCase()).toContain('your interaction profile');
    expect(text).toContain('mcp:github');
  });

  it('renders target_dominant with target name', () => {
    const text = renderAttribution({
      ...baseLabel,
      cost_side: 'target_dominant',
      magnitude_category: 'severe',
    });
    expect(text).toContain('mcp:github');
    expect(text).toContain('accounted for almost all');
  });

  it('renders insufficient_data as a calibration message', () => {
    const text = renderAttribution({
      ...baseLabel,
      cost_side: 'insufficient_data',
      magnitude_category: 'low',
    });
    expect(text.toLowerCase()).toContain('not enough data');
  });

  it('appends cost_phase when provided', () => {
    const textWithoutPhase = renderAttribution(baseLabel);
    const textWithPhase = renderAttribution({
      ...baseLabel,
      cost_phase: 'preparation',
    });
    // The preparation phrase is appended so the with-phase text should
    // be longer and contain the base text as a prefix.
    expect(textWithPhase.length).toBeGreaterThan(textWithoutPhase.length);
    expect(textWithPhase.startsWith(textWithoutPhase)).toBe(true);
  });

  it('does not append unknown cost_phase', () => {
    const text = renderAttribution({
      ...baseLabel,
      cost_phase: 'unknown',
    });
    // The base template should still be present; unknown contributes nothing
    expect(text.toLowerCase()).toContain('your interaction profile');
  });

  it('renders server-supplied recommendation verbatim when present', () => {
    const text = renderAttribution({
      ...baseLabel,
      recommended_action: 'Review the chain overhead between your skill and GitHub.',
    });
    expect(text).toContain('Suggested next step:');
    expect(text).toContain('Review the chain overhead between your skill and GitHub.');
  });

  it('omits suggestion when recommendation is null', () => {
    const text = renderAttribution({ ...baseLabel, recommended_action: null });
    expect(text).not.toContain('Suggested next step');
  });
});
