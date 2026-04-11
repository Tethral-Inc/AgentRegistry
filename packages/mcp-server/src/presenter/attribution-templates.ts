/**
 * Attribution template library for the ACR MCP.
 *
 * The server returns structured attribution labels. This module maps each
 * label to a plain-English sentence that follows ACR's rhetorical
 * invariant:
 *
 *   The subject of every attribution sentence is "your interaction
 *   profile" or "your composition". Never "you", "your fault",
 *   "your side". The profile is an entity with behaviors; the user
 *   is not at fault for its output.
 *
 * Templates are pure data. The render function is a deterministic
 * lookup — no LLM, no inference, no invention. If the server attaches a
 * recommended_action string, the presenter surfaces it verbatim.
 *
 * A linting test (tests/unit/attribution-templates.test.ts) grep-rejects
 * forbidden substrings at build time so drift can't sneak in.
 */

export type AttributionCostSide =
  | 'profile_dominant'
  | 'target_dominant'
  | 'balanced'
  | 'transmission_gap'
  | 'insufficient_data';

export type AttributionMagnitude = 'low' | 'moderate' | 'high' | 'severe';

export type AttributionCostPhase =
  | 'preparation'
  | 'processing'
  | 'queueing'
  | 'handoff'
  | 'unknown';

export interface AttributionLabel {
  target_system_id: string;
  cost_side: AttributionCostSide;
  cost_phase?: AttributionCostPhase;
  magnitude_category: AttributionMagnitude;
  recommended_action?: string | null;
  profile_side_proportion?: number | null;
  target_side_proportion?: number | null;
}

/**
 * Template table keyed on [cost_side][magnitude_category].
 * Every string uses "your interaction profile" or "your composition"
 * (or refers to the target directly) as the subject. No "you" as
 * subject of attribution sentences.
 * {target} is replaced with the target_system_id at render time.
 */
export const ATTRIBUTION_TEMPLATES: Record<
  AttributionCostSide,
  Record<AttributionMagnitude, string>
> = {
  profile_dominant: {
    low:
      'Your interaction profile accounted for slightly more of the time on calls to {target}.',
    moderate:
      'Your interaction profile accounted for most of the time on calls to {target}. The target responded in reasonable time.',
    high:
      'Your interaction profile accounted for the majority of the time on calls to {target} — substantially more than {target} itself.',
    severe:
      'Your interaction profile accounted for almost all of the time on calls to {target}. The target itself was quick.',
  },
  target_dominant: {
    low:
      '{target} accounted for slightly more of the time on these calls than your interaction profile did.',
    moderate:
      '{target} accounted for most of the time on these calls. Your interaction profile was quick in comparison.',
    high:
      '{target} accounted for the majority of the time on these calls. Your interaction profile handled its part quickly.',
    severe:
      '{target} accounted for almost all of the time on these calls. Your interaction profile contributed very little overhead.',
  },
  balanced: {
    low:
      'Cost on calls to {target} was split roughly evenly between your interaction profile and the target.',
    moderate:
      'Cost on calls to {target} was split roughly evenly between your interaction profile and the target.',
    high:
      'Cost on calls to {target} was split roughly evenly, but in absolute terms it was significant on both sides.',
    severe:
      'Cost on calls to {target} was split roughly evenly, and in absolute terms it was significant on both sides.',
  },
  transmission_gap: {
    low:
      '{target} responded quickly, but a small amount of time was lost in the handoff between your composition and the target.',
    moderate:
      '{target} responded quickly, but a notable portion of time was lost in the handoff between your composition and the target.',
    high:
      '{target} responded quickly. Most of the time on these calls was lost in the handoff between your composition and the target.',
    severe:
      '{target} responded quickly, but almost all of the time on these calls was lost in the handoff between your composition and the target.',
  },
  insufficient_data: {
    low: 'Not enough data yet to label the cost split on calls to {target}.',
    moderate: 'Not enough data yet to label the cost split on calls to {target}.',
    high: 'Not enough data yet to label the cost split on calls to {target}.',
    severe: 'Not enough data yet to label the cost split on calls to {target}.',
  },
};

/**
 * Optional phase phrasing appended to the base template when the server
 * supplies a cost_phase. Again, subject framing is profile/composition,
 * not the user.
 */
const PHASE_PHRASES: Record<AttributionCostPhase, string> = {
  preparation:
    ' The cost was in how your composition prepared the request.',
  processing:
    ' The cost was in how your composition processed the result after the target responded.',
  queueing:
    ' The cost was in queueing on your composition side before the call went out.',
  handoff:
    ' The cost was in the handoff between components in your composition.',
  unknown: '',
};

/**
 * Render an attribution label as plain English following the rhetorical
 * invariant. Pure function. No side effects. Always returns a non-empty
 * string.
 */
export function renderAttribution(label: AttributionLabel): string {
  const template =
    ATTRIBUTION_TEMPLATES[label.cost_side]?.[label.magnitude_category] ??
    ATTRIBUTION_TEMPLATES.insufficient_data.moderate;
  let text = template.replace(/\{target\}/g, label.target_system_id);

  if (label.cost_phase && label.cost_phase !== 'unknown') {
    text += PHASE_PHRASES[label.cost_phase] ?? '';
  }

  // Server-supplied recommendation, rendered verbatim if present.
  // The MCP never invents recommendation text.
  if (label.recommended_action) {
    text += ` Suggested next step: ${label.recommended_action}`;
  }

  return text;
}
