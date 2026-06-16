/**
 * End-of-session readout card.
 *
 * Reads the locally-stored agent identity (~/.claude/.acr-state.json — the
 * same file the capture hook already uses), pulls the day's friction lens,
 * and renders a compact human-readable summary to stdout. Wired as a
 * Claude Code `SessionEnd` hook, so it prints once when a session closes.
 *
 * No API key step for the user, ever: the key was auto-minted by the MCP on
 * first run and lives in the state file. This card reads it locally and uses
 * it locally — it never leaves the machine and the user never has to see,
 * type, or generate one.
 *
 * Fail-quiet: any error (no state, offline, empty data) returns null and the
 * caller prints nothing. A readout must never delay or clutter session close.
 */
import { readState } from './state.js';

const FRICTION_TIMEOUT_MS = 2500;

/** "platform:bash" -> "bash", "api:openai.com" -> "openai.com". */
function shortTarget(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? id : id.slice(i + 1);
}

interface FrictionSummary {
  total_interactions?: number;
  total_failures?: number;
  active_time_ratio?: number;
  friction_percentage?: number;
}

export async function renderSessionCard(): Promise<string | null> {
  const state = readState();
  if (!state?.agent_id || !state.api_url) return null;

  let data: {
    summary?: FrictionSummary;
    top_targets?: Array<{ target_system_id: string; proportion_of_total?: number }>;
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FRICTION_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (state.api_key) headers['Authorization'] = `Bearer ${state.api_key}`;
      const res = await fetch(
        `${state.api_url}/api/v1/agent/${encodeURIComponent(state.agent_id)}/friction?scope=day`,
        { headers, signal: controller.signal },
      );
      if (!res.ok) return null;
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }

  const s = data?.summary;
  if (!s || !s.total_interactions) return null; // nothing captured today — don't nag

  const ratio = (typeof s.active_time_ratio === 'number' ? s.active_time_ratio : s.friction_percentage) ?? 0;
  const sinks = (data.top_targets ?? [])
    .filter((t) => (t.proportion_of_total ?? 0) > 0.01)
    .slice(0, 3)
    .map((t) => `${shortTarget(t.target_system_id)} ${Math.round((t.proportion_of_total ?? 0) * 100)}%`);

  const dashBase = state.api_url.includes('acr.nfkey.ai') ? 'https://dashboard.acr.nfkey.ai' : null;
  const link = dashBase
    ? `${dashBase}/agents/${encodeURIComponent(state.agent_id)}/friction?range=week` +
      (state.api_key ? `#k=${encodeURIComponent(state.api_key)}` : '')
    : null;

  const lines = [
    `─ ACR · today ─`,
    `  ${s.total_interactions} tool calls · ${s.total_failures ?? 0} failures · ` +
      `${ratio.toFixed(0)}% of your active time spent waiting on tools`,
  ];
  if (sinks.length) lines.push(`  where the time went: ${sinks.join(' · ')}`);
  if (link) lines.push(`  full view → ${link}`);
  return lines.join('\n');
}
