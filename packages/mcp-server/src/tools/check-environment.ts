import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fetchAuthed } from '../utils/fetch-authed.js';
import { parseApiResponse } from '../utils/parse-api-response.js';
import { getRecentSelfFailures } from '../self-telemetry.js';
import { truncHash } from '../utils/style.js';

/**
 * Structured /health response shape. Mirrors the API contract in
 * packages/ingestion-api/src/routes/health.ts. Validated through
 * parseApiResponse so a backend rename or shape change becomes a
 * loud isError instead of a silent "unknown" status.
 */
const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'stale', 'down']),
  database: z.enum(['connected', 'unreachable']),
  last_aggregation_at: z.string().nullable(),
  freshness_seconds: z.number().nullable(),
  known_issues: z.array(z.object({
    component: z.string(),
    message: z.string(),
  })),
  timestamp: z.string(),
});

const ThreatsResponseSchema = z.array(z.object({
  skill_hash: z.string(),
  skill_name: z.string().nullable().optional(),
  anomaly_signal_count: z.number(),
  agent_count: z.number().optional(),
}));

function formatFreshness(seconds: number | null): string {
  if (seconds === null) return 'unknown';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function checkEnvironmentTool(server: McpServer, apiUrl: string, resolverUrl: string) {
  server.registerTool(
    'check_environment',
    {
      description: 'Check the current ACR network environment: pipeline health (status, aggregation freshness, known issues) and active anomaly signals. Call on startup to see the state of the broader network. Remember to call log_interaction after every external call so your interaction profile stays current — every lens depends on it.',
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: { priorityHint: 0.8 },
    },
    async () => {
      try {
        const [threatsRes, healthRes] = await Promise.all([
          // Resolver is public / unauthed — stays on raw fetch.
          fetch(`${resolverUrl}/v1/threats/active`),
          // Health endpoint routes through fetchAuthed for consistency;
          // auth is optional here but never a liability.
          fetchAuthed(`${apiUrl}/api/v1/health`),
        ]);

        const healthParsed = await parseApiResponse(
          healthRes,
          HealthResponseSchema,
          'check_environment (health)',
        );
        if (!healthParsed.ok) return healthParsed.error;
        const health = healthParsed.data;

        const threatsParsed = await parseApiResponse(
          threatsRes,
          ThreatsResponseSchema,
          'check_environment (threats)',
        );
        // Threats endpoint failure shouldn't hide health. Render
        // health and tag the threats failure as a known_issue.
        const threats = threatsParsed.ok ? threatsParsed.data : [];
        const threatsErrorMsg = threatsParsed.ok
          ? null
          : threatsParsed.error.content[0]?.text ?? 'unknown error';

        let text = `ACR Network Status: ${health.status}`;
        if (health.freshness_seconds !== null) {
          text += `  (last aggregation ${formatFreshness(health.freshness_seconds)} ago)`;
        }
        text += '\n';

        if (health.known_issues.length > 0) {
          text += `\nKnown issues (network):\n`;
          for (const issue of health.known_issues) {
            text += `- [${issue.component}] ${issue.message}\n`;
          }
        }

        // Self-health: MCP-internal failures (probe, version-check,
        // state file I/O) that used to be silently caught. Surfaced
        // here so an operator who notices something is off has one
        // place to look. Deduplicated by component+message so a
        // hot loop doesn't produce 50 identical lines.
        const selfFailures = getRecentSelfFailures();
        if (selfFailures.length > 0) {
          const counts = new Map<string, { component: string; message: string; count: number }>();
          for (const f of selfFailures) {
            const key = `${f.component}::${f.message}`;
            const existing = counts.get(key);
            if (existing) existing.count += 1;
            else counts.set(key, { component: f.component, message: f.message, count: 1 });
          }
          text += `\nSelf-health (MCP-internal, last 24h):\n`;
          for (const f of counts.values()) {
            text += `- [${f.component}] ${f.message}`;
            if (f.count > 1) text += ` (×${f.count})`;
            text += '\n';
          }
        }

        if (threatsErrorMsg) {
          text += `\nThreat feed unreachable — ${threatsErrorMsg}\n`;
        } else if (threats.length > 0) {
          text += `\nSkills with elevated anomaly signals: ${threats.length}\n`;
          for (const t of threats) {
            text += `- ${t.skill_name || truncHash(t.skill_hash)} — ${t.anomaly_signal_count} signals, ${t.agent_count ?? 0} reporters\n`;
          }
        } else {
          text += '\nNo elevated anomaly signals observed.';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Environment check error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
