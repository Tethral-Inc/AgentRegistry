/**
 * Proactive pattern fetching + rendering helpers.
 *
 * Phase J of the roadmap introduced `GET /agent/:id/patterns?active=true`
 * — an endpoint that serves the 4 named patterns the `pattern-detection`
 * cron upserts. MCP tools consume it through `fetchActivePatterns`
 * (silent failure — patterns are a nice-to-have, never a blocker) and
 * render them via `renderPatternsSection`, which keeps the
 * "── Things we noticed ──" shape identical across `get_my_agent` and
 * `whats_new`.
 *
 * The render intentionally omits confidence scores from the text (the
 * server already filters by a surface threshold — surfacing the number
 * to the operator adds noise without actionability). Dismiss
 * instructions point at the `dismiss_pattern` MCP tool rather than an
 * HTTP endpoint so the operator's decision flows through the same tool
 * surface as everything else.
 */

import { ARROW } from './style.js';

export interface ActivePattern {
  id: string;
  pattern_type: string;
  confidence: number;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  detected_at: string;
}

/**
 * Fetch the agent's active patterns. Returns an empty array on any
 * failure (network, HTTP error, parse) — patterns are additive
 * context, so they must never block the tool they augment.
 */
export async function fetchActivePatterns(
  apiUrl: string,
  agentId: string,
  authHeaders: Record<string, string>,
): Promise<ActivePattern[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/agent/${encodeURIComponent(agentId)}/patterns?active=true`,
      { headers: authHeaders },
    );
    if (!res.ok) return [];
    const body = await res.json() as { patterns?: ActivePattern[] };
    return Array.isArray(body.patterns) ? body.patterns : [];
  } catch {
    return [];
  }
}

/**
 * Render active patterns as a section. Returns the empty string when
 * there are no patterns so callers can concatenate without worrying
 * about trailing dividers. Up to `limit` patterns are shown; the rest
 * are summarized as a +N footer so the section stays compact on busy
 * agents.
 */
export function renderPatternsSection(
  patterns: ActivePattern[],
  opts: { limit?: number } = {},
): string {
  if (patterns.length === 0) return '';
  const limit = opts.limit ?? 3;
  const shown = patterns.slice(0, limit);

  let text = `\n── Things we noticed ──\n`;
  for (const p of shown) {
    text += `  ${p.title}\n`;
    text += `    ${p.message}\n`;
    text += `    ${ARROW} Not useful? dismiss_pattern(pattern_type="${p.pattern_type}")\n`;
  }
  if (patterns.length > limit) {
    const extra = patterns.length - limit;
    text += `  (+${extra} more pattern${extra === 1 ? '' : 's'} — call get_my_agent with verbose:true to see them all)\n`;
  }
  return text;
}
