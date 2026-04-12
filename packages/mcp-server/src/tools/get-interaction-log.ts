import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId, getAgentName, getApiUrl } from '../state.js';

const STATUS_TRANSLATIONS: Record<string, string> = {
  success: 'success',
  failure: 'failure — target returned an error',
  timeout: 'timeout — target did not respond in time',
  partial: 'partial — incomplete response received',
};

// Anomaly categories are passed through as-is from the agent's report.
// No synthetic descriptions — the category name is the data.

async function resolveId(agentName: string | undefined, agentId: string | undefined, apiUrl: string): Promise<string> {
  if (agentName) {
    if (agentName.startsWith('acr_') || agentName.startsWith('pseudo_')) return agentName;
    const res = await fetch(`${apiUrl}/api/v1/agent/${encodeURIComponent(agentName)}`);
    if (!res.ok) throw new Error(`Agent "${agentName}" not found`);
    const data = await res.json() as { agent_id: string };
    return data.agent_id;
  }
  return agentId || getAgentId() || await ensureRegistered();
}

export function getInteractionLogTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_interaction_log',
    {
      description: 'View your interaction history. Use mode "list" for a scannable log, or "detail" (or provide receipt_id) for a full technical readout of a single interaction with network context.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        receipt_id: z.string().optional().describe('Specific receipt ID for detail view'),
        mode: z.enum(['list', 'detail']).optional().default('list').describe('Display mode: "list" for scannable log, "detail" for full readout'),
        limit: z.number().min(1).max(200).optional().default(20).describe('Max interactions to show'),
        target: z.string().optional().describe('Filter by target system (e.g. "mcp:github")'),
        category: z.string().optional().describe('Filter by category (tool_call, delegation, etc.)'),
        status: z.string().optional().describe('Filter by status (success, failure, timeout, partial)'),
        anomaly_only: z.boolean().optional().default(false).describe('Show only anomaly-flagged interactions'),
        since: z.string().optional().describe('Show interactions after this ISO timestamp'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.7 },
    },
    async ({ agent_id, agent_name, receipt_id, mode, limit, target, category, status, anomaly_only, since }) => {
      let id: string;
      try {
        id = await resolveId(agent_name, agent_id, apiUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }] };
      }

      try {
        // Build query params
        const params = new URLSearchParams();
        if (receipt_id) params.set('receipt_id', receipt_id);
        if (limit) params.set('limit', String(limit));
        if (target) params.set('target', target);
        if (category) params.set('category', category);
        if (status) params.set('status', status);
        if (anomaly_only) params.set('anomaly', 'true');
        if (since) params.set('since', since);

        const res = await fetch(`${apiUrl}/api/v1/agent/${id}/receipts?${params}`);
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Error: ${errText}` }] };
        }
        const data = await res.json();

        if (data.error) {
          return { content: [{ type: 'text' as const, text: `Error: ${data.error.message}` }] };
        }

        const displayName = data.name || agent_name || getAgentName() || id;

        // Detail mode — single receipt
        if (receipt_id || mode === 'detail') {
          if (data.receipt) {
            return { content: [{ type: 'text' as const, text: formatDetail(data, displayName) }] };
          }
          // If receipt_id was given but we got a list, show first item in detail
          if (data.receipts && data.receipts.length > 0) {
            return { content: [{ type: 'text' as const, text: formatListDetailed(data.receipts.slice(0, 5), displayName) }] };
          }
          return { content: [{ type: 'text' as const, text: `No interactions found for ${displayName}. Call log_interaction after each external tool call to start recording data.` }] };
        }

        // List mode
        const receipts = data.receipts ?? [];
        if (receipts.length === 0) {
          return { content: [{ type: 'text' as const, text: `No interactions found for ${displayName}. Call log_interaction after each external tool call to start recording data.` }] };
        }

        let text = `Interaction Log for ${displayName}\n`;
        text += `Showing ${receipts.length} interaction${receipts.length === 1 ? '' : 's'}`;
        if (data.next_cursor) text += ' (more available)';
        text += '\n\n';

        for (const r of receipts) {
          text += formatListLine(r);
        }

        if (data.next_cursor) {
          text += `\n... more interactions available. Use since/target/category filters or cursor to paginate.`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Interaction log error: ${msg}` }] };
      }
    },
  );
}

function formatListLine(r: Record<string, unknown>): string {
  let line = `[${r.created_at}] ${r.interaction_category} -> ${r.target_system_id} (${r.target_system_type})\n`;
  line += `  ${r.duration_ms ?? '?'}ms | ${STATUS_TRANSLATIONS[r.status as string] ?? r.status}`;
  if (r.anomaly_flagged) {
    const cat = r.anomaly_category as string;
    line += ` | ANOMALY: ${cat}`;
  }
  line += '\n';
  if (r.anomaly_flagged && r.anomaly_detail) {
    line += `  [reported] ${r.anomaly_detail}\n`;
  }
  return line + '\n';
}

function formatDetail(data: Record<string, unknown>, displayName: string): string {
  const r = data.receipt as Record<string, unknown>;
  const ctx = data.network_context as Record<string, unknown> | null;
  const baseline = data.baseline as Record<string, unknown> | null;

  let text = `Receipt: ${r.receipt_id}\n`;
  text += `${'='.repeat(40)}\n`;
  text += `When: ${r.created_at}\n`;
  text += `What: ${r.interaction_category} -> ${r.target_system_id} (${r.target_system_type})\n`;

  // Duration with baseline context
  const dur = r.duration_ms as number | null;
  if (dur != null) {
    text += `Duration: ${dur}ms`;
    if (baseline) {
      const bMedian = baseline.baseline_median_ms as number;
      const bP95 = baseline.baseline_p95_ms as number;
      if (bMedian > 0) {
        const ratio = dur / bMedian;
        if (ratio > 2) {
          text += ` — ${ratio.toFixed(1)}x baseline median (${bMedian}ms), p95 ${bP95}ms`;
        } else {
          text += ` — within normal range (baseline median ${bMedian}ms, p95 ${bP95}ms)`;
        }
      }
    }
    text += '\n';
  }

  text += `Status: ${STATUS_TRANSLATIONS[r.status as string] ?? r.status}\n`;
  text += `\nAgent: ${displayName} (${r.emitter_agent_id})\n`;
  if (r.emitter_provider_class) text += `Provider: ${r.emitter_provider_class}\n`;
  if (r.emitter_composition_hash) text += `Composition: ${r.emitter_composition_hash}\n`;

  if (r.anomaly_flagged) {
    const cat = r.anomaly_category as string;
    text += `\nAnomaly: ${cat}\n`;
    if (r.anomaly_detail) {
      text += `[reported] ${r.anomaly_detail}\n`;
    }
  } else {
    text += `\nAnomaly: none\n`;
  }

  // Network context
  if (ctx) {
    text += `\n-- Network Context --\n`;
    text += `${r.target_system_id} — failure ${((ctx.failure_rate as number) * 100).toFixed(1)}%`;
    text += `, anomaly ${((ctx.anomaly_rate as number) * 100).toFixed(1)}%`;
    text += `, ${ctx.distinct_agent_count} agents observed\n`;
    if (ctx.median_duration_ms != null) {
      text += `Network median: ${ctx.median_duration_ms}ms`;
      if (ctx.p95_duration_ms != null) text += `, p95: ${ctx.p95_duration_ms}ms`;
      text += '\n';
    }
  }

  return text;
}

function formatListDetailed(receipts: Array<Record<string, unknown>>, displayName: string): string {
  let text = `Interaction Detail for ${displayName}\n${'='.repeat(40)}\n\n`;
  for (const r of receipts) {
    text += `[${r.created_at}] ${r.interaction_category} -> ${r.target_system_id}\n`;
    text += `  ${r.duration_ms ?? '?'}ms | ${STATUS_TRANSLATIONS[r.status as string] ?? r.status}\n`;
    if (r.emitter_composition_hash) text += `  composition: ${r.emitter_composition_hash}\n`;
    if (r.anomaly_flagged) {
      text += `  ANOMALY: ${r.anomaly_category}`;
      if (r.anomaly_detail) text += ` — [reported] ${r.anomaly_detail}`;
      text += '\n';
    }
    text += '\n';
  }
  return text;
}
