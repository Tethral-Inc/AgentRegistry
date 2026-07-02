import { query, queryOne, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'skill-threat-update' });

interface AnomalyRow {
  target_system_id: string;
  emitter_agent_id: string;
  emitter_composition_hash: string | null;
}

interface CompositionRow {
  component_hashes: string[];
}

interface SignalUpdate {
  skillHash: string;
  reporterCount: number;
  anomalyCount: number;
  totalCount: number;
  anomalyRate: number;
}

export async function handler() {
  try {
    // 1. Query anomaly-flagged receipts from last 24 hours
    const anomalyReceipts = await query<AnomalyRow>(
      `SELECT target_system_id AS "target_system_id",
              emitter_agent_id AS "emitter_agent_id",
              emitter_composition_hash AS "emitter_composition_hash"
       FROM interaction_receipts
       WHERE anomaly_flagged = true
         AND created_at >= now() - INTERVAL '24 hours'`,
    );

    if (anomalyReceipts.length === 0) {
      log.info('No anomaly receipts in last 24 hours');
      return { statusCode: 200, body: JSON.stringify({ updated: 0 }) };
    }

    // 2. Extract skill identities from targets that are skills.
    //
    // Skill identity contract: SHA-256 hashes are canonical. Receipt targets
    // arrive as `skill:<name>` (agents log human names) while subscriptions
    // (skill_subscriptions.skill_hash, auto-created at registration from
    // composition.skill_hashes) are keyed by hash. Before this resolution
    // step, name-keyed signals could never match a hash-keyed subscription,
    // so the "we notify agents whose composition is affected" promise never
    // fired for receipt-driven signals. Names resolve through skill_catalog
    // (the crawler's name→current_hash mapping); unresolvable names keep the
    // raw name as their key — still observed and counted, just not
    // notification-capable — and are reported in the job result.
    const HEX64 = /^[0-9a-f]{64}$/i;
    const rawSkillTargets = new Map<string, { reporters: Set<string>; targetIds: Set<string> }>();
    const addSignal = (key: string, agentId: string, targetId?: string) => {
      let entry = rawSkillTargets.get(key);
      if (!entry) {
        entry = { reporters: new Set(), targetIds: new Set() };
        rawSkillTargets.set(key, entry);
      }
      entry.reporters.add(agentId);
      if (targetId) entry.targetIds.add(targetId);
    };

    // Resolve every named (non-hash) skill target in one round trip.
    const namedTargets = [...new Set(
      anomalyReceipts
        .map((r) => r.target_system_id)
        .filter((t) => t.startsWith('skill:'))
        .map((t) => t.slice('skill:'.length))
        .filter((k) => !HEX64.test(k)),
    )];
    const nameToHash = new Map<string, string>();
    if (namedTargets.length > 0) {
      const catalogRows = await query<{ skill_name: string; current_hash: string }>(
        `SELECT skill_name AS "skill_name", current_hash AS "current_hash"
         FROM skill_catalog
         WHERE skill_name = ANY($1) AND current_hash IS NOT NULL`,
        [namedTargets],
      ).catch(() => []);
      for (const row of catalogRows) nameToHash.set(row.skill_name, row.current_hash);
    }
    const unresolvedNames = namedTargets.filter((n) => !nameToHash.has(n));
    if (unresolvedNames.length > 0) {
      log.warn({ unresolvedNames }, 'skill targets not resolvable to a catalog hash — observed but not notification-capable');
    }

    for (const receipt of anomalyReceipts) {
      // Direct skill targets
      if (receipt.target_system_id.startsWith('skill:')) {
        const rawKey = receipt.target_system_id.slice('skill:'.length);
        const key = HEX64.test(rawKey) ? rawKey : (nameToHash.get(rawKey) ?? rawKey);
        addSignal(key, receipt.emitter_agent_id, receipt.target_system_id);
      }

      // 3. Also look up composition snapshots for the emitter's skills
      if (receipt.emitter_composition_hash) {
        const snapshots = await query<CompositionRow>(
          `SELECT component_hashes AS "component_hashes"
           FROM composition_snapshots
           WHERE composition_hash = $1
           LIMIT 1`,
          [receipt.emitter_composition_hash],
        );

        if (snapshots.length > 0) {
          for (const hash of snapshots[0]!.component_hashes) {
            addSignal(hash, receipt.emitter_agent_id);
          }
        }
      }
    }

    // 4. Compute raw signal counts and upsert
    const updates: SignalUpdate[] = [];

    for (const [skillHash, { reporters, targetIds }] of rawSkillTargets) {
      // Get total interaction count for this skill to compute anomaly rate.
      // Count by the ORIGINAL receipt target ids (skill:<name> and/or
      // skill:<hash>) — receipts logged under a name would never match a
      // `skill:<hash>` lookup after resolution.
      const countTargets = targetIds.size > 0 ? [...targetIds] : [`skill:${skillHash}`];
      const countResult = await query<{ total: string; anomalies: string }>(
        `SELECT COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE anomaly_flagged = true)::text AS anomalies
         FROM interaction_receipts
         WHERE target_system_id = ANY($1)
           AND created_at >= now() - INTERVAL '24 hours'`,
        [countTargets],
      );

      const total = parseInt(countResult[0]?.total ?? '0', 10);
      const anomalies = parseInt(countResult[0]?.anomalies ?? '0', 10);
      const anomalyRate = total > 0 ? anomalies / total : 0;

      if (anomalies > 0) {
        updates.push({
          skillHash,
          reporterCount: reporters.size,
          anomalyCount: anomalies,
          totalCount: total,
          anomalyRate,
        });

        // UPSERT raw signal counts into skill_hashes — no synthetic label
        await execute(
          `INSERT INTO skill_hashes (skill_hash, anomaly_signal_count, anomaly_signal_rate,
           agent_count, interaction_count, last_updated)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (skill_hash) DO UPDATE SET
             anomaly_signal_count = $2,
             anomaly_signal_rate = $3,
             agent_count = GREATEST(skill_hashes.agent_count, $4),
             interaction_count = GREATEST(skill_hashes.interaction_count, $5),
             last_updated = now()`,
          [skillHash, anomalies, anomalyRate, reporters.size, total],
        );
      }
    }

    // Notify subscribed agents when signal counts are elevated
    // (using raw thresholds: 25+ reporters AND 40%+ anomaly rate)
    const elevated = updates.filter((u) => u.reporterCount >= 25 && u.anomalyRate >= 0.40);
    if (elevated.length > 0) {
      const catalogLookups = new Map<string, { skill_name: string; description: string; version: string } | null>();
      for (const c of elevated) {
        const catalogInfo = await queryOne<{ skill_name: string; description: string; version: string }>(
          `SELECT skill_name AS "skill_name", description AS "description", version AS "version"
           FROM skill_catalog WHERE current_hash = $1 LIMIT 1`,
          [c.skillHash],
        ).catch(() => null);
        catalogLookups.set(c.skillHash, catalogInfo ?? null);
      }

      const slackUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackUrl) {
        await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `ACR Signal Alert: ${elevated.length} skill(s) with elevated anomaly signals.\n${elevated.map((c) => {
              const info = catalogLookups.get(c.skillHash);
              const label = info?.skill_name ?? c.skillHash.substring(0, 12) + '...';
              const ver = info?.version ? ` v${info.version}` : '';
              return `- *${label}*${ver} (${c.reporterCount} reporters, ${(c.anomalyRate * 100).toFixed(1)}% anomaly rate)`;
            }).join('\n')}`,
          }),
        });
      }
    }

    // Notify subscribed agents
    for (const u of elevated) {
      const subs = await query<{ agent_id: string }>(
        `SELECT agent_id AS "agent_id" FROM skill_subscriptions
         WHERE skill_hash = $1 AND active = true`,
        [u.skillHash],
      ).catch(() => []);

      for (const sub of subs) {
        await execute(
          `INSERT INTO skill_notifications
           (agent_id, skill_hash, notification_type, severity, title, message, metadata)
           VALUES ($1, $2, 'anomaly_signal', $3, $4, $5, $6)`,
          [sub.agent_id, u.skillHash,
           String(u.reporterCount) + '_reporters_' + (u.anomalyRate * 100).toFixed(0) + 'pct',
           u.reporterCount + ' reporters, ' + (u.anomalyRate * 100).toFixed(1) + '% anomaly rate',
           u.reporterCount + ' agents reported anomalies across ' + u.totalCount + ' interactions. Anomaly rate: ' + (u.anomalyRate * 100).toFixed(1) + '%.',
           JSON.stringify({ reporter_count: u.reporterCount, anomaly_rate: u.anomalyRate, anomaly_count: u.anomalyCount, total_count: u.totalCount })],
        ).catch((err) => { log.debug({ err }, 'Failed to create agent notification'); });
      }
    }

    log.info(
      { updatedCount: updates.length, elevatedCount: elevated.length, unresolvedNames: unresolvedNames.length },
      'Skill signal update completed',
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        updated: updates.length,
        elevated: elevated.length,
        unresolved_skill_names: unresolvedNames.length,
      }),
    };
  } catch (err) {
    log.error({ err }, 'Skill signal update failed');
    const msg = err instanceof Error ? err.message : 'Unknown error'; return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
