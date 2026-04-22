import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { getActiveSession } from '../session-state.js';
import { renderUpgradeBanner } from '../version-check.js';

async function fetchJsonSafe(url: string, headers: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SIGNAL_COSTS: Record<string, string> = {
  log_interaction: 'every friction, coverage, trend, and chain lens',
  duration_ms: 'latency analysis and friction report',
  status: 'failure registry and trend',
  anomaly_flagged: 'anomaly signal notifications',
  chain_id: 'chain analysis and chain overhead',
  'interaction.category': 'category breakdowns in the friction report',
  'interaction.queue_wait_ms': 'queue wait vs execution split',
  'interaction.retry_count': 'explicit retry waste analysis (implicit retries are still detected from timing)',
  'interaction.error_code': 'detailed failure breakdown',
  'interaction.tokens_used': 'wasted-token callouts in the friction report',
  'target.system_type': 'target-type-aware grouping',
  'categories.activity_class': 'kind-of-work breakdowns (language/math/visuals/etc)',
  'categories.*': 'richer classification slices in the friction report',
};

export function gettingStartedTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'getting_started',
    {
      description: 'DEPRECATED since v2.7.0 — call `orient_me` instead. The checklist still runs for back-compat, but `orient_me` gives a state-sensitive next step plus cohort baseline framing that a static four-step list cannot. This shim will be removed no earlier than v2.9.0.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      // Priority dropped from 0.9 to 0.2 so hosts that sort tools by
      // priority surface orient_me (priorityHint 1.0) as the true front
      // door. The checklist is still callable, just not recommended.
      _meta: { priorityHint: 0.2, deprecated: true, replacedBy: 'orient_me', deprecatedSince: '2.7.0' },
    },
    async ({ agent_id, agent_name }) => {
      let id: string;
      let resolvedDisplayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        resolvedDisplayName = resolved.displayName;
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      const authHeaders = getAuthHeaders();

      // Fetch profile, coverage, and agent record in parallel
      const [profile, coverage, agentData] = await Promise.all([
        fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/profile`, authHeaders),
        fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}/coverage`, authHeaders),
        fetchJsonSafe(`${apiUrl}/api/v1/agent/${id}`, authHeaders),
      ]);

      const displayName = (agentData?.name as string) ?? (profile?.name as string) ?? resolvedDisplayName;

      let text = renderUpgradeBanner(getActiveSession().versionCheck);
      // Deprecation banner: we don't silently redirect because the
      // operator may have wired `getting_started` into their own
      // scripts — breaking it mid-flight is worse than showing a
      // pointer to the replacement and running the old logic anyway.
      text += `NOTE: getting_started is deprecated since v2.7.0. Call \`orient_me\` for a state-sensitive next step.\n\n`;
      text += `Getting Started with ACR\n${'='.repeat(24)}\n\n`;

      const nextActions: string[] = [];

      // Step 1: Registration
      text += `Step 1: Registration\n`;
      if (agentData && !agentData.error) {
        text += `  ✓ Registered as ${displayName} (ID: ${id})\n`;
      } else {
        text += `  ✗ Not registered yet — this should auto-resolve. Try calling register_agent explicitly.\n`;
        nextActions.push('Call register_agent to complete registration.');
      }

      // Step 2: Interaction Logging
      text += `\nStep 2: Interaction Logging\n`;
      const counts = profile?.counts as Record<string, unknown> | null;
      const totalReceipts = (counts?.total_receipts as number) ?? 0;
      if (totalReceipts > 0) {
        text += `  ✓ ${totalReceipts} interactions logged\n`;
      } else {
        text += `  ✗ No interactions logged yet — call log_interaction after every external tool call, API request, or MCP interaction. Every lens depends on this.\n`;
        nextActions.push('Call log_interaction after every external call to start populating your profile.');
      }

      // Step 3: Composition
      text += `\nStep 3: Composition\n`;
      const comp = profile?.composition_summary as Record<string, unknown> | null;
      const skillCount = (comp?.skill_count as number) ?? 0;
      const mcpCount = (comp?.mcp_count as number) ?? 0;
      const toolCount = (comp?.tool_count as number) ?? 0;
      const totalComponents = skillCount + mcpCount + toolCount;
      if (totalComponents > 0) {
        text += `  ✓ Composition registered (${totalComponents} component${totalComponents === 1 ? '' : 's'})\n`;
      } else {
        text += `  ✗ Composition empty — call update_composition with your current MCPs, skills, and tools. Without this, anomaly notifications are network-wide only.\n`;
        nextActions.push('Call update_composition with your current MCPs, skills, and tools.');
      }

      // Step 4: Signal Coverage
      text += `\nStep 4: Signal Coverage\n`;
      const rules = coverage?.rules as Array<{ signal: string; triggered: boolean }> | null;
      if (rules) {
        const gaps = rules.filter((r) => r.triggered).map((r) => r.signal);
        const coveredCount = rules.length - gaps.length;
        if (gaps.length === 0) {
          text += `  ✓ Full coverage (${coveredCount}/${rules.length} signals)\n`;
        } else {
          text += `  ! Partial coverage (${coveredCount}/${rules.length}) — missing: ${gaps.join(', ')}\n`;
          const costs = gaps
            .map((g) => SIGNAL_COSTS[g])
            .filter(Boolean);
          if (costs.length > 0) {
            text += `    These gaps disable: ${costs.join('; ')}\n`;
          }
          nextActions.push(`Populate these log_interaction fields to fix coverage gaps: ${gaps.join(', ')}.`);
        }
      } else {
        text += `  ? Coverage data unavailable — call get_coverage for details\n`;
      }

      // Next step
      text += `\nNext step: `;
      if (nextActions.length === 0) {
        text += `You're all set — call get_friction_report to see your profile.\n`;
      } else {
        text += `${nextActions[0]}\n`;
      }

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
