import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveSession } from '../session-state.js';

/**
 * Operator privacy control for deep composition capture.
 *
 * By default, when the agent reports composition (via register_agent or
 * update_composition), rich component records include sub_components —
 * ACR gets the internals of each attached skill or MCP so it can
 * distinguish internal friction from external friction correctly.
 *
 * Operators who don't want ACR to see the internals can disable deep
 * composition capture. When off, the MCP still sends top-level component
 * data (skill name, MCP name, hash) but strips sub_components before
 * sending. ACR's internal-vs-external classification becomes coarser as
 * a result — that's the tradeoff.
 *
 * Also settable via the ACR_DEEP_COMPOSITION=false environment variable
 * at MCP startup.
 */
export function disableDeepCompositionTool(server: McpServer) {
  server.registerTool(
    'configure_deep_composition',
    {
      description:
        'Operator privacy control. Enable or disable deep composition capture for this session. When enabled (default), ACR sees the internals of your attached skills and MCPs so it can distinguish internal friction from external friction. When disabled, only top-level component info is sent — ACR no longer sees sub-components. Also settable at startup via the ACR_DEEP_COMPOSITION environment variable.',
      inputSchema: {
        enabled: z.boolean().describe('Set to true to enable deep capture, false to disable.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { priorityHint: 0.3 },
    },
    async ({ enabled }) => {
      const session = getActiveSession();
      const previous = session.deepComposition;
      session.setDeepComposition(enabled);

      const statusText = enabled
        ? 'Deep composition capture is now ENABLED. ACR will include sub-components of skills and MCPs in future composition reports. This lets the network distinguish internal interactions (your agent engaging its own parts) from external interactions (those parts reaching outside).'
        : 'Deep composition capture is now DISABLED. Future composition reports will include only top-level components (skill names, MCP names, hashes) without sub_components. ACR will not see the internals of your attached parts. Internal-vs-external classification becomes coarser as a result.';

      const changeText = previous === enabled
        ? ' (no change — was already this way)'
        : '';

      return {
        content: [{
          type: 'text' as const,
          text: `${statusText}${changeText}`,
        }],
      };
    },
  );
}
