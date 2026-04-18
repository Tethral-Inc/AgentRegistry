import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

/** "1h 12m", "12m 4s", "4.2s" — picks the right unit for the magnitude. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

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

        // Summary metrics
        text += `── Summary ──\n`;
        text += `  Interactions: ${s.total_interactions}\n`;
        text += `  Total wait: ${formatDuration(s.total_wait_time_ms)}\n`;
        // Active span: the burst-union of interaction timestamps, which is
        // the denominator of friction_percentage. Rendering it turns the %
        // from a ratio into a number the operator can act on.
        // "3.1% of 4h active" ≠ "3.1% of 40s active".
        if (typeof s.active_span_ms === 'number' && s.active_span_ms > 0) {
          const scopeStartMs = new Date(data.period_start).getTime();
          const scopeEndMs = new Date(data.period_end).getTime();
          const scopeSpanMs = Math.max(scopeEndMs - scopeStartMs, 0);
          text += `  Active span: ${formatDuration(s.active_span_ms)}`;
          if (scopeSpanMs > 0) text += ` of ${formatDuration(scopeSpanMs)} (${scope} scope)`;
          text += `\n`;
        }
        // friction_percentage can exceed 100% when calls run in parallel
        // (wall-clock wait exceeds active span). Show the raw number so
        // the operator sees the signal, but annotate the cause so it
        // doesn't read as a bug.
        const fricNote = s.friction_percentage > 100 ? ' (parallel calls — wait exceeds active span)' : '';
        text += `  Friction: ${s.friction_percentage.toFixed(2)}% of active time${fricNote}\n`;
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

        // Category breakdown. Only count/total are computed server-side
        // today; median/p95 would require a second aggregate pass and
        // aren't populated, so we render what we have.
        if (data.by_category && data.by_category.length > 0) {
          text += `\n── By Category ──\n`;
          for (const cat of data.by_category) {
            const avgMs = cat.interaction_count > 0 ? Math.round(cat.total_duration_ms / cat.interaction_count) : 0;
            text += `  ${cat.category}: ${cat.interaction_count} calls, ${(cat.total_duration_ms / 1000).toFixed(1)}s total, avg ${avgMs}ms`;
            if (cat.failure_count > 0) text += `, ${cat.failure_count} failures`;
            text += `\n`;
          }
        }

        // Error codes — concrete + actionable. "401: 6 hits, mostly Slack"
        // is the kind of signal that lets the operator fix the failure,
        // versus just knowing the failure_rate %.
        if (data.by_error_code && data.by_error_code.length > 0) {
          text += `\n── Failures by Error Code ──\n`;
          for (const ec of data.by_error_code) {
            text += `  ${ec.error_code}: ${ec.count}`;
            if (ec.top_target) {
              const allOne = ec.top_target_count === ec.count;
              text += allOne
                ? ` (all ${ec.top_target})`
                : ` (mostly ${ec.top_target}: ${ec.top_target_count})`;
            }
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

            // Wasted tokens from failed calls — dollar impact of bad
            // targets, not just time impact. Only surfaced when the
            // agent supplied tokens_used on log_interaction.
            if (typeof t.wasted_tokens === 'number' && t.wasted_tokens > 0) {
              text += `    wasted tokens on failures: ${t.wasted_tokens.toLocaleString()}\n`;
            }

            // Status breakdown
            if (t.status_breakdown) {
              const statuses = Object.entries(t.status_breakdown as Record<string, number>)
                .map(([status, count]) => `${status}: ${count}`)
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
                // Absolute floor on yoursPct before blaming the user's
                // config — a single failure out of 10 interactions is
                // 10% which trivially beats `netPct * 2` when netPct is
                // 0.5%. Require both relative AND absolute elevation.
                if (netPct < 5 && yoursPct >= 5 && yoursPct > netPct * 2) {
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

        // Transport breakdown (same shape as by_category — count + total).
        if (data.by_transport && data.by_transport.length > 0) {
          text += `\n── By Transport ──\n`;
          for (const t of data.by_transport) {
            text += `  ${t.transport}: ${t.interaction_count} calls, ${(t.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }

        // Source breakdown (server self-logs vs agent-initiated)
        if (data.by_source && data.by_source.length > 0) {
          text += `\n── By Source ──\n`;
          for (const src of data.by_source) {
            text += `  ${src.source}: ${src.interaction_count} interactions\n`;
          }
        }

        // Classification cuts — these come from categories.{activity_class,
        // target_type, interaction_purpose} on each receipt and give the
        // operator a "kind of work" view instead of just a "which target"
        // view. Only rendered when receipts actually set these fields.
        if (data.by_activity_class && data.by_activity_class.length > 0) {
          text += `\n── By Activity Class ──\n`;
          for (const row of data.by_activity_class) {
            text += `  ${row.activity_class}: ${row.interaction_count} calls, ${(row.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }
        if (data.by_target_type && data.by_target_type.length > 0) {
          text += `\n── By Target Type ──\n`;
          for (const row of data.by_target_type) {
            text += `  ${row.target_type}: ${row.interaction_count} calls, ${(row.total_duration_ms / 1000).toFixed(1)}s total\n`;
          }
        }
        if (data.by_interaction_purpose && data.by_interaction_purpose.length > 0) {
          text += `\n── By Interaction Purpose ──\n`;
          for (const row of data.by_interaction_purpose) {
            text += `  ${row.interaction_purpose}: ${row.interaction_count} calls, ${(row.total_duration_ms / 1000).toFixed(1)}s total\n`;
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
          text += `  None recorded this ${scope}.\n`;
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
          text += `  None recorded this ${scope}.\n`;
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
              text += `    ${t.target_system_id}: ${t.retry_count} retries, ${(t.wasted_ms / 1000).toFixed(1)}s wasted\n`;
            }
          }
        } else {
          text += `  None recorded this ${scope}.\n`;
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
          text += `  None recorded this ${scope}.\n`;
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
