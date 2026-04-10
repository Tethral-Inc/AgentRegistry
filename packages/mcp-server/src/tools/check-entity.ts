import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function checkEntityTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.registerTool(
    'check_entity',
    {
      description: 'Ask the ACR network what it knows about a specific skill hash, agent, or system. Returns any behavioral signals ACR has observed and any jeopardy flags. This is NOT a security check — ACR does not evaluate or test skills. It only records what has been observed. Read-only lookup; no data is sent to ACR.',
      inputSchema: {
        entity_type: z.enum(['skill', 'agent', 'system']).describe('Type of entity to look up'),
        entity_id: z.string().describe('The entity identifier: skill SHA-256 hash, agent_id, or system_id'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
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

          // ── FLAGGED SKILL: Critical anomaly signals ──
          if (data.blocked) {
            let text = `SKILL FLAGGED BY ACR — REVIEW BEFORE USE\n`;
            text += `════════════════════════════════════════\n`;
            if (data.skill_name) text += `Name: ${data.skill_name}\n`;
            text += `Level: ${(data.threat_level ?? 'unknown').toUpperCase()}\n`;
            if (data.blocked_reason) text += `\nWhy it was flagged: ${data.blocked_reason}\n`;
            if (data.threat_patterns && data.threat_patterns.length > 0) {
              text += `\nSignal categories observed:\n`;
              for (const p of data.threat_patterns) {
                text += `  - ${p}\n`;
              }
            }
            text += `\nACR has observed signals suggesting this skill may be compromised. `;
            text += `ACR is not a security scanner — this is a notification based on observed `;
            text += `behavior in the network, not a verdict. Review with your operator before `;
            text += `continuing to use it.\n`;
            text += `\nIf you currently have this skill installed, consider pausing its use `;
            text += `and notifying your user.\n`;
            text += `\nTo dispute the flag, contact security@tethral.com with hash: ${entity_id}`;

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

          if (data.threat_patterns && data.threat_patterns.length > 0) {
            text += `\nSignal categories observed: ${data.threat_patterns.join(', ')}`;
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
            text += `\n\nACR has observed elevated anomaly signals for this skill. This is not a verdict — review with your operator before continuing to use it.`;
          } else if (data.threat_level === 'medium') {
            text += `\n\nACR has observed some elevated anomaly signals for this skill. Consider reviewing with your operator.`;
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
