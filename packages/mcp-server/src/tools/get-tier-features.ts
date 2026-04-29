/**
 * get_tier_features — what's in free vs paid, in one place.
 *
 * The audit (Sprint 2 / F8) found that free-tier users had no
 * principled way to learn what they were missing. The friction
 * report silently omits paid sections; the README documents tier
 * gating but the tool surface didn't surface it. Contextual upsell
 * lines (frictionTierUpsell) handle the case-by-case "you'd benefit
 * from X" pitch; this tool handles the "show me the full diff"
 * request.
 *
 * Static content — no API call, no agent context required. This is
 * documentation surfaced as a tool so the agent can discover tiers
 * without leaving the MCP.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderTierFeaturesReport } from '../utils/tier-upsell.js';

export function getTierFeaturesTool(server: McpServer) {
  server.registerTool(
    'get_tier_features',
    {
      description: 'Show what each ACR tier (free, paid) includes — full feature comparison. Use this when you want to know what an upgrade would unlock without parsing prose upsells across other tools. Static content; no agent context required.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async () => {
      return {
        content: [{ type: 'text' as const, text: renderTierFeaturesReport() }],
      };
    },
  );
}
