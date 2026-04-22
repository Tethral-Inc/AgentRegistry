import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { fmtRatio, truncHash } from '../utils/style.js';

export function getSkillTrackerTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_skill_tracker',
    {
      description: 'Track skill adoption and anomaly signal rates across the agent population. Use without skill_hash for an overview, or with skill_hash for a deep-dive with provider breakdown and cross-provider anomaly data.',
      inputSchema: {
        skill_hash: z.string().optional().describe('Specific skill hash for deep-dive view'),
        min_anomaly_signals: z.number().optional().describe('Only show skills with at least this many anomaly signals'),
        sort: z.enum(['agent_count', 'interaction_count', 'anomaly_signal_rate']).optional().default('agent_count').describe('Sort field'),
        limit: z.number().min(1).max(100).optional().default(20).describe('Max skills to show'),
        cursor: z.string().optional().describe('Opaque cursor from a previous response\'s next_cursor. Pass unchanged to fetch the next page.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ skill_hash, min_anomaly_signals, sort, limit, cursor }) => {
      try {
        // Deep-dive mode
        if (skill_hash) {
          const res = await fetchAuthed(`${apiUrl}/api/v1/network/skills/${encodeURIComponent(skill_hash)}`);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { content: [{ type: 'text' as const, text: `Error: ${(data as Record<string, unknown>).message ?? 'Skill not found'}` }] };
          }
          const skill = await res.json() as Record<string, unknown>;
          return { content: [{ type: 'text' as const, text: formatSkillDetail(skill) }] };
        }

        // List mode
        const params = new URLSearchParams();
        if (min_anomaly_signals != null) params.set('min_anomaly_signals', String(min_anomaly_signals));
        if (sort) params.set('sort', sort);
        if (limit) params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);

        const res = await fetchAuthed(`${apiUrl}/api/v1/network/skills?${params}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Skill tracker error: ${errText}` }] };
        }
        const data = await res.json() as { skills: Array<Record<string, unknown>>; next_cursor: string | null };

        if (!data.skills || data.skills.length === 0) {
          // Empty-state branch: give the operator a concrete next step
          // rather than a dead-end "nothing here." The tracker is
          // network-wide — if it's empty, either no agent in the cohort
          // has reported skill usage yet, or the filters excluded
          // everything.
          const filterApplied = min_anomaly_signals != null;
          const text = filterApplied
            ? `No skills match the filter (min_anomaly_signals=${min_anomaly_signals}). Call get_skill_tracker without filters to see every skill the network has observed.`
            : 'No skills tracked yet. The network tracker is populated as agents call log_interaction with skill-level target_system_id. Call log_interaction after every skill invocation to start contributing.';
          return { content: [{ type: 'text' as const, text }] };
        }

        let text = `Skill Tracker\n${'='.repeat(20)}\n\n`;

        for (const s of data.skills) {
          const interactionCount = (s.interaction_count as number) ?? 0;
          text += `${s.skill_name || truncHash(s.skill_hash as string)}\n`;
          text += `  ${s.agent_count} agents | ${interactionCount} interactions`;
          const sigRate = s.anomaly_signal_rate as number;
          if (sigRate > 0) {
            // Confidence is a tag on the denominator (interactions), not
            // on the anomaly count. Rendered next to the denominator so
            // the reader doesn't misread it as "N anomaly samples" —
            // that was AUDIT.md's complaint.
            text += ` | ${s.anomaly_signal_count} anomaly signals — ${fmtRatio(sigRate)} over ${interactionCount} interactions ${confidence(interactionCount)}`;
          }
          text += '\n\n';
        }

        if (data.next_cursor) {
          // Opaque cursor surfaced verbatim so the caller can paginate
          // without guessing at the server's internal sort key shape.
          text += `next_cursor: ${data.next_cursor}\n`;
          text += `More skills available — call get_skill_tracker again with cursor="${data.next_cursor}" to fetch the next page.\n`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Skill tracker error: ${msg}` }] };
      }
    },
  );
}

function formatSkillDetail(skill: Record<string, unknown>): string {
  let text = `Skill: ${skill.skill_name || skill.skill_hash}\n`;
  text += `${'='.repeat(40)}\n`;
  text += `  Hash: ${skill.skill_hash}\n`;
  const interactionCount = (skill.interaction_count as number) ?? 0;
  text += `  Adoption: ${skill.agent_count} agents | ${interactionCount} interactions\n`;

  const sigCount = skill.anomaly_signal_count as number;
  const sigRate = skill.anomaly_signal_rate as number;
  // Confidence tag sits next to the denominator (interaction count) so
  // the reader sees exactly what sample size was used to compute the rate.
  text += `  Anomaly rate: ${fmtRatio(sigRate)} (${sigCount} signals over ${interactionCount} interactions) ${confidence(interactionCount)}\n`;
  text += `  First seen: ${skill.first_seen} | Last updated: ${skill.last_updated}\n`;

  // Provider breakdown
  const providers = skill.provider_breakdown as Array<{ provider_class: string; agent_count: number }> | undefined;
  if (providers && providers.length > 0) {
    text += `\n  By provider:\n`;
    for (const p of providers) {
      text += `    ${p.provider_class}: ${p.agent_count} agents\n`;
    }
  }

  // Cross-provider anomaly data
  const crossProvider = skill.cross_provider_anomalies as Array<{ provider: string; anomaly_count: number }> | undefined;
  if (crossProvider && crossProvider.length > 0) {
    text += `\n  Anomalies by provider (last 7d):\n`;
    for (const cp of crossProvider) {
      text += `    ${cp.provider}: ${cp.anomaly_count} anomalies\n`;
    }
  }

  if (crossProvider && crossProvider.length >= 2) {
    text += `\n  ${crossProvider.length} providers reporting anomalies\n`;
  }

  return text;
}
