import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureRegistered, getAgentId } from '../state.js';
import { RegistrationFailedError } from '../session-state.js';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { truncId } from '../utils/style.js';

export function getNotificationsTool(server: McpServer, apiUrl: string) {
  server.registerTool(
    'get_notifications',
    {
      description: 'An anomaly signal is a behavioral pattern ACR observed across multiple unrelated agents (not a security event). Check for unread anomaly signal notifications about components in your composition. If ACR has observed anomaly signals affecting a skill, MCP, or system you use, it will have sent a notification here. Also delivers version updates. Call this on startup. ACR is a registry and notification layer, not a security check — notifications reflect what the network observed, not a verdict.',
      inputSchema: {
        agent_id: z.string().optional().describe('Your agent ID (uses session if omitted)'),
        verbose: z.boolean().optional().describe('Render full-length notification IDs instead of the truncated inline display. Useful when copying an ID into `acknowledge_signal`.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.5 },
    },
    async ({ agent_id, verbose }) => {
      let resolvedId: string;
      try {
        resolvedId = agent_id ?? getAgentId() ?? await ensureRegistered();
      } catch (err) {
        if (err instanceof RegistrationFailedError) {
          return {
            content: [{ type: 'text' as const, text: err.userMessage() }],
            isError: true,
          };
        }
        throw err;
      }

      try {
        // Fetch notifications and profile in parallel to detect empty composition
        const [notifRes, profileRes] = await Promise.all([
          fetchAuthed(`${apiUrl}/api/v1/agent/${resolvedId}/notifications?read=false`),
          fetchAuthed(`${apiUrl}/api/v1/agent/${resolvedId}/profile`).catch(() => null),
        ]);

        const data = await notifRes.json() as {
          notifications: Array<{
            id: string; skill_hash: string; notification_type: string;
            severity: string; title: string; message: string; created_at: string;
          }>;
          unread_count: number;
        };

        let compositionEmpty = false;
        if (profileRes?.ok) {
          try {
            const profile = await profileRes.json() as Record<string, unknown>;
            const comp = profile.composition_summary as Record<string, unknown> | null;
            if (comp) {
              const skills = (comp.skill_count as number) ?? 0;
              const mcps = (comp.mcp_count as number) ?? 0;
              const tools = (comp.tool_count as number) ?? 0;
              compositionEmpty = skills === 0 && mcps === 0 && tools === 0;
            } else {
              compositionEmpty = true;
            }
          } catch {
            // ignore parse error — skip composition warning
          }
        }

        let text: string;
        if (data.unread_count === 0) {
          // Empty state is good news here — mark it explicitly and give
          // a concrete next step so the operator doesn't dead-end.
          text = '✓ No unread notifications.\n\n';
          text += '→ Next action: call `get_friction_report` to read this week\'s behavior, or `orient_me` for state-sensitive routing.';
        } else {
          text = `You have ${data.unread_count} unread notification(s):\n`;
          for (const n of data.notifications) {
            text += `\n[${n.severity}] ${n.title}`;
            text += `\n   ${n.message}`;
            // Truncate the notification id for inline display. Pass
            // `verbose: true` to show full-length ids, which is what the
            // operator needs when copying into acknowledge_signal.
            text += `\n   ID: ${truncId(n.id, { verbose })} | ${n.created_at.split('T')[0]}`;
            text += '\n';
          }
          if (!verbose) {
            text += '\n(Notification IDs are truncated — pass verbose: true to see the full values for acknowledge_signal.)';
          }
        }

        if (compositionEmpty) {
          text += '\nNote: Your composition is empty — anomaly notifications are network-wide only. Call update_composition to enable targeted alerts for your specific stack.';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Notification check error: ${msg}` }] };
      }
    },
  );
}
