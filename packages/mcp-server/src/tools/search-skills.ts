import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function searchSkillsTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'search_skills',
    {
      description: 'Search the ACR skill catalog by name, description, or capability. Returns matching skills with threat status, version info, and descriptions. Use this to discover skills before installing them.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Search text (skill name, keyword, or capability)'),
        source: z.string().optional().describe('Filter by source (clawhub, github, npm)'),
        category: z.string().optional().describe('Filter by category'),
        threat_level: z.enum(['none', 'low', 'medium', 'high', 'critical']).optional().describe('Filter by threat level'),
        limit: z.number().min(1).max(50).optional().default(10).describe('Max results to return'),
        min_scan_score: z.number().min(0).max(100).optional().describe('Minimum security scan score (0-100)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
    async ({ query: searchQuery, source, category, threat_level, limit, min_scan_score }) => {
      try {
        const params = new URLSearchParams({ q: searchQuery });
        if (source) params.set('source', source);
        if (category) params.set('category', category);
        if (threat_level) params.set('threat_level', threat_level);
        if (limit) params.set('limit', String(limit));
        if (min_scan_score != null) params.set('min_scan_score', String(min_scan_score));

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
            scan_score: number | null;
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
          if (skill.scan_score != null) text += `\n    Security Score: ${skill.scan_score}/100`;
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
