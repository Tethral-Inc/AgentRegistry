import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function getSkillVersionsTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.tool(
    'get_skill_versions',
    'Get version history for a skill. Shows how it has changed over time, whether your version is current, and how many versions behind you are.',
    {
      skill_hash: z.string().describe('The skill hash to look up version history for'),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ skill_hash }) => {
      try {
        // First look up the skill via resolver to get catalog data
        const skillRes = await fetch(`${resolverUrl}/v1/skill/${skill_hash}`);
        const skillData = await skillRes.json() as {
          found: boolean;
          skill_name?: string;
          skill_source?: string;
          version?: string;
          is_current_version?: boolean;
          current_hash?: string;
          versions_behind?: number;
          description?: string;
        };

        if (!skillData.found) {
          return {
            content: [{
              type: 'text' as const,
              text: `Skill hash ${skill_hash.slice(0, 16)}... not found in the network.`,
            }],
          };
        }

        let text = `Skill: ${skillData.skill_name ?? 'Unknown'}`;
        if (skillData.skill_source) text += ` (${skillData.skill_source})`;
        text += '\n';

        if (skillData.version) text += `Version: ${skillData.version}\n`;
        if (skillData.description) text += `Description: ${skillData.description}\n`;

        if (skillData.is_current_version === false) {
          text += `\nOUTDATED: You are ${skillData.versions_behind ?? '?'} version(s) behind.`;
          if (skillData.current_hash) {
            text += `\nCurrent hash: ${skillData.current_hash.slice(0, 16)}...`;
          }
          text += '\nConsider updating to the latest version.';
        } else if (skillData.is_current_version === true) {
          text += '\nYou have the latest version.';
        }

        // Try to get full version history from the catalog API
        // We need the skill_id, which we can get by searching
        if (skillData.skill_name) {
          try {
            const searchRes = await fetch(
              `${apiUrl}/api/v1/skill-catalog/search?q=${encodeURIComponent(skillData.skill_name)}&limit=1`,
            );
            const searchData = await searchRes.json() as {
              skills: Array<{ skill_id: string }>;
            };

            if (searchData.skills.length > 0) {
              const versionsRes = await fetch(
                `${apiUrl}/api/v1/skill-catalog/${searchData.skills[0]!.skill_id}/versions`,
              );
              const versionsData = await versionsRes.json() as {
                versions: Array<{
                  skill_hash: string;
                  version: string | null;
                  change_type: string;
                  detected_at: string;
                  threat_level: string | null;
                }>;
              };

              if (versionsData.versions.length > 0) {
                text += '\n\nVersion History:';
                for (const v of versionsData.versions) {
                  const isCurrent = v.skill_hash === skill_hash ? ' ← YOU' : '';
                  const threat = v.threat_level && v.threat_level !== 'none'
                    ? ` [${v.threat_level.toUpperCase()}]`
                    : '';
                  const ver = v.version ? `v${v.version}` : v.skill_hash.slice(0, 12);
                  const date = v.detected_at.split('T')[0];
                  text += `\n  ${date} | ${ver} (${v.change_type})${threat}${isCurrent}`;
                }
              }
            }
          } catch {
            // Version history is optional enrichment
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Version lookup error: ${msg}` }] };
      }
    },
  );
}
