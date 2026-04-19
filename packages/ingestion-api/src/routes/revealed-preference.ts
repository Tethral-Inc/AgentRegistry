import { Hono } from 'hono';
import {
  RevealedPreferenceScope,
  query,
  makeError,
  createLogger,
} from '@acr/shared';

import { resolveAgentId } from '../helpers/resolve-agent.js';
import { extractBoundTargets } from '../lib/composition-targets.js';
import {
  classifyRevealedPreference,
  type RevealedPreferenceClassification as Classification,
} from '../lib/revealed-preference-classify.js';

const log = createLogger({ name: 'revealed-preference' });
const app = new Hono();

type BindingSource = 'mcp_observed' | 'agent_reported';

function getScopeWindow(scope: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (scope) {
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'day':
      start.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      break;
    case 'month':
      start.setDate(start.getDate() - 30);
      break;
    default:
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
  }

  return { start, end };
}

app.get('/agent/:agent_id/revealed-preference', async (c) => {
  const identifier = c.req.param('agent_id');
  const scopeParam = c.req.query('scope') ?? 'yesterday';

  const scopeParsed = RevealedPreferenceScope.safeParse(scopeParam);
  if (!scopeParsed.success) {
    return c.json(makeError('INVALID_INPUT', 'scope must be yesterday, day, week, or month'), 400);
  }
  const scope = scopeParsed.data;
  const { start, end } = getScopeWindow(scope);

  // Source defaults to 'agent' so the called-set reflects the agent's
  // true traffic, not observer self-log. Pass source=all to include both.
  const sourceParam = c.req.query('source') ?? 'agent';
  const sourceFilter = sourceParam === 'all' ? null : sourceParam;

  const resolved = await resolveAgentId(identifier);
  const agentId = resolved.agent_id;
  const agentName = resolved.name;

  // Run the two halves of the lens in parallel: bindings (declared) and
  // calls (actual). They're independent queries against different tables.
  const callQueryParams: unknown[] = [agentId, start.toISOString(), end.toISOString()];
  let callSourceClause = '';
  if (sourceFilter) {
    callQueryParams.push(sourceFilter);
    callSourceClause = ` AND source = $${callQueryParams.length}`;
  }

  const [bindingRows, callRows] = await Promise.all([
    query<{ source: BindingSource; composition: unknown }>(
      `SELECT source AS "source", composition AS "composition"
       FROM agent_composition_sources
       WHERE agent_id = $1`,
      [agentId],
    ).catch((err) => { log.debug({ err }, 'Failed to fetch composition sources'); return []; }),
    query<{ target_system_id: string; call_count: number; last_called: string }>(
      `SELECT target_system_id AS "target_system_id",
              COUNT(*)::int AS "call_count",
              MAX(created_at)::text AS "last_called"
       FROM interaction_receipts
       WHERE emitter_agent_id = $1
         AND created_at >= $2
         AND created_at <= $3${callSourceClause}
       GROUP BY target_system_id`,
      callQueryParams,
    ),
  ]);

  // Build: candidateSet → Set<BindingSource>
  // A target counts as bound by a source if any candidate extracted from
  // that source's composition matches the target's id or the target's bare
  // name. This is a loose match by design — composition authors are
  // inconsistent about prefixing.
  const candidatesBySource = new Map<BindingSource, Set<string>>();
  for (const row of bindingRows) {
    candidatesBySource.set(row.source, extractBoundTargets(row.composition));
  }

  function sourcesBindingTarget(targetId: string): Set<BindingSource> {
    const out = new Set<BindingSource>();
    // Also try bare name (strip type prefix) so `github` in composition
    // matches `mcp:github` in receipts.
    const bareName = targetId.includes(':') ? targetId.split(':').slice(1).join(':') : targetId;
    for (const [source, candidates] of candidatesBySource) {
      if (candidates.has(targetId) || candidates.has(bareName)) {
        out.add(source);
      }
    }
    return out;
  }

  // Union of all target_system_ids that either appear in the composition
  // (as a prefixed candidate like `mcp:github`) or show up in the call
  // history. For the composition side we only include prefixed candidates
  // — bare names are match helpers, not standalone targets.
  const allTargetIds = new Set<string>();
  for (const [, candidates] of candidatesBySource) {
    for (const cand of candidates) {
      if (/^(mcp|api|agent|skill|platform):/.test(cand)) {
        allTargetIds.add(cand);
      }
    }
  }
  const callMap = new Map<string, { call_count: number; last_called: string }>();
  for (const row of callRows) {
    allTargetIds.add(row.target_system_id);
    callMap.set(row.target_system_id, { call_count: row.call_count, last_called: row.last_called });
  }

  // Classify every target. Track summary counts and source disagreements.
  const targets: Array<{
    target_system_id: string;
    classification: Classification;
    call_count: number;
    binding_sources: BindingSource[];
    last_called: string | null;
  }> = [];

  const summary = {
    bound_targets: 0,
    called_targets: 0,
    bound_uncalled: 0,
    bound_underused: 0,
    bound_active: 0,
    called_unbound: 0,
    binding_source_disagreements: 0,
  };

  for (const targetId of allTargetIds) {
    const boundBy = sourcesBindingTarget(targetId);
    const call = callMap.get(targetId);
    const callCount = call?.call_count ?? 0;
    const classification = classifyRevealedPreference(boundBy.size > 0, callCount);

    if (boundBy.size > 0) summary.bound_targets++;
    if (callCount > 0) summary.called_targets++;
    summary[classification]++;

    // Disagreement: both sources exist, but only one binds this target.
    // Only meaningful when we have both sources recorded.
    if (candidatesBySource.size === 2 && boundBy.size === 1) {
      summary.binding_source_disagreements++;
    }

    targets.push({
      target_system_id: targetId,
      classification,
      call_count: callCount,
      binding_sources: Array.from(boundBy).sort(),
      last_called: call?.last_called ?? null,
    });
  }

  // Sort: bound_uncalled first (the loudest signal), then called_unbound
  // (drift), then by call_count desc for the rest.
  const order: Record<Classification, number> = {
    bound_uncalled: 0,
    called_unbound: 1,
    bound_underused: 2,
    bound_active: 3,
  };
  targets.sort((a, b) => {
    const d = order[a.classification] - order[b.classification];
    if (d !== 0) return d;
    return b.call_count - a.call_count;
  });

  return c.json({
    agent_id: agentId,
    name: agentName,
    scope,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    summary,
    targets,
  });
});

export { app as revealedPreferenceRoute };
