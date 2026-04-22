/**
 * Snapshot helper — freeze a lens view under a short public URL.
 *
 * Phase K of the v2.5.0 – v2.9.0 roadmap. Every lens tool calls
 * `createSnapshot` at the end of its handler with the rendered
 * output + the original query args. The server persists the tuple
 * and returns a short ID; we assemble the shareable URL and the
 * caller appends a one-line footer to the text they were about to
 * return anyway.
 *
 * `ACR_DASHBOARD_URL` overrides the URL host for staging / self-
 * hosted deployments; it's the same override `dashboard-link.ts`
 * consumes for parity with the "Full view" footer.
 *
 * Silent-failure discipline: a snapshot POST can fail for a dozen
 * reasons (auth hiccup, DB hiccup, request aborted) and the lens
 * output is already computed and correct. `createSnapshot` returns
 * null on any failure and `renderSnapshotFooter` swallows null so
 * the lens renders cleanly without its share link rather than
 * failing the whole tool call over an optional footer.
 */

import { fetchAuthed } from './fetch-authed.js';

const DASHBOARD_URL = process.env.ACR_DASHBOARD_URL ?? 'https://dashboard.acr.nfkey.ai';

export type SnapshotLens =
  | 'friction'
  | 'trend'
  | 'coverage'
  | 'stable_corridors'
  | 'failure_registry'
  | 'revealed_preference'
  | 'compensation'
  | 'composition_diff'
  | 'profile';

export interface CreateSnapshotInput {
  apiUrl: string;
  agentId: string;
  lens: SnapshotLens;
  /** Original query args (scope, target filters, etc.). Stored as JSON. */
  query: Record<string, unknown>;
  /** The rendered text the lens is about to return. */
  resultText: string;
}

export interface SnapshotHandle {
  shortId: string;
  url: string;
  expiresAt: string | null;
}

export async function createSnapshot(input: CreateSnapshotInput): Promise<SnapshotHandle | null> {
  try {
    const res = await fetchAuthed(
      `${input.apiUrl}/api/v1/agent/${encodeURIComponent(input.agentId)}/snapshots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lens: input.lens,
          query: input.query,
          result_text: input.resultText,
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { short_id?: string; expires_at?: string };
    if (!data.short_id) return null;
    return {
      shortId: data.short_id,
      url: `${DASHBOARD_URL}/s/${data.short_id}`,
      expiresAt: data.expires_at ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Render the "Share this view" footer line. Returns '' on null so
 * callers can unconditionally concatenate without branching.
 */
export function renderSnapshotFooter(snapshot: SnapshotHandle | null): string {
  if (!snapshot) return '';
  return `Share this view: ${snapshot.url}\n`;
}
