import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveAgentId } from '../utils/resolve-agent-id.js';
import { fetchAuthed } from '../utils/fetch-authed.js';

type DeclaredUsed = { kind: string; id: string; name?: string; target: string; interaction_count: number };
type DeclaredUnused = { kind: string; id: string; name?: string; target: string };
type Undeclared = { target: string; target_type: string; interaction_count: number };

/**
 * get_composition_diff — show the gap between declared and actual composition.
 *
 * Calls GET /agent/:id/composition-diff which joins agent_composition_sources
 * against interaction_receipts for the window and reports three buckets:
 *   declared_and_used, declared_but_unused, used_but_undeclared.
 *
 * Rendered as a compact report with counts and the top entries in each
 * bucket so the agent can decide whether to call update_composition.
 */
export function getCompositionDiffTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_composition_diff',
    {
      description: 'Compare your declared composition (MCPs, APIs, skills from register_agent / update_composition) against the targets you actually interact with in receipts. Surfaces three gaps: declared-and-used, declared-but-unused (shadow declarations), used-but-undeclared (shadow dependencies). Use this to decide whether to call update_composition.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your ACR agent ID (auto-assigned if omitted)'),
        agent_name: z.string().optional().describe('Your agent name (alternative to agent_id)'),
        window_days: z.number().int().positive().max(30).optional().describe('Receipt window in days (default 7, max 30)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.6 },
    },
    async ({ agent_id, agent_name, window_days }) => {
      let id: string;
      let displayName: string;
      try {
        const resolved = await resolveAgentId({ agentId: agent_id, agentName: agent_name });
        id = resolved.id;
        displayName = resolved.displayName;
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }

      const url = new URL(`${apiUrl}/api/v1/agent/${id}/composition-diff`);
      if (window_days) url.searchParams.set('window_days', String(window_days));

      try {
        const res = await fetchAuthed(url.toString());
        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          return { content: [{ type: 'text' as const, text: `Composition diff error: ${errText}` }] };
        }
        const data = await res.json() as {
          window_days: number;
          declared_source: string | null;
          declared_updated_at: string | null;
          counts: {
            declared_total: number;
            used_total: number;
            declared_and_used: number;
            declared_but_unused: number;
            used_but_undeclared: number;
          };
          declared_and_used: DeclaredUsed[];
          declared_but_unused: DeclaredUnused[];
          used_but_undeclared: Undeclared[];
        };

        let text = `Composition Diff: ${displayName}\n${'='.repeat(32)}\n`;
        text += `Window: last ${data.window_days} day${data.window_days === 1 ? '' : 's'}\n`;
        if (data.declared_source) {
          text += `Declared source: ${data.declared_source}`;
          if (data.declared_updated_at) text += ` (updated ${data.declared_updated_at})`;
          text += `\n`;
        } else {
          text += `Declared source: none — no composition on file\n`;
        }

        const c = data.counts;
        text += `\n-- Counts --\n`;
        text += `  Declared total: ${c.declared_total}\n`;
        text += `  Used (distinct targets): ${c.used_total}\n`;
        text += `  ✓ Declared and used: ${c.declared_and_used}\n`;
        text += `  ! Declared but unused: ${c.declared_but_unused}\n`;
        text += `  ! Used but undeclared: ${c.used_but_undeclared}\n`;

        if (data.declared_and_used.length > 0) {
          text += `\n-- Declared and used (top 10 by traffic) --\n`;
          const sorted = [...data.declared_and_used].sort((a, b) => b.interaction_count - a.interaction_count).slice(0, 10);
          for (const d of sorted) {
            const label = d.name ?? d.id;
            text += `  ${d.target}  (${d.kind}: ${label}) — ${d.interaction_count} receipts\n`;
          }
        }

        if (data.declared_but_unused.length > 0) {
          text += `\n-- Declared but unused --\n`;
          text += `  These are declared in your composition but no receipts reference them in the window.\n`;
          text += `  Either the feature is dormant, or receipts don't carry the expected target_system_id.\n`;
          for (const d of data.declared_but_unused.slice(0, 15)) {
            const label = d.name ?? d.id;
            text += `  ${d.target}  (${d.kind}: ${label})\n`;
          }
          if (data.declared_but_unused.length > 15) {
            text += `  … and ${data.declared_but_unused.length - 15} more\n`;
          }
        }

        if (data.used_but_undeclared.length > 0) {
          text += `\n-- Used but undeclared (shadow dependencies) --\n`;
          text += `  These targets appear in your receipts but aren't in your declared composition.\n`;
          text += `  Consider adding them via update_composition so they participate in network anomaly rollups.\n`;
          const sorted = [...data.used_but_undeclared].sort((a, b) => b.interaction_count - a.interaction_count).slice(0, 15);
          for (const u of sorted) {
            text += `  ${u.target}  (${u.target_type}) — ${u.interaction_count} receipts\n`;
          }
          if (data.used_but_undeclared.length > 15) {
            text += `  … and ${data.used_but_undeclared.length - 15} more\n`;
          }
        }

        if (c.declared_total === 0 && c.used_total === 0) {
          text += `\nNo declared composition and no receipts yet. Call update_composition and log_interaction to get started.\n`;
        } else if (c.declared_total === 0) {
          text += `\nNext step: call update_composition with your MCPs, skills, and APIs. Every anomaly rollup benefits.\n`;
        } else if (c.used_but_undeclared > 0) {
          text += `\nNext step: call update_composition and add the shadow dependencies listed above.\n`;
        } else if (c.declared_but_unused > 0 && c.declared_and_used === 0) {
          text += `\nNothing declared has been used. Check that receipts carry the expected target_system_id (e.g. 'mcp:github' not 'github-mcp').\n`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Composition diff error: ${err instanceof Error ? err.message : 'Unknown'}` }] };
      }
    },
  );
}
