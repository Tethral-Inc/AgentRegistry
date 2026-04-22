/**
 * orient_me — state-aware routing for "what should I do next?"
 *
 * Replaces the static getting_started checklist with a state-sensitive
 * router. Reads profile + coverage + notifications + cohort baseline,
 * classifies the agent into one of three states, and returns the single
 * most useful next tool call for that state:
 *
 *   NEW         — just registered, zero receipts
 *                 → start logging + see cohort typical performance
 *   SOME_DATA   — <10 receipts, getting going
 *                 → keep logging, focus on coverage gaps
 *   STEADY      — ≥10 receipts
 *                 → jump to a lens (friction / notifications / trend)
 *
 * getting_started stays registered for now (discoverable by name) but
 * its description will route to orient_me starting in v2.7.0.
 *
 * Design principle: one crisp answer per state. Operators who want more
 * call the lens tools directly. This is the front door for "where am
 * I?", not a dashboard.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';
import { renderCohortBaselineHeader, THIN_SAMPLE_THRESHOLD } from '../utils/cohort-baseline.js';
import { getActiveSession } from '../session-state.js';
import { renderUpgradeBanner } from '../version-check.js';

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchAuthed(url);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type AgentState = 'NEW' | 'SOME_DATA' | 'STEADY';

interface StateContext {
  totalReceipts: number;
  compositionEmpty: boolean;
  coverageGaps: string[];
  unreadNotifications: number;
}

function classify(ctx: StateContext): AgentState {
  if (ctx.totalReceipts === 0) return 'NEW';
  if (ctx.totalReceipts < THIN_SAMPLE_THRESHOLD) return 'SOME_DATA';
  return 'STEADY';
}

export function orientMeTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'orient_me',
    {
      description: "Where am I, and what should I do next? Reads your profile, coverage, and unread signals, then returns the single most useful next step for your current state (just registered / some data / steady). Call this when you're unsure where to start. Replaces `getting_started` as the recommended front-door tool.",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 1.0 },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      let resolvedDisplayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        resolvedDisplayName = resolved.displayName;
      } catch (err) {
        return renderResolveError(err);
      }

      // Fetch state inputs in parallel. Every one is null-tolerant — if
      // a fetch fails the handler still renders *something*, because the
      // point of orient_me is to never leave the operator stuck.
      const [profile, coverage, notifications] = await Promise.all([
        fetchJson(`${apiUrl}/api/v1/agent/${id}/profile`),
        fetchJson(`${apiUrl}/api/v1/agent/${id}/coverage`),
        fetchJson(`${apiUrl}/api/v1/agent/${id}/notifications?unread=true&limit=1`),
      ]);

      const counts = (profile?.counts as Record<string, unknown> | null) ?? null;
      const comp = (profile?.composition_summary as Record<string, unknown> | null) ?? null;
      const totalReceipts = (counts?.total_receipts as number | undefined) ?? 0;
      const skillCount = (comp?.skill_count as number | undefined) ?? 0;
      const mcpCount = (comp?.mcp_count as number | undefined) ?? 0;
      const toolCount = (comp?.tool_count as number | undefined) ?? 0;
      const compositionEmpty = skillCount + mcpCount + toolCount === 0;

      const rules = (coverage?.rules as Array<{ signal: string; triggered: boolean }> | null) ?? [];
      const coverageGaps = rules.filter((r) => r.triggered).map((r) => r.signal);

      const unreadNotifications = (() => {
        const meta = notifications?.meta as Record<string, unknown> | undefined;
        const unread = meta?.unread_count as number | undefined;
        if (typeof unread === 'number') return unread;
        const items = notifications?.notifications as unknown[] | undefined;
        return Array.isArray(items) ? items.length : 0;
      })();

      const displayName = (profile?.name as string) || agent_name || getAgentName() || resolvedDisplayName;

      const ctx: StateContext = {
        totalReceipts,
        compositionEmpty,
        coverageGaps,
        unreadNotifications,
      };
      const state = classify(ctx);

      let text = renderUpgradeBanner(getActiveSession().versionCheck);
      text += `Orient: ${displayName}\n${'='.repeat(40)}\n\n`;

      // Unread notifications always win — if the server has surfaced a
      // signal, reading it is strictly more useful than any other next
      // step.
      if (unreadNotifications > 0) {
        text += `State: ${unreadNotifications} unread signal${unreadNotifications === 1 ? '' : 's'} waiting\n\n`;
        text += `→ Next step: call \`get_notifications\` to read them.\n`;
        text += renderDashboardFooter(id, 'overview');
        return { content: [{ type: 'text' as const, text }] };
      }

      if (state === 'NEW') {
        // Prepend cohort baseline so the new agent sees useful framing
        // on the very first call — not just a "you have nothing yet"
        // message.
        const cohort = await renderCohortBaselineHeader(apiUrl);
        if (cohort) text += cohort;
        text += `State: brand new (0 receipts)\n\n`;
        text += `Welcome. The data above (if shown) is what agents in your provider class typically see.\n`;
        text += `Your own profile is empty, so every lens will be thin until you start logging.\n\n`;
        text += `→ Next step: call \`log_interaction\` after every external tool call or API request.\n`;
        text += `   Each call adds a receipt. After ~10 receipts, lenses like \`get_friction_report\` start showing your own numbers.\n`;
        if (compositionEmpty) {
          text += `\nAlso worth doing: call \`update_composition\` with your skills, MCPs, and tools.\n`;
          text += `   Without it, anomaly signal notifications stay network-wide instead of scoped to what you use.\n`;
        }
      } else if (state === 'SOME_DATA') {
        // Thin-sample — cohort framing still useful.
        const cohort = await renderCohortBaselineHeader(apiUrl);
        if (cohort) text += cohort;
        text += `State: getting started (${totalReceipts} receipts, need ≥${THIN_SAMPLE_THRESHOLD} for full lenses)\n\n`;
        text += `→ Next step: keep calling \`log_interaction\`.\n`;
        text += `   You need ${Math.max(THIN_SAMPLE_THRESHOLD - totalReceipts, 1)} more receipts before lens verdicts become stable.\n`;
        if (coverageGaps.length > 0) {
          text += `\nWhile you're at it: your log_interaction calls are missing some fields.\n`;
          text += `   Gaps: ${coverageGaps.join(', ')}\n`;
          text += `   Call \`get_coverage\` to see what each gap disables.\n`;
        }
      } else {
        // STEADY — the operator has enough data; route to the most
        // interesting lens for their current shape.
        text += `State: steady (${totalReceipts} receipts)\n\n`;
        if (coverageGaps.length > 0) {
          text += `→ Next step: call \`get_friction_report\` to read your behavior this week.\n`;
          text += `   Coverage has ${coverageGaps.length} gap${coverageGaps.length === 1 ? '' : 's'} (${coverageGaps.join(', ')}) — consider closing them for richer lenses.\n`;
        } else {
          text += `→ Next step: call \`get_friction_report\` to read your behavior this week.\n`;
          text += `   Coverage is complete, so every lens has signal.\n`;
        }
        text += `\nAlternative lenses when you have a specific question:\n`;
        text += `  \`get_trend\` — period-over-period changes\n`;
        text += `  \`get_failure_registry\` — what's failing and why\n`;
        text += `  \`get_stable_corridors\` — paths you can trust\n`;
        text += `  \`summarize_my_agent\` — one-call snapshot of everything\n`;
      }

      text += renderDashboardFooter(id, 'overview');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
