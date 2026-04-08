import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function checkEntityTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.tool(
    'check_entity',
    'Check if a skill hash, agent, or system is known to the ACR network. Use before installing skills to verify safety. This is a read-only lookup — no data is sent to ACR.',
    {
      entity_type: z.enum(['skill', 'agent', 'system']).describe('Type of entity to look up'),
      entity_id: z.string().describe('The entity identifier: skill SHA-256 hash, agent_id, or system_id'),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ entity_type, entity_id }) => {
      try {
        let url: string;
        switch (entity_type) {
          case 'skill':
            url = `${resolverUrl}/v1/skill/${entity_id}`;
            break;
          case 'agent':
            url = `${resolverUrl}/v1/agent/${entity_id}`;
            break;
          case 'system':
            url = `${resolverUrl}/v1/system/${encodeURIComponent(entity_id)}/health`;
            break;
        }

        const res = await fetch(url);
        const data = await res.json();

        if (entity_type === 'skill') {
          if (!data.found) {
            // Try to find similar skills via catalog search
            let similarText = '';
            try {
              const searchRes = await fetch(`${apiUrl}/api/v1/skill-catalog/search?q=${encodeURIComponent(entity_id.slice(0, 16))}&limit=3`);
              if (searchRes.ok) {
                const searchData = await searchRes.json() as { skills: Array<{ skill_name: string; skill_source: string; description?: string }> };
                if (searchData.skills.length > 0) {
                  similarText = '\n\nSimilar skills in the catalog:';
                  for (const s of searchData.skills) {
                    similarText += `\n  - ${s.skill_name} (${s.skill_source})`;
                    if (s.description) similarText += `: ${s.description.slice(0, 80)}`;
                  }
                }
              }
            } catch { /* non-blocking */ }

            return {
              content: [{
                type: 'text' as const,
                text: `Unknown skill. This hash has not been seen in the ACR network. Exercise caution with unfamiliar skills.${similarText}`,
              }],
            };
          }

          // ── BLOCKED SKILL: Content scan detected threats ──
          if (data.blocked) {
            let text = `BLOCKED SKILL — DO NOT INSTALL\n`;
            text += `════════════════════════════════════════\n`;
            if (data.skill_name) text += `Name: ${data.skill_name}\n`;
            text += `Threat Level: ${(data.threat_level ?? 'unknown').toUpperCase()}\n`;
            text += `Security Score: ${data.scan_score ?? 0}/100\n`;
            if (data.blocked_reason) text += `\nReason: ${data.blocked_reason}\n`;
            if (data.threat_patterns && data.threat_patterns.length > 0) {
              text += `\nDetected Threat Patterns:\n`;
              for (const p of data.threat_patterns) {
                text += `  - ${p}\n`;
              }
            }
            text += `\nThis skill has been flagged by ACR's content security scanner `;
            text += `and is BLOCKED from installation. The skill content is not `;
            text += `available for download, copy, or viewing.\n`;
            text += `\nIf you currently have this skill installed, you should `;
            text += `consider uninstalling it and notifying your user.\n`;
            text += `\nTo request a review or dispute this block, `;
            text += `contact security@tethral.com with hash: ${entity_id}`;

            return { content: [{ type: 'text' as const, text }] };
          }

          // ── Normal skill response ──
          const level = (data.threat_level ?? 'none').toUpperCase();
          let text = `Skill found.\n\nThreat Level: ${level}`;
          if (data.skill_name) text += `\nName: ${data.skill_name}`;
          if (data.description) text += `\nDescription: ${data.description}`;
          if (data.version) text += `\nVersion: ${data.version}`;
          if (data.author) text += `\nAuthor: ${data.author}`;
          if (data.category) text += `\nCategory: ${data.category}`;
          if (data.tags && data.tags.length > 0) text += `\nTags: ${data.tags.join(', ')}`;
          if (data.agent_count != null) text += `\nAgents using: ${data.agent_count}`;
          if (data.interaction_count != null) text += `\nInteractions: ${data.interaction_count}`;
          if (data.anomaly_rate != null) text += `\nAnomaly rate: ${(data.anomaly_rate * 100).toFixed(1)}%`;

          if (data.scan_score != null) text += `\nSecurity Score: ${data.scan_score}/100`;
          if (data.threat_patterns && data.threat_patterns.length > 0) {
            text += `\nSecurity Findings: ${data.threat_patterns.join(', ')}`;
          }

          // Version freshness check
          if (data.is_current_version === false) {
            text += `\n\nOUTDATED: You are ${data.versions_behind ?? '?'} version(s) behind.`;
            if (data.current_hash) text += ` Current hash: ${data.current_hash.slice(0, 16)}...`;
            text += '\nConsider updating to the latest version.';
          } else if (data.is_current_version === true) {
            text += '\n\nThis is the latest version.';
          }

          if (data.threat_level === 'high' || data.threat_level === 'critical') {
            text += `\n\nWARNING: This skill has been flagged. Do not install without explicit user confirmation.`;
          } else if (data.threat_level === 'medium') {
            text += `\n\nCaution: Elevated anomaly signals. Proceed only if the user confirms.`;
          }

          return { content: [{ type: 'text' as const, text }] };
        }

        if (entity_type === 'agent') {
          if (!data.found) {
            return { content: [{ type: 'text' as const, text: `Agent ${entity_id} not found in the network.` }] };
          }
          return {
            content: [{
              type: 'text' as const,
              text: `Agent found.\n\nStatus: ${data.status}\nProvider: ${data.provider_class}\nRegistered: ${data.registered}\nLast active: ${data.last_active}`,
            }],
          };
        }

        // system
        if (!data.found) {
          return { content: [{ type: 'text' as const, text: `System ${entity_id} not found.` }] };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `System found.\n\nHealth: ${data.health_status}\nType: ${data.system_type}\nTotal interactions: ${data.total_interactions}\nDistinct agents: ${data.distinct_agents}\nAnomaly rate: ${((data.anomaly_rate ?? 0) * 100).toFixed(1)}%`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Lookup error: ${msg}` }] };
      }
    },
  );
}
