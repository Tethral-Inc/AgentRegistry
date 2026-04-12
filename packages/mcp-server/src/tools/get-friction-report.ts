import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

/**
 * Resolve an agent name to an agent_id via the lookup endpoint.
 */
async function resolveAgentId(nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('acr_') || nameOrId.startsWith('pseudo_')) {
    return nameOrId;
  }
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(nameOrId)}`);
  if (!res.ok) {
    throw new Error(`Agent "${nameOrId}" not found`);
  }
  const data = await res.json() as { agent_id: string };
  return data.agent_id;
}

export function getFrictionReportTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_friction_report',
    {
      description: "Query the friction lens of your interaction profile — one of several lenses available (more on the roadmap). The friction lens surfaces where time and tokens are being lost: bottleneck targets, chain overhead, retry waste, directional friction between targets, and how you compare to the population baseline. Friction is a continuum, not a verdict — high friction could be infrastructure, a hard task, or a component with elevated anomaly signals. Use it together with anomaly signal notifications to interpret correctly. Data comes from log_interaction — if the report is empty, you need to start logging your external calls.",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id). Use this if you know your name but not your ID.'),
        scope: z.enum(['session', 'day', 'week']).optional().default('day').describe('Time window for the report'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name, scope }) => {
      let id: string;
      try {
        if (agent_name) {
          id = await resolveAgentId(agent_name);
        } else {
          id = agent_id || getAgentId() || await ensureRegistered();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }

      try {
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=${scope}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Friction report error: ${errText}` }] };
        }
        const data = await res.json();

        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        const s = data.summary;
        const displayName = data.name || agent_name || getAgentName() || id;

        if (s.total_interactions === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No interactions recorded for ${displayName} (scope "${scope}"). Call log_interaction after each external tool call or API request to populate your friction data.`,
            }],
          };
        }

        let text = `Friction Report for ${displayName} (${scope})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Tier: ${data.tier || 'free'}\n\n`;

        // Summary metrics
        text += `── Summary ──\n`;
        text += `  Interactions: ${s.total_interactions}\n`;
        text += `  Total wait: ${(s.total_wait_time_ms / 1000).toFixed(1)}s\n`;
        text += `  Friction: ${s.friction_percentage.toFixed(2)}% of active time\n`;
        text += `  Failures: ${s.total_failures} (${(s.failure_rate * 100).toFixed(1)}% rate)\n`;

        // Category breakdown
        if (data.by_category && data.by_category.length > 0) {
          text += `\n── By Category ──\n`;
          for (const cat of data.by_category) {
            const avgMs = cat.interaction_count > 0 ? Math.round(cat.total_duration_ms / cat.interaction_count) : 0;
            text += `  ${cat.category}: ${cat.interaction_count} calls, ${(cat.total_duration_ms / 1000).toFixed(1)}s total, avg ${avgMs}ms`;
            if (cat.failure_count > 0) text += `, ${cat.failure_count} failures`;
            text += `\n`;
          }
        }

        // Top targets with full metrics
        if (data.top_targets && data.top_targets.length > 0) {
          text += `\n── Top Targets ──\n`;
          for (const t of data.top_targets) {
            const pct = (t.proportion_of_total * 100).toFixed(1);
            text += `\n  ${t.target_system_id} (${t.target_system_type})\n`;
            text += `    ${t.interaction_count} calls | ${pct}% of wait time\n`;
            text += `    median ${t.median_duration_ms}ms`;
            if (t.p95_duration_ms != null) text += ` | p95 ${t.p95_duration_ms}ms`;
            text += `\n`;

            // Status breakdown
            if (t.status_breakdown) {
              const statuses = Object.entries(t.status_breakdown as Record<string, number>)
                .map(([s, c]) => `${s}: ${c}`)
                .join(', ');
              text += `    statuses: ${statuses}\n`;
            }

            // Baseline comparison (paid tier) — raw numbers only.
            if (t.vs_baseline != null) {
              text += `    ratio to population baseline: ${t.vs_baseline.toFixed(2)}`;
              if (t.baseline_median_ms != null) text += ` (baseline median ${t.baseline_median_ms}ms, p95 ${t.baseline_p95_ms}ms)`;
              if (t.volatility != null) text += `, volatility ${t.volatility}`;
              text += `\n`;
            }

            // Recent anomalies
            if (t.recent_anomalies && t.recent_anomalies.length > 0) {
              text += `    recent anomalies:\n`;
              for (const a of t.recent_anomalies) {
                text += `      [${a.timestamp}] ${a.category || 'unknown'}`;
                if (a.detail) text += ` — ${a.detail}`;
                text += `\n`;
              }
            }

            if (t.failure_count > 0 && !t.recent_anomalies?.length) {
              text += `    ${t.failure_count} failures\n`;
            }

            // Network context — raw rates across the population. No
            // synthetic health_status label (the inherited column is
            // ignored here; see inherited-drift note in
            // proposals/open-items-plan.md).
            if (
              t.network_failure_rate != null ||
              t.network_anomaly_rate != null ||
              t.network_agent_count != null
            ) {
              text += `    population: ${t.network_agent_count ?? 0} agents`;
              text += `, failure rate ${((t.network_failure_rate ?? 0) * 100).toFixed(1)}%`;
              text += `, anomaly rate ${((t.network_anomaly_rate ?? 0) * 100).toFixed(1)}%\n`;
            }
          }
        }

        // Transport breakdown
        if (data.by_transport && data.by_transport.length > 0) {
          text += `\n── By Transport ──\n`;
          for (const t of data.by_transport) {
            text += `  ${t.transport}: ${t.interaction_count} calls, ${(t.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }

        // Source breakdown (server self-logs vs agent-initiated)
        if (data.by_source && data.by_source.length > 0) {
          text += `\n── By Source ──\n`;
          for (const s of data.by_source) {
            text += `  ${s.source}: ${s.interaction_count} interactions\n`;
          }
        }

        // Chain Analysis
        if (data.chain_analysis) {
          const ca = data.chain_analysis;
          text += '\n── Chain Analysis ──\n';
          text += `  Distinct chains: ${ca.chain_count}\n`;
          text += `  Avg chain length: ${ca.avg_chain_length} calls\n`;
          text += `  Total chain overhead: ${(ca.total_chain_overhead_ms / 1000).toFixed(1)}s\n`;
          if (ca.top_patterns && ca.top_patterns.length > 0) {
            text += '  Top patterns:\n';
            for (const p of ca.top_patterns) {
              text += `    ${p.pattern.join(' -> ')} (${p.frequency}x, ${p.avg_overhead_ms}ms avg overhead)\n`;
            }
          }
        }

        // Directional Analysis (pro) — raw amplification factor, no
        // SLOWS/SPEEDS/~ label. Client reads the factor.
        if (data.directional_pairs && data.directional_pairs.length > 0) {
          text += '\n── Directional Analysis ──\n';
          for (const dp of data.directional_pairs) {
            text += `  ${dp.source_target} -> ${dp.destination_target}: amplification ${dp.amplification_factor.toFixed(2)}x`;
            text += ` (${dp.avg_duration_when_preceded}ms after vs ${dp.avg_duration_standalone}ms standalone)`;
            text += ` [${dp.sample_count} samples]\n`;
          }
        }

        // Retry Overhead (pro)
        if (data.retry_overhead) {
          const ro = data.retry_overhead;
          text += '\n── Retry Overhead ──\n';
          text += `  Total retries: ${ro.total_retries}\n`;
          text += `  Wasted time: ${(ro.total_wasted_ms / 1000).toFixed(1)}s\n`;
          for (const t of ro.top_retry_targets) {
            text += `    ${t.target_system_id}: ${t.retry_count} retries, ${t.wasted_ms}ms wasted\n`;
          }
        }

        // Population Drift (pro) — raw drift percentage, no
        // DEGRADING/IMPROVING/stable label.
        if (data.population_drift && data.population_drift.targets.length > 0) {
          text += '\n── Population Drift ──\n';
          for (const t of data.population_drift.targets) {
            const sign = t.drift_percentage > 0 ? '+' : '';
            text += `  ${t.target_system_id}: ${sign}${t.drift_percentage}% vs baseline`;
            text += ` (current ${t.current_median_ms}ms, baseline ${t.baseline_median_ms}ms)\n`;
          }
        }

        // Population comparison (paid tier)
        if (data.population_comparison) {
          text += `\n── Population ──\n`;
          text += `  ${data.population_comparison.total_agents_in_period} agents active in period\n`;
          text += `  ${data.population_comparison.baselines_available} baselines available\n`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Friction report error: ${msg}` }] };
      }
    },
  );
}
