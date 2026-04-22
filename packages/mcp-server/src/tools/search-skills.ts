import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchAuthed } from '../utils/fetch-authed.js';

export function searchSkillsTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'search_skills',
    {
      description: 'Search ACR network knowledge about a skill by name, description, or capability. Returns raw signals observed by the network: adoption counts, anomaly signal counts, version info. Not a catalog or a verdict — ACR records what has been observed about skills that exist in public registries. Read-only.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Search text (skill name, keyword, or capability)'),
        source: z.string().optional().describe('Filter by source (clawhub, github, npm)'),
        category: z.string().optional().describe('Filter by category'),
        min_agents: z.number().min(0).optional().describe('Only return skills observed being used by at least N agents'),
        min_anomaly_signals: z.number().min(0).optional().describe('Only return skills with at least N observed anomaly signals'),
        limit: z.number().min(1).max(50).optional().default(10).describe('Max results to return'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
    async ({ query: searchQuery, source, category, min_agents, min_anomaly_signals, limit }) => {
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (source) params.set('source', source);
        if (category) params.set('category', category);
        if (min_agents != null) params.set('min_agents', String(min_agents));
        if (min_anomaly_signals != null) params.set('min_anomaly_signals', String(min_anomaly_signals));
        if (limit) params.set('limit', String(limit));

        const res = await fetchAuthed(`${apiUrl}/api/v1/skill-catalog/search?${params}`);
        const data = await res.json() as {
          skills: Array<{
            skill_name: string;
            skill_source: string;
            description: string | null;
            version: string | null;
            author: string | null;
            category: string | null;
            tags: string[];
            agent_count: number | null;
            interaction_count: number | null;
            anomaly_signal_count: number | null;
            anomaly_signal_rate: number | null;
            current_hash: string | null;
            content_changed_at: string | null;
          }>;
          total: number;
        };

        if (data.skills.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No skills found matching "${searchQuery}".`,
            }],
          };
        }

        let text = `Found ${data.total} skill(s) matching "${searchQuery}":\n`;

        for (const skill of data.skills) {
          const ver = skill.version ? ` v${skill.version}` : '';
          text += `\n  ${skill.skill_name}${ver} (${skill.skill_source})`;
          if (skill.description) text += `\n    ${skill.description}`;
          if (skill.category) text += `\n    Category: ${skill.category}`;
          if (skill.tags.length > 0) text += `\n    Tags: ${skill.tags.join(', ')}`;

          // Raw network signals — no synthetic severity label.
          const signals: string[] = [];
          if (skill.agent_count != null) signals.push(`${skill.agent_count} agents`);
          if (skill.interaction_count != null) signals.push(`${skill.interaction_count} interactions`);
          if (skill.anomaly_signal_count != null && skill.anomaly_signal_count > 0) {
            signals.push(`${skill.anomaly_signal_count} anomaly signals`);
          }
          if (skill.anomaly_signal_rate != null && skill.anomaly_signal_rate > 0) {
            signals.push(`${(skill.anomaly_signal_rate * 100).toFixed(1)}% anomaly rate`);
          }
          if (signals.length > 0) {
            text += `\n    Signals: ${signals.join(', ')}`;
          }

          if (skill.current_hash) text += `\n    Hash: ${skill.current_hash.slice(0, 16)}...`;
          text += '\n';
        }

        if (data.total > data.skills.length) {
          text += `\n... and ${data.total - data.skills.length} more. Increase limit to see more.`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Search error: ${msg}` }] };
      }
    },
  );
}
