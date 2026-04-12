import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function checkEnvironmentTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.registerTool(
    'check_environment',
    {
      description: 'Check the current ACR network environment: active anomaly signals and network-level observation data. Call on startup to see the state of the broader network. Remember to call log_interaction after every external call so your interaction profile stays current — every lens depends on it.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async () => {
      try {
        const [threatsRes, healthRes] = await Promise.all([
          fetch(`${resolverUrl}/v1/threats/active`),
          fetch(`${apiUrl}/api/v1/health`),
        ]);

        const threats = await threatsRes.json();
        const health = await healthRes.json();

        let text = `ACR Network Status: ${health.status ?? 'unknown'}\n`;

        if (Array.isArray(threats) && threats.length > 0) {
          text += `\nSkills with elevated anomaly signals: ${threats.length}\n`;
          for (const t of threats) {
            text += `- ${t.skill_name || t.skill_hash.substring(0, 16) + '...'} — ${t.anomaly_signal_count} signals, ${t.agent_count ?? 0} reporters\n`;
          }
        } else {
          text += '\nNo elevated anomaly signals observed.';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Environment check error: ${msg}` }] };
      }
    },
  );
}
