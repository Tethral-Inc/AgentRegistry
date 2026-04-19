import { z } from 'zod';

/**
 * Revealed-Preference scope.
 *
 * Longer windows than friction because preference is a multi-session
 * signal — what an agent *actually* depends on is only visible after
 * many calls. Default is yesterday: a complete 24-hour day in the past,
 * preferred over "today" because an in-progress day always looks
 * underused relative to the agent's steady state.
 */
export const RevealedPreferenceScope = z.enum(['yesterday', 'day', 'week', 'month']);
export type RevealedPreferenceScopeT = z.infer<typeof RevealedPreferenceScope>;

/**
 * Four-way classification of every target that appears in either the
 * declared composition or the agent's actual call history during the
 * window. Definitions:
 *   - bound_uncalled   : declared, never called
 *   - bound_underused  : declared, called once or twice
 *   - bound_active     : declared and called meaningfully (>=3 calls)
 *   - called_unbound   : called but not declared (composition drift)
 */
export const RevealedPreferenceClassification = z.enum([
  'bound_uncalled',
  'bound_underused',
  'bound_active',
  'called_unbound',
]);
export type RevealedPreferenceClassificationT = z.infer<typeof RevealedPreferenceClassification>;

export const RevealedPreferenceTargetSchema = z.object({
  target_system_id: z.string(),
  classification: RevealedPreferenceClassification,
  call_count: z.number(),
  binding_sources: z.array(z.enum(['mcp_observed', 'agent_reported'])),
  last_called: z.string().nullable(),
});

export const RevealedPreferenceReportSchema = z.object({
  agent_id: z.string(),
  name: z.string().nullable(),
  scope: RevealedPreferenceScope,
  period_start: z.string(),
  period_end: z.string(),
  summary: z.object({
    bound_targets: z.number(),
    called_targets: z.number(),
    bound_uncalled: z.number(),
    bound_underused: z.number(),
    bound_active: z.number(),
    called_unbound: z.number(),
    binding_source_disagreements: z.number(),
  }),
  targets: z.array(RevealedPreferenceTargetSchema),
});
