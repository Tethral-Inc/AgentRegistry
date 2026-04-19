import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAgentName, getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { confidence } from '../utils/confidence.js';

const TOOL_DESCRIPTION = `Query the compensation-signatures lens: how stereotyped is your chain-shape behavior, and which chain patterns dominate vs which are exploratory?

Every multi-step chain the agent runs is fingerprinted as an ordered target sequence (e.g. api:openai.com → api:stripe.com → mcp:filesystem). Across a window, the lens reports:

  • agent_stability — a continuum score in [0, 1]. 1.0 = one pattern does everything (maximally routine). 0.0 = every chain looks different (exploratory / unstable). Computed as 1 − normalized Shannon entropy across patterns.
  • pattern_stability — per-pattern share of total chains. A high value means this exact sequence is the agent's routine. A low value with persistent frequency is the kind of long-tail signal that *can* be compensation (routing around something) or genuinely exploratory — you read it together with the friction report.
  • fleet_agent_count — how many other agents run this same pattern. A high-frequency, low-fleet pattern is idiosyncratic. A fleet-wide pattern is a substrate-level signal.

This is a continuum, not a verdict. There is no "compensation detected" flag — only the distribution. Interpret a persistent low-stability tail with non-trivial frequency as *possible* ongoing compensation, and confirm by cross-referencing the friction report for the targets involved.

Requires at least some multi-step chains to have been logged with chain_id + chain_position. Window is 'day' or 'week'; defaults to 'week'. Runs against chain_analysis, which is refreshed nightly by the background job.`;

export function getCompensationSignaturesTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_compensation_signatures',
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        window: z.enum(['day', 'week']).optional().default('week').describe("Analysis window. 'week' is the default — gives chain shape room to stabilize."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name, window }) => {
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
        const params = new URLSearchParams({ window: window ?? 'week' });
        const res = await fetch(
          `${apiUrl}/api/v1/agent/${id}/compensation?${params}`,
          { headers: getAuthHeaders() },
        );
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Compensation error: ${errText}` }] };
        }
        const data = await res.json();
        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        displayName = data.name || agent_name || getAgentName() || displayName;
        const s = data.summary;

        if (s.total_chains === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No multi-step chains recorded for ${displayName} (window "${window ?? 'week'}"). To populate this lens, pass chain_id and chain_position to log_interaction for sequential calls. Chain analysis is refreshed nightly by the background job.`,
            }],
          };
        }

        let text = `Compensation Signatures for ${displayName} (${window ?? 'week'})\n`;
        text += `Agent ID: ${data.agent_id}\n`;
        if (data.computed_at) text += `Computed at: ${data.computed_at}\n`;
        text += `\n── Summary ──\n`;
        text += `  Total chains: ${s.total_chains}\n`;
        text += `  Distinct patterns: ${s.distinct_patterns}\n`;
        text += `  Agent stability: ${s.agent_stability.toFixed(3)}  (1.0 = one pattern does everything; 0.0 = every chain is different)\n`;

        text += `\n── Patterns (ranked by frequency) ──\n`;
        text += `  pattern_stability = this pattern's share of all chains. Low share + persistent frequency = possible compensation.\n`;

        for (const p of data.patterns) {
          const arrow = p.chain_pattern.join(' \u2192 ');
          const sharePct = (p.share_of_chains * 100).toFixed(1);
          text += `\n  ${arrow}\n`;
          text += `    frequency: ${p.frequency}  ${confidence(p.frequency)}\n`;
          text += `    pattern_stability: ${p.pattern_stability.toFixed(3)} (${sharePct}% of this agent's chains)\n`;
          if (p.avg_overhead_ms > 0) {
            text += `    avg overhead: ${p.avg_overhead_ms}ms\n`;
          }
          if (p.fleet_agent_count != null) {
            const desc = p.fleet_agent_count === 1
              ? 'idiosyncratic (only you)'
              : `seen across ${p.fleet_agent_count} agents, ${p.fleet_total_frequency} total occurrences`;
            text += `    fleet: ${desc}\n`;
          }
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Compensation error: ${msg}` }] };
      }
    },
  );
}
