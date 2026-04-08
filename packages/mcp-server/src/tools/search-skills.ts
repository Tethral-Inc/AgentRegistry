import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function searchSkillsTool(server: McpServer, apiUrl: string) {
  server.tool(
    'search_skills',
    'Search the ACR skill catalog by name, description, or capability. Returns matching skills with threat status, version info, and descriptions. Use this to discover skills before installing them.',
    {
      query: z.string().min(1).max(200).describe('Search text (skill name, keyword, or capability)'),
      source: z.string().optional().describe('Filter by source (clawhub, github, npm)'),
      category: z.string().optional().describe('Filter by category'),
      threat_level: z.enum(['none', 'low', 'medium', 'high', 'critical']).optional().describe('Filter by threat level'),
      limit: z.number().min(1).max(50).optional().default(10).describe('Max results to return'),
    },
    async ({ query: searchQuery, source, category, threat_level, limit }) => {
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (source) params.set('source', source);
        if (category) params.set('category', category);
        if (threat_level) params.set('threat_level', threat_level);
        if (limit) params.set('limit', String(limit));

        const res = await fetch(`${apiUrl}/api/v1/skill-catalog/search?${params}`);
        const data = await res.json() as {
          skills: Array<{
            skill_name: string;
            skill_source: string;
            description: string | null;
            version: string | null;
            author: string | null;
            category: string | null;
            tags: string[];
            threat_level: string | null;
            agent_count: number | null;
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
          const threat = skill.threat_level && skill.threat_level !== 'none'
            ? ` [${skill.threat_level.toUpperCase()}]`
            : '';
          const agents = skill.agent_count != null ? ` | ${skill.agent_count} agents` : '';
          const ver = skill.version ? ` v${skill.version}` : '';

          text += `\n  ${skill.skill_name}${ver} (${skill.skill_source})${threat}${agents}`;
          if (skill.description) text += `\n    ${skill.description}`;
          if (skill.category) text += `\n    Category: ${skill.category}`;
          if (skill.tags.length > 0) text += `\n    Tags: ${skill.tags.join(', ')}`;
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
