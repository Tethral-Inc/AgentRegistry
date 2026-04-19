import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

/**
 * Sample-size confidence tag. Attach to any per-target or per-pair stat
 * that could be misread as authoritative. Keeps raw numbers; annotates
 * interpretation. Thresholds are deliberate: <10 = pre-signal (may vanish
 * next window), 10-29 = directional (real pattern, thin floor), >=30 =
 * significant (ask whether it persists).
 */
function confidence(n: number): string {
  if (n < 10) return `(pre-signal — ${n} samples)`;
  if (n < 30) return `(directional — ${n} samples)`;
  return `(significant — ${n} samples)`;
}

export function getFrictionReportTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_friction_report',
    {
      description: "Query the friction lens of your interaction profile — one of several lenses available (more on the roadmap). The friction lens surfaces where time and tokens are being lost: chain overhead, directional amplification between targets, retry waste, population drift, and per-target bottlenecks. Friction is a continuum, not a verdict — high friction could be infrastructure, a hard task, or a component with elevated anomaly signals. Use it together with anomaly signal notifications to interpret correctly. Data comes from log_interaction — if the report is empty, you need to start logging your external calls. The report defaults to source='agent' (your reported interactions). Pass source='server' for observer-side self-log only, or source='all' to combine both.",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id). Use this if you know your name but not your ID.'),
        scope: z.enum(['session', 'day', 'yesterday', 'week']).optional().default('week').describe('Time window for the report'),
        source: z.enum(['agent', 'server', 'all']).optional().default('agent').describe("Signal source. 'agent' = your log_interaction calls (default, the truth). 'server' = observer-side self-log (MCP tool-call timing). 'all' = both combined."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name, scope, source }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }

      try {
        const params = new URLSearchParams({ scope: scope ?? 'week', source: source ?? 'agent' });
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/friction?${params}`, { headers: getAuthHeaders() });
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Friction report error: ${errText}` }] };
        }
        const data = await res.json();

        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        const s = data.summary;
        displayName = data.name || agent_name || getAgentName() || displayName;

        if (s.total_interactions === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No interactions recorded for ${displayName} (scope "${scope}", source "${source ?? 'agent'}"). Call log_interaction after each external tool call or API request to populate your friction data. If you're only emitting server self-log, pass source='all' or source='server' to see those.`,
            }],
          };
        }

        let text = `Friction Report for ${displayName} (${scope})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Source: ${source ?? 'agent'}\n`;
        text += `Tier: ${data.tier || 'free'}\n\n`;

        // Summary metrics
        text += `── Summary ──\n`;
        text += `  Interactions: ${s.total_interactions}\n`;
        text += `  Total wait: ${(s.total_wait_time_ms / 1000).toFixed(1)}s\n`;
        text += `  Friction: ${s.friction_percentage.toFixed(2)}% of active time\n`;
        text += `  Failures: ${s.total_failures} (${(s.failure_rate * 100).toFixed(1)}% rate)\n`;
        if (s.total_tokens_used) text += `  Tokens used: ${s.total_tokens_used}\n`;
        if (s.wasted_tokens) text += `  Wasted tokens (failed calls): ${s.wasted_tokens}\n`;

        // ── Structural friction FIRST ──
        // These are the composite elements that describe interaction-shape
        // problems: chain overhead, directional amplification, retry
        // overhead, population drift. Per-target bottleneck data comes
        // after — it's descriptive context, not the signal.

        text += '\n── Chain Analysis ──\n';
        if (data.chain_analysis) {
          const ca = data.chain_analysis;
          text += `  Distinct chains: ${ca.chain_count}\n`;
          text += `  Avg chain length: ${ca.avg_chain_length} calls\n`;
          text += `  Total chain overhead: ${(ca.total_chain_overhead_ms / 1000).toFixed(1)}s\n`;
          if (ca.top_patterns && ca.top_patterns.length > 0) {
            text += '  Top patterns:\n';
            for (const p of ca.top_patterns) {
              text += `    ${p.pattern.join(' -> ')} (${p.frequency}x, ${p.avg_overhead_ms}ms avg overhead) ${confidence(p.frequency)}\n`;
            }
          }
        } else {
          text += `  None recorded in this window.\n`;
          text += `  Tip: pass chain_id + chain_position to log_interaction to enable chain analysis.\n`;
        }

        text += '\n── Directional Amplification ──\n';
        if (data.directional_pairs && data.directional_pairs.length > 0) {
          for (const dp of data.directional_pairs) {
            text += `  ${dp.source_target} -> ${dp.destination_target}: ${dp.amplification_factor.toFixed(2)}x amplification`;
            text += ` (${dp.avg_duration_when_preceded}ms after vs ${dp.avg_duration_standalone}ms standalone) ${confidence(dp.sample_count)}\n`;
          }
        } else {
          text += `  None recorded in this window.\n`;
          text += `  Tip: pass preceded_by to log_interaction, or let the correlation window stitch it from chain_id.\n`;
        }

        text += '\n── Retry Overhead ──\n';
        if (data.retry_overhead) {
          const ro = data.retry_overhead;
          text += `  Total retries: ${ro.total_retries}\n`;
          text += `  Wasted time: ${(ro.total_wasted_ms / 1000).toFixed(1)}s\n`;
          for (const t of ro.top_retry_targets) {
            text += `    ${t.target_system_id}: ${t.retry_count} retries, ${(t.wasted_ms / 1000).toFixed(1)}s wasted ${confidence(t.retry_count)}\n`;
          }
        } else {
          text += `  None recorded in this window.\n`;
          text += `  Tip: pass retry_count to log_interaction to surface retry overhead.\n`;
        }

        text += '\n── Population Drift ──\n';
        if (data.population_drift && data.population_drift.targets.length > 0) {
          for (const t of data.population_drift.targets) {
            const sign = t.drift_percentage > 0 ? '+' : '';
            text += `  ${t.target_system_id}: ${sign}${t.drift_percentage}% vs baseline`;
            text += ` (current ${t.current_median_ms}ms, baseline ${t.baseline_median_ms}ms)\n`;
          }
        } else {
          text += `  No baseline-comparable targets in this window.\n`;
        }

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

        // Kind-of-work breakdowns
        if (data.by_activity_class && data.by_activity_class.length > 0) {
          text += `\n── By Activity Class ──\n`;
          for (const a of data.by_activity_class) {
            text += `  ${a.activity_class}: ${a.interaction_count} calls, ${(a.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }
        if (data.by_target_type && data.by_target_type.length > 0) {
          text += `\n── By Target Type ──\n`;
          for (const t of data.by_target_type) {
            text += `  ${t.target_type}: ${t.interaction_count} calls, ${(t.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }
        if (data.by_interaction_purpose && data.by_interaction_purpose.length > 0) {
          text += `\n── By Interaction Purpose ──\n`;
          for (const p of data.by_interaction_purpose) {
            text += `  ${p.interaction_purpose}: ${p.interaction_count} calls, ${(p.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }

        // Per-target detail comes LAST — descriptive context for the
        // structural signals above.
        if (data.top_targets && data.top_targets.length > 0) {
          text += `\n── Per-Target Detail ──\n`;
          for (const t of data.top_targets) {
            const pct = (t.proportion_of_total * 100).toFixed(1);
            const absWaitS = s.total_wait_time_ms > 0
              ? ((t.proportion_of_total * s.total_wait_time_ms) / 1000).toFixed(1)
              : null;
            text += `\n  ${t.target_system_id} (${t.target_system_type}) ${confidence(t.interaction_count)}\n`;
            text += `    ${t.interaction_count} calls | ${pct}% of wait time`;
            if (absWaitS != null) text += ` (${absWaitS}s)`;
            text += `\n`;
            text += `    median ${t.median_duration_ms}ms`;
            if (t.p95_duration_ms != null) text += ` | p95 ${t.p95_duration_ms}ms`;
            text += `\n`;

            if (t.failure_count > 0 && t.median_duration_ms != null) {
              const wastedMs = t.failure_count * t.median_duration_ms;
              text += `    ${t.failure_count} failures = ${(wastedMs / 1000).toFixed(1)}s wasted\n`;
            }
            if (t.wasted_tokens) {
              text += `    wasted tokens (failed calls): ${t.wasted_tokens}\n`;
            }

            if (t.status_breakdown) {
              const statuses = Object.entries(t.status_breakdown as Record<string, number>)
                .map(([k, c]) => `${k}: ${c}`)
                .join(', ');
              text += `    statuses: ${statuses}\n`;
            }

            if (t.vs_baseline != null) {
              text += `    ratio to population baseline: ${t.vs_baseline.toFixed(2)}`;
              if (t.baseline_median_ms != null) text += ` (baseline median ${t.baseline_median_ms}ms, p95 ${t.baseline_p95_ms}ms)`;
              if (t.volatility != null) text += `, volatility ${t.volatility}`;
              text += `\n`;
            }

            if (t.recent_anomalies && t.recent_anomalies.length > 0) {
              text += `    recent anomalies:\n`;
              for (const a of t.recent_anomalies) {
                text += `      [${a.timestamp}] ${a.category || 'unknown'}`;
                if (a.detail) text += ` — ${a.detail}`;
                text += `\n`;
              }
            }

            if (t.percentile_rank !== undefined) {
              text += `    faster than ${t.percentile_rank}% of agents on this target\n`;
            }

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

        // Transport + source breakdowns (context on how the agent is talking)
        if (data.by_transport && data.by_transport.length > 0) {
          text += `\n── By Transport ──\n`;
          for (const t of data.by_transport) {
            text += `  ${t.transport}: ${t.interaction_count} calls, ${(t.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }
        if (data.by_source && data.by_source.length > 0) {
          text += `\n── By Source ──\n`;
          for (const bs of data.by_source) {
            text += `  ${bs.source}: ${bs.interaction_count} interactions\n`;
          }
        }

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
