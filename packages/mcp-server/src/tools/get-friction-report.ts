import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

export function getFrictionReportTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_friction_report',
    {
      description: "Query the friction lens of your interaction profile — one of several lenses available (more on the roadmap). The friction lens surfaces where time and tokens are being lost: bottleneck targets, chain overhead, retry waste, directional friction between targets, and how you compare to the population baseline. Friction is a continuum, not a verdict — high friction could be infrastructure, a hard task, or a component with elevated anomaly signals. Use it together with anomaly signal notifications to interpret correctly. Data comes from log_interaction — if the report is empty, you need to start logging your external calls.",
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id). Use this if you know your name but not your ID.'),
        scope: z.enum(['session', 'day', 'yesterday', 'week']).optional().default('week').describe('Time window for the report'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name, scope }) => {
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
        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/friction?scope=${scope}`, { headers: getAuthHeaders() });
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
              text: `No interactions recorded for ${displayName} (scope "${scope}"). Call log_interaction after each external tool call or API request to populate your friction data.`,
            }],
          };
        }

        let text = `Friction Report for ${displayName} (${scope})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Tier: ${data.tier || 'free'}\n\n`;

        // Summary metrics (CHANGE 6: add absolute seconds next to total_wait_time_ms)
        text += `── Summary ──\n`;
        text += `  Interactions: ${s.total_interactions}\n`;
        text += `  Total wait: ${(s.total_wait_time_ms / 1000).toFixed(1)}s\n`;
        text += `  Friction: ${s.friction_percentage.toFixed(2)}% of active time\n`;
        text += `  Failures: ${s.total_failures} (${(s.failure_rate * 100).toFixed(1)}% rate)\n`;
        // Token usage: surface total + wasted-on-failure so the operator can
        // see the dollar impact of bad targets, not just the time impact.
        // Rendered whenever the server reports them (agent must supply
        // tokens_used on log_interaction).
        if (typeof s.total_tokens_used === 'number' && s.total_tokens_used > 0) {
          text += `  Tokens used: ${s.total_tokens_used.toLocaleString()}\n`;
        }
        if (typeof s.wasted_tokens === 'number' && s.wasted_tokens > 0) {
          const wastePct = (s.total_tokens_used ?? 0) > 0
            ? ((s.wasted_tokens / s.total_tokens_used) * 100).toFixed(1)
            : null;
          text += `  Wasted tokens (on failed calls): ${s.wasted_tokens.toLocaleString()}`;
          if (wastePct) text += ` (${wastePct}% of total)`;
          text += `\n`;
        }

        // Category breakdown
        if (data.by_category && data.by_category.length > 0) {
          text += `\n── By Category ──\n`;
          for (const cat of data.by_category) {
            const avgMs = cat.interaction_count > 0 ? Math.round(cat.total_duration_ms / cat.interaction_count) : 0;
            text += `  ${cat.category}: ${cat.interaction_count} calls, ${(cat.total_duration_ms / 1000).toFixed(1)}s total, avg ${avgMs}ms`;
            if (cat.failure_count > 0) text += `, ${cat.failure_count} failures`;
            if (cat.median_duration_ms != null) text += ` | median ${cat.median_duration_ms}ms`;
            if (cat.p95_duration_ms != null) text += ` | p95 ${cat.p95_duration_ms}ms`;
            text += `\n`;
          }
        }

        // Top targets with full metrics (CHANGE 6: add absolute seconds for proportion and wasted time)
        if (data.top_targets && data.top_targets.length > 0) {
          text += `\n── Top Targets ──\n`;
          for (const t of data.top_targets) {
            const pct = (t.proportion_of_total * 100).toFixed(1);
            const absWaitS = s.total_wait_time_ms > 0
              ? ((t.proportion_of_total * s.total_wait_time_ms) / 1000).toFixed(1)
              : null;
            text += `\n  ${t.target_system_id} (${t.target_system_type})\n`;
            text += `    ${t.interaction_count} calls | ${pct}% of wait time`;
            if (absWaitS != null) text += ` (${absWaitS}s)`;
            text += `\n`;
            text += `    median ${t.median_duration_ms}ms`;
            if (t.p95_duration_ms != null) text += ` | p95 ${t.p95_duration_ms}ms`;
            text += `\n`;

            // Wasted time from failures (CHANGE 6)
            if (t.failure_count > 0 && t.median_duration_ms != null) {
              const wastedMs = t.failure_count * t.median_duration_ms;
              text += `    ${t.interaction_count} calls, ${t.failure_count} failures = ${(wastedMs / 1000).toFixed(1)}s wasted\n`;
            }

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

            if (t.failure_count > 0 && !t.recent_anomalies?.length && t.median_duration_ms == null) {
              text += `    ${t.failure_count} failures\n`;
            }

            // Percentile rank (free tier)
            if (t.percentile_rank !== undefined) {
              text += `    faster than ${t.percentile_rank}% of agents on this target\n`;
            }

            // Network context — actionable comparison instead of a raw
            // rate dump. We only compare when both samples are big enough
            // to be meaningful:
            //   - this agent has >= 10 interactions with the target
            //   - the network side has >= 3 agents and >= 50 interactions
            // Below those thresholds we surface the network rate without
            // a verdict, so the operator sees the number but isn't misled
            // by a 1-agent "network".
            if (
              t.network_failure_rate != null ||
              t.network_anomaly_rate != null ||
              t.network_agent_count != null
            ) {
              const agentFailRate = t.interaction_count > 0
                ? (t.failure_count / t.interaction_count)
                : null;
              const netFailRate = t.network_failure_rate ?? null;
              const netAgents = t.network_agent_count ?? 0;
              const netInteractions = (t.network_interaction_count as number | undefined) ?? null;
              const enoughLocal = t.interaction_count >= 10;
              const enoughNetwork = netAgents >= 3 && (netInteractions == null || netInteractions >= 50);

              text += `    population: ${netAgents} agents`;
              text += `, network failure rate ${((netFailRate ?? 0) * 100).toFixed(1)}%`;
              text += `, anomaly rate ${((t.network_anomaly_rate ?? 0) * 100).toFixed(1)}%\n`;

              if (agentFailRate != null && netFailRate != null && enoughLocal && enoughNetwork) {
                const yoursPct = agentFailRate * 100;
                const netPct = netFailRate * 100;
                let verdict: string;
                if (netPct < 5 && yoursPct > netPct * 2) {
                  verdict = 'likely your config/network — most agents succeed here';
                } else if (yoursPct > 0 && netPct > yoursPct * 2) {
                  verdict = 'better than the network on this target';
                } else if (netPct >= 20 && yoursPct >= 20) {
                  verdict = 'network-wide issue — this target is failing for many agents';
                } else {
                  verdict = 'consistent with the network';
                }
                text += `    you ${yoursPct.toFixed(1)}% vs network ${netPct.toFixed(1)}% → ${verdict}\n`;
              } else if (!enoughLocal) {
                text += `    (need ≥10 local interactions for a network comparison; you have ${t.interaction_count})\n`;
              } else if (!enoughNetwork) {
                text += `    (not enough network data for a verdict yet)\n`;
              }
            }
          }
        }

        // Transport breakdown
        if (data.by_transport && data.by_transport.length > 0) {
          text += `\n── By Transport ──\n`;
          for (const t of data.by_transport) {
            text += `  ${t.transport}: ${t.interaction_count} calls, ${(t.total_duration_ms / 1000).toFixed(1)}s total`;
            if (t.median_duration_ms != null) text += ` | median ${t.median_duration_ms}ms`;
            if (t.p95_duration_ms != null) text += ` | p95 ${t.p95_duration_ms}ms`;
            text += `\n`;
          }
        }

        // Source breakdown (server self-logs vs agent-initiated)
        if (data.by_source && data.by_source.length > 0) {
          text += `\n── By Source ──\n`;
          for (const s of data.by_source) {
            text += `  ${s.source}: ${s.interaction_count} interactions\n`;
          }
        }

        // Chain Analysis (CHANGE 5: always render header)
        text += '\n── Chain Analysis ──\n';
        if (data.chain_analysis) {
          const ca = data.chain_analysis;
          text += `  Distinct chains: ${ca.chain_count}\n`;
          text += `  Avg chain length: ${ca.avg_chain_length} calls\n`;
          text += `  Total chain overhead: ${(ca.total_chain_overhead_ms / 1000).toFixed(1)}s\n`;
          if (ca.top_patterns && ca.top_patterns.length > 0) {
            text += '  Top patterns:\n';
            for (const p of ca.top_patterns) {
              text += `    ${p.pattern.join(' -> ')} (${p.frequency}x, ${p.avg_overhead_ms}ms avg overhead)\n`;
            }
          }
        } else {
          text += `  None recorded this week.\n`;
        }

        // Directional Analysis (CHANGE 5: always render header; pro — raw amplification factor)
        text += '\n── Directional Analysis ──\n';
        if (data.directional_pairs && data.directional_pairs.length > 0) {
          for (const dp of data.directional_pairs) {
            text += `  ${dp.source_target} -> ${dp.destination_target}: amplification ${dp.amplification_factor.toFixed(2)}x`;
            text += ` (${dp.avg_duration_when_preceded}ms after vs ${dp.avg_duration_standalone}ms standalone)`;
            text += ` [${dp.sample_count} samples]\n`;
          }
        } else {
          text += `  None recorded this week.\n`;
        }

        // Retry Overhead. Totals (including implicit retries detected at
        // the transport boundary) are now free-tier. Per-target breakdown
        // remains pro-tier. If the agent didn't explicitly report any
        // retries but implicit ones were detected, surface the implicit
        // count so the operator sees what the observer caught.
        text += '\n── Retry Overhead ──\n';
        if (data.retry_overhead) {
          const ro = data.retry_overhead;
          text += `  Total retries: ${ro.total_retries}`;
          if (typeof ro.implicit_retries === 'number' && typeof ro.explicit_retries === 'number') {
            text += ` (${ro.explicit_retries} reported, ${ro.implicit_retries} detected from timing)`;
          }
          text += `\n`;
          text += `  Wasted time: ${(ro.total_wasted_ms / 1000).toFixed(1)}s\n`;
          if (typeof ro.detection_window_seconds === 'number') {
            text += `  (implicit retry = failure + same target within ${ro.detection_window_seconds}s)\n`;
          }
          if (Array.isArray(ro.top_retry_targets)) {
            for (const t of ro.top_retry_targets) {
              text += `    ${t.target_system_id}: ${t.retry_count} retries, ${t.wasted_ms}ms wasted\n`;
            }
          }
        } else {
          text += `  None recorded this week.\n`;
        }

        // Population Drift (CHANGE 5: always render header; pro — raw drift percentage)
        text += '\n── Population Drift ──\n';
        if (data.population_drift && data.population_drift.targets.length > 0) {
          for (const t of data.population_drift.targets) {
            const sign = t.drift_percentage > 0 ? '+' : '';
            text += `  ${t.target_system_id}: ${sign}${t.drift_percentage}% vs baseline`;
            text += ` (current ${t.current_median_ms}ms, baseline ${t.baseline_median_ms}ms)\n`;
          }
        } else {
          text += `  None recorded this week.\n`;
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
