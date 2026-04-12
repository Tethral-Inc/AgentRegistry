import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function checkEntityTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.registerTool(
    'check_entity',
    {
      description: 'Ask the ACR network what it knows about a specific skill hash, agent, or system. Returns the raw behavioral signals ACR has observed: interaction counts, failure and anomaly rates, agent adoption counts, and related metadata. This is NOT a security check — ACR does not evaluate, score, or test. It only records what has been observed and surfaces the raw counts. Read-only lookup; no data is sent to ACR.',
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
                text: `Unknown skill. This hash has not been observed by the ACR network.${similarText}`,
              }],
            };
          }

          // Skill signals — raw observed data from the network. No
          // synthetic threat level label, no "FLAGGED BY ACR" verdict.
          // The MCP reports what the network has seen; the operator
          // decides what to do with it.
          let text = `Skill found: ${data.skill_hash?.slice(0, 16) ?? entity_id.slice(0, 16)}...\n`;
          if (data.skill_name) text += `Name: ${data.skill_name}\n`;
          if (data.description) text += `Description: ${data.description}\n`;
          if (data.version) text += `Version: ${data.version}\n`;
          if (data.author) text += `Author: ${data.author}\n`;
          if (data.category) text += `Category: ${data.category}\n`;
          if (data.tags && data.tags.length > 0) text += `Tags: ${data.tags.join(', ')}\n`;

          text += `\n── Network signals ──\n`;
          if (data.agent_count != null) text += `  Agents observed using this skill: ${data.agent_count}\n`;
          if (data.interaction_count != null) text += `  Total interactions observed: ${data.interaction_count}\n`;
          if (data.anomaly_signal_count != null) text += `  Anomaly signals reported: ${data.anomaly_signal_count}\n`;
          if (data.anomaly_rate != null) text += `  Anomaly rate: ${(data.anomaly_rate * 100).toFixed(1)}%\n`;

          // Signal categories observed — these are descriptive tags of
          // what kinds of anomaly patterns the network has seen, not
          // severity labels.
          if (data.threat_patterns && Array.isArray(data.threat_patterns) && data.threat_patterns.length > 0) {
            text += `  Anomaly pattern categories: ${data.threat_patterns.join(', ')}\n`;
          }

          // Scan signals — if the content scanner observed something,
          // the scanner's raw findings (which patterns it matched) are
          // reported here. No pass/fail verdict.
          if (data.scan_score != null) text += `  Content scanner score (external): ${data.scan_score}\n`;

          // Version freshness — raw comparison, no advice.
          if (data.is_current_version === false) {
            text += `\n── Version ──\n`;
            text += `  This version is ${data.versions_behind ?? '?'} behind the latest observed version.`;
            if (data.current_hash) text += ` Latest hash: ${data.current_hash.slice(0, 16)}...`;
            text += '\n';
          } else if (data.is_current_version === true) {
            text += `\n── Version ──\n  This is the latest version observed by the network.\n`;
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
        // Raw network signals for the target system. No synthetic
        // health_status label — client reads the rates and decides.
        let sysText = `System found: ${entity_id}\n`;
        sysText += `Type: ${data.system_type}\n\n`;
        sysText += `── Network signals ──\n`;
        sysText += `  Total interactions observed: ${data.total_interactions ?? 0}\n`;
        sysText += `  Distinct agents using this system: ${data.distinct_agents ?? 0}\n`;
        sysText += `  Failure rate: ${((data.failure_rate ?? 0) * 100).toFixed(1)}%\n`;
        sysText += `  Anomaly rate: ${((data.anomaly_rate ?? 0) * 100).toFixed(1)}%\n`;
        if (data.median_duration_ms != null) sysText += `  Median duration: ${data.median_duration_ms}ms\n`;
        if (data.p95_duration_ms != null) sysText += `  p95 duration: ${data.p95_duration_ms}ms\n`;
        return {
          content: [{
            type: 'text' as const,
            text: sysText,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Lookup error: ${msg}` }] };
      }
    },
  );
}
