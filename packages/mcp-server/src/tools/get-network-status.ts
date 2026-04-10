import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function getNetworkStatusTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_network_status',
    {
      description: 'The COVID-tracker / HIBP view for agent infrastructure. Shows agent and system totals, system health sorted worst-first, active jeopardy flags across observed skills, and recent cross-agent escalations. Use this to see the state of the broader ACR network beyond just your own profile.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/network/status`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Network status error: ${errText}` }] };
        }
        const data = await res.json();

        const t = data.totals ?? {};
        let text = `ACR Network Dashboard\n${'='.repeat(30)}\n`;

        if (data.stale) {
          text += `\nDATA MAY BE STALE — background jobs may not have run recently.\n`;
        }

        // Totals
        text += `\n-- Totals (24h) --\n`;
        text += `  Active agents: ${t.active_agents ?? 0}`;
        text += ` | Systems: ${t.active_systems ?? 0}`;
        text += ` | Interactions: ${(t.interactions_24h ?? 0).toLocaleString()}\n`;
        const anomalyPct = ((t.anomaly_rate_24h ?? 0) * 100).toFixed(1);
        text += `  Anomaly rate: ${anomalyPct}%\n`;

        // Systems
        const systems = data.systems ?? [];
        if (systems.length > 0) {
          text += `\n-- Systems (${systems.length}, worst-first) --\n`;
          for (const s of systems.slice(0, 20)) {
            const badge = `[${(s.health_status ?? 'unknown').toUpperCase()}]`;
            text += `  ${badge} ${s.system_id}`;
            text += ` — ${s.agent_count ?? 0} agents`;
            if (s.failure_rate > 0) text += `, ${(s.failure_rate * 100).toFixed(1)}% failure`;
            if (s.anomaly_rate > 0) text += `, ${(s.anomaly_rate * 100).toFixed(1)}% anomaly`;
            if (s.median_duration_ms != null) text += `, ${s.median_duration_ms}ms median`;
            text += '\n';
          }
          if (systems.length > 20) {
            text += `  ... and ${systems.length - 20} more systems\n`;
          }
        } else {
          text += `\n-- Systems --\n  No system health data available.\n`;
        }

        // Threats
        const threats = data.threats ?? [];
        if (threats.length > 0) {
          text += `\n-- Active Threats (${threats.length}) --\n`;
          for (const th of threats) {
            text += `  [${th.threat_level.toUpperCase()}] ${th.skill_name || th.skill_hash.substring(0, 16) + '...'}`;
            text += ` — ${th.anomaly_signal_count} signals, ${th.agent_count} agents`;
            text += '\n';
          }
        } else {
          text += `\n-- Active Threats --\n  No active threats detected.\n`;
        }

        // Escalations
        const escalations = data.recent_escalations ?? [];
        if (escalations.length > 0) {
          text += `\n-- Recent Escalations (${escalations.length}) --\n`;
          for (const e of escalations) {
            text += `  ${e.target} — ${e.agents_affected} agents`;
            if (e.providers_affected?.length > 0) {
              text += `, ${e.providers_affected.length} providers [${e.providers_affected.join(', ')}]`;
            }
            text += '\n';
            if (e.anomaly_categories?.length > 0) {
              text += `    Categories: ${e.anomaly_categories.join(', ')}\n`;
            }
            text += `    Detected: ${e.detected_at}\n`;
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Network status error: ${msg}` }] };
      }
    },
  );
}
