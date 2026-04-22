/**
 * Dashboard-link footer helper.
 *
 * Every lens tool ends its output with a link to the corresponding
 * dashboard view so the operator can pivot from "I saw the summary in
 * my terminal" to "now I want to drill in." The URL is honest — it
 * points at the same agent + lens + scope the MCP just rendered.
 *
 * `ACR_DASHBOARD_URL` override exists for staging and self-hosted
 * deployments. Keeps parity with `get_my_agent`'s dashboard link.
 */

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard.acr.nfkey.ai';

/** Lens segment used in the dashboard URL path. Matches the dashboard's own routes. */
export type DashboardLens =
  | 'overview'
  | 'friction'
  | 'trend'
  | 'coverage'
  | 'failure-registry'
  | 'stable-corridors'
  | 'network-status'
  | 'revealed-preference'
  | 'compensation'
  | 'profile'
  | 'skills'
  | 'notifications';

export interface DashboardLinkOptions {
  /** Optional scope/range passed to the dashboard view. */
  range?: string;
  /** Optional signal source ('agent' | 'server' | 'all'). */
  source?: string;
}

/**
 * Build the dashboard URL for a given agent + lens. Returns a URL string,
 * not a full render — the caller decides where to place it.
 */
export function dashboardUrl(
  agentId: string,
  lens: DashboardLens,
  opts: DashboardLinkOptions = {},
): string {
  const q = new URLSearchParams();
  if (opts.range) q.set('range', opts.range);
  if (opts.source) q.set('source', opts.source);
  const qs = q.toString();
  const suffix = qs ? `?${qs}` : '';
  return `${DASHBOARD_URL}/agents/${encodeURIComponent(agentId)}/${lens}${suffix}`;
}

/**
 * Render the standardized "Full view" footer line that every lens tool
 * appends to its output. Returns an empty string if agentId is missing,
 * so callers can unconditionally concatenate.
 */
export function renderDashboardFooter(
  agentId: string | null | undefined,
  lens: DashboardLens,
  opts: DashboardLinkOptions = {},
): string {
  if (!agentId) return '';
  return `\nFull view: ${dashboardUrl(agentId, lens, opts)}\n`;
}
