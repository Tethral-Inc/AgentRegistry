import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function checkEnvironmentTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.tool(
    'check_environment',
    'Check the current ACR network environment: active threats and system health. Call on startup or when assessing risk.',
    {},
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
          text += `\nActive Threats: ${threats.length}\n`;
          for (const t of threats) {
            text += `- [${t.threat_level.toUpperCase()}] ${t.skill_name || t.skill_hash.substring(0, 16) + '...'} (${t.anomaly_signal_count} signals)\n`;
          }
        } else {
          text += '\nNo active threats detected.';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Environment check error: ${msg}` }] };
      }
    },
  );
}
