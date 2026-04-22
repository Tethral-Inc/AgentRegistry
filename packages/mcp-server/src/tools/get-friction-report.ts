import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId, renderResolveError } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { getUnreadNotificationCount, renderNotificationHeader } from '../utils/notification-header.js';
import { frictionNextAction, renderNextActionFooter } from '../utils/next-action.js';
import { renderDashboardFooter } from '../utils/dashboard-link.js';
import { createSnapshot, renderSnapshotFooter } from '../utils/snapshot.js';
import { isThinSample, renderCohortBaselineHeader } from '../utils/cohort-baseline.js';
import {
  LOCAL_MIN_INTERACTIONS,
  hasEnoughSampleForVerdict,
  renderVerdict,
} from '../config/friction-thresholds.js';

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
        return renderResolveError(err);
      }

      try {
        const params = new URLSearchParams({ scope: scope ?? 'week', source: source ?? 'agent' });
        const authHeaders = getAuthHeaders();
        // Fetch friction data + unread-notification count in parallel so the
        // header doesn't add a serial round-trip.
        const [res, unreadCount] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${id}/friction?${params}`),
          getUnreadNotificationCount(apiUrl, id, authHeaders),
        ]);
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
          let emptyText = renderNotificationHeader(unreadCount);
          // Even with zero interactions, the cohort baseline gives a
          // fresh agent something to look at on first call.
          emptyText += await renderCohortBaselineHeader(apiUrl);
          emptyText += `No interactions recorded for ${displayName} (scope "${scope}", source "${source ?? 'agent'}"). Call log_interaction after each external tool call or API request to populate your friction data. If you're only emitting server self-log, pass source='all' or source='server' to see those.`;
          emptyText += renderNextActionFooter(frictionNextAction({ total_interactions: 0 }));
          emptyText += renderDashboardFooter(id, 'friction', { range: scope, source: source ?? 'agent' });
          return { content: [{ type: 'text' as const, text: emptyText }] };
        }

        let text = renderNotificationHeader(unreadCount);
        // Thin-sample prepend: if the agent's own data is below the
        // threshold, show cohort typical performance so the operator
        // has framing before the own numbers land. Their thin own-data
        // section follows — this is framing, not a substitute.
        if (isThinSample(s.total_interactions)) {
          text += await renderCohortBaselineHeader(apiUrl);
        }
        text += `Friction Report for ${displayName} (${scope})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        text += `Period: ${data.period_start} to ${data.period_end}\n`;
        text += `Source: ${source ?? 'agent'}\n`;
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

            // Network context — actionable comparison instead of a raw
            // rate dump. Sample-size floors + verdict thresholds are
            // centralized in config/friction-thresholds.ts so the math
            // shown next to each verdict matches the rule that fired.
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
              const sample = hasEnoughSampleForVerdict({
                localInteractionCount: t.interaction_count,
                networkAgentCount: netAgents,
                networkInteractionCount: netInteractions,
              });

              text += `    population: ${netAgents} agents`;
              text += `, network failure rate ${((netFailRate ?? 0) * 100).toFixed(1)}%`;
              text += `, anomaly rate ${((t.network_anomaly_rate ?? 0) * 100).toFixed(1)}%\n`;

              if (agentFailRate != null && netFailRate != null && sample.enough) {
                const v = renderVerdict({ localFailRate: agentFailRate, networkFailRate: netFailRate });
                text += `    you ${v.math.yoursPct.toFixed(1)}% vs network ${v.math.netPct.toFixed(1)}% → ${v.verdict}\n`;
                // Surface the exact threshold rule that fired so the
                // operator can see *why* without running a debugger.
                text += `    (threshold: ${v.math.rule})\n`;
              } else if (sample.missing === 'local') {
                text += `    (need ≥${LOCAL_MIN_INTERACTIONS} local interactions for a network comparison; you have ${t.interaction_count})\n`;
              } else if (sample.missing === 'network') {
                text += `    (not enough network data for a verdict yet)\n`;
              }
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

        // Population comparison (paid tier). All structural sections
        // (Chain Analysis, Directional Amplification, Retry Overhead,
        // Population Drift) and classification cuts (by_activity_class,
        // by_target_type, by_interaction_purpose) are rendered earlier
        // in this report — see the "Structural friction FIRST" section.
        if (data.population_comparison) {
          text += `\n── Population ──\n`;
          text += `  ${data.population_comparison.total_agents_in_period} agents active in period\n`;
          text += `  ${data.population_comparison.baselines_available} baselines available\n`;
        }

        // Next-action + dashboard footers. Next-action reads the same data
        // the lens just rendered so the routing decision is honest; the
        // dashboard link carries range + source so the operator lands on
        // the exact view they just saw.
        text += renderNextActionFooter(
          frictionNextAction({
            total_interactions: s.total_interactions,
            top_targets: data.top_targets,
            failure_breakdown: data.by_error_code,
          }),
        );
        text += renderDashboardFooter(id, 'friction', { range: scope, source: source ?? 'agent' });

        // Shareable-snapshot footer. Freezes the rendered view under a
        // short public URL so the operator can paste it to a teammate
        // without sharing their agent ID. Silent-failure: null = no footer.
        const snapshot = await createSnapshot({
          apiUrl,
          agentId: id,
          lens: 'friction',
          query: { scope, source: source ?? 'agent' },
          resultText: text,
        });
        text += renderSnapshotFooter(snapshot);

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Friction report error: ${msg}` }] };
      }
    },
  );
}
