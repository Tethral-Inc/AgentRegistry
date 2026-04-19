import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function getNetworkStatusTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_network_status',
    {
      description: "Network-wide observation dashboard. Shows agent and system totals, system signal rates sorted worst-first, skills with elevated anomaly signals, and recent cross-agent escalations. Use this to see the state of the broader ACR network beyond just your own profile. Defaults to source='agent' for the 24h totals so the numbers reflect real agent traffic, not observer self-log.",
      inputSchema: {
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source for 24h totals. 'agent' = log_interaction (default). 'server' = self-log. 'all' = both."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ source }) => {
      try {
        const params = new URLSearchParams({ source: source ?? 'agent' });
        const res = await fetch(`${apiUrl}/api/v1/network/status?${params}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Network status error: ${errText}` }] };
        }
        const data = await res.json();

        const t = data.totals ?? {};
        let text = `ACR Network Dashboard\n${'='.repeat(30)}\n`;
        text += `Source: ${source ?? 'agent'}\n`;

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
            let line = `  ${s.system_id}`;
            line += ` — ${s.agent_count ?? 0} agents`;
            if (s.failure_rate > 0) line += `, ${(s.failure_rate * 100).toFixed(1)}% failure`;
            if (s.anomaly_rate > 0) line += `, ${(s.anomaly_rate * 100).toFixed(1)}% anomaly`;
            if (s.median_duration_ms != null) line += `, ${s.median_duration_ms}ms median`;
            if (s.p95_duration_ms != null) line += `, p95 ${s.p95_duration_ms}ms`;
            if (s.total_interactions != null) line += `, ${s.total_interactions} interactions`;
            text += line + '\n';
          }
          if (systems.length > 20) {
            text += `  ... and ${systems.length - 20} more systems\n`;
          }
        } else {
          text += `\n-- Systems --\n  No system health data available.\n`;
        }

        // Skills with anomaly signals
        const threats = data.threats ?? [];
        if (threats.length > 0) {
          text += `\n-- Skill Anomaly Signals (${threats.length}) --\n`;
          for (const th of threats) {
            text += `  ${th.skill_name || th.skill_hash.substring(0, 16) + '...'}`;
            text += ` — ${th.anomaly_signal_count} signals, ${th.agent_count} reporters`;
            text += '\n';
          }
        } else {
          text += `\n-- Skill Anomaly Signals --\n  No elevated anomaly signals observed.\n`;
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
