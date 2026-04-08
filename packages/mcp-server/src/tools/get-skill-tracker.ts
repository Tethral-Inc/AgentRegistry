import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function getSkillTrackerTool(server: McpServer, apiUrl: string) {
  server.tool(
    'get_skill_tracker',
    'Track skill adoption, anomaly rates, and threat levels across the agent population. Use without skill_hash for an overview, or with skill_hash for a deep-dive with provider breakdown and cross-provider correlation data.',
    {
      skill_hash: z.string().optional().describe('Specific skill hash for deep-dive view'),
      threat_level: z.string().optional().describe('Filter by threat level (none, low, medium, high, critical)'),
      sort: z.enum(['agent_count', 'interaction_count', 'anomaly_signal_rate', 'threat_level']).optional().default('agent_count').describe('Sort field'),
      limit: z.number().min(1).max(100).optional().default(20).describe('Max skills to show'),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ skill_hash, threat_level, sort, limit }) => {
      try {
        // Deep-dive mode
        if (skill_hash) {
          const res = await fetch(`${apiUrl}/api/v1/network/skills/${encodeURIComponent(skill_hash)}`);
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { content: [{ type: 'text' as const, text: `Error: ${(data as Record<string, unknown>).message ?? 'Skill not found'}` }] };
          }
          const skill = await res.json() as Record<string, unknown>;
          return { content: [{ type: 'text' as const, text: formatSkillDetail(skill) }] };
        }

        // List mode
        const params = new URLSearchParams();
        if (threat_level) params.set('threat_level', threat_level);
        if (sort) params.set('sort', sort);
        if (limit) params.set('limit', String(limit));

        const res = await fetch(`${apiUrl}/api/v1/network/skills?${params}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Skill tracker error: ${errText}` }] };
        }
        const data = await res.json() as { skills: Array<Record<string, unknown>>; next_cursor: string | null };

        if (!data.skills || data.skills.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No skills tracked yet.' }] };
        }

        let text = `Skill Tracker\n${'='.repeat(20)}\n\n`;

        for (const s of data.skills) {
          const threatBadge = s.threat_level !== 'none' ? ` — ${(s.threat_level as string).toUpperCase()}` : '';
          text += `${s.skill_name || (s.skill_hash as string).substring(0, 16) + '...'}${threatBadge}\n`;
          text += `  ${s.agent_count} agents | ${s.interaction_count} interactions`;
          const sigRate = s.anomaly_signal_rate as number;
          if (sigRate > 0) {
            text += ` | ${s.anomaly_signal_count} anomaly signals (${(sigRate * 100).toFixed(2)}%)`;
          }
          text += '\n\n';
        }

        if (data.next_cursor) {
          text += `... more skills available. Use filters or cursor to paginate.\n`;
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
  text += `  Threat level: ${(skill.threat_level as string).toUpperCase()}\n`;
  text += `  Adoption: ${skill.agent_count} agents | ${skill.interaction_count} interactions\n`;

  const sigCount = skill.anomaly_signal_count as number;
  const sigRate = skill.anomaly_signal_rate as number;
  text += `  Anomaly rate: ${(sigRate * 100).toFixed(2)}% (${sigCount} signals)\n`;
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

  const correlated = skill.cross_provider_correlation as boolean;
  if (correlated) {
    text += `\n  Cross-provider correlation: YES (${crossProvider?.length ?? 0} providers reporting anomalies)\n`;
  }

  return text;
}
