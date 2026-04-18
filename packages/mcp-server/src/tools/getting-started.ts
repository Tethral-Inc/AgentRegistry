import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAuthHeaders } from '../state.js';
import { resolveAgentId } from '../utils/resolve-agent-id.js';

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
  duration_ms: 'latency analysis and friction report',
  status: 'failure registry and trend',
  anomaly_flagged: 'anomaly signal notifications',
  chain_id: 'chain analysis and chain overhead',
  error_code: 'detailed failure breakdown',
  retry_count: 'retry waste analysis',
  queue_wait_ms: 'queue wait vs execution split',
  response_size_bytes: 'payload size tracking',
};

export function gettingStartedTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'getting_started',
    {
      description: 'Step-by-step setup checklist. Shows your registration status, whether you\'re logging interactions, composition completeness, and signal coverage — with the next action you should take. Call this if you\'re unsure where to start.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.9 },
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

      let text = `Getting Started with ACR\n${'='.repeat(24)}\n\n`;

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
