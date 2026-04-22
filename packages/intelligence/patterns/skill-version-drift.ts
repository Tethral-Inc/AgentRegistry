/**
 * skill_version_drift
 *
 * Fires when a skill the agent declared in its composition has a
 * newer hash observed in `skill_catalog`. That means the network has
 * seen the skill update (via another agent registering the newer
 * version), but this agent is still on the old one.
 *
 * Confidence is intentionally simple: this is a deterministic signal,
 * not a statistical one. If the catalog's `current_hash` differs from
 * the agent's declared hash, that's a drift. We set confidence to 0.8
 * regardless of count — a single drifted skill is worth surfacing.
 *
 * Metadata carries the drifted-skill list so the render can name the
 * skills ("sha256:abc… → sha256:def…") and link to get_skill_versions
 * for the diff.
 */

import type { DetectionInput, PatternDetection } from './types.js';

export function detectSkillVersionDrift(
  input: DetectionInput,
): PatternDetection | null {
  const drifted = input.declared_skills
    .filter((s) => s.current_hash_in_network !== null
      && s.current_hash_in_network !== s.skill_hash)
    .map((s) => ({
      skill_hash: s.skill_hash,
      skill_name: s.skill_name,
      current_hash: s.current_hash_in_network as string,
    }));

  if (drifted.length === 0) return null;

  const names = drifted
    .map((d) => d.skill_name ?? `${d.skill_hash.slice(0, 12)}…`)
    .slice(0, 5);
  const more = drifted.length > 5 ? ` (+${drifted.length - 5} more)` : '';

  return {
    pattern_type: 'skill_version_drift',
    confidence: 0.80,
    title: `${drifted.length} declared skill${drifted.length === 1 ? '' : 's'} ha${drifted.length === 1 ? 's' : 've'} a newer version in the network`,
    message: `Your declared composition references: ${names.join(', ')}${more}. Call get_skill_versions with each skill_hash to see the diff and decide whether to update.`,
    metadata: {
      drifted_skills: drifted,
    },
  };
}
