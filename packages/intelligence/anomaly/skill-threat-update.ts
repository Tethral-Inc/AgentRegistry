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

interface ThreatUpdate {
  skillHash: string;
  reporterCount: number;
  anomalyCount: number;
  totalCount: number;
  anomalyRate: number;
  threatLevel: string;
}

function computeThreatLevel(reporterCount: number, anomalyRate: number): string {
  if (reporterCount >= 50 && anomalyRate >= 0.60) return 'critical';
  if (reporterCount >= 25 && anomalyRate >= 0.40) return 'high';
  if (reporterCount >= 10 && anomalyRate >= 0.25) return 'medium';
  if (reporterCount >= 3 && anomalyRate >= 0.10) return 'low';
  return 'none';
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

    // 2. Extract skill hashes from targets that are skills
    const skillSignals = new Map<string, Set<string>>();

    for (const receipt of anomalyReceipts) {
      // Direct skill targets
      if (receipt.target_system_id.startsWith('skill:')) {
        const skillHash = receipt.target_system_id.replace('skill:', '');
        if (!skillSignals.has(skillHash)) {
          skillSignals.set(skillHash, new Set());
        }
        skillSignals.get(skillHash)!.add(receipt.emitter_agent_id);
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
            if (!skillSignals.has(hash)) {
              skillSignals.set(hash, new Set());
            }
            skillSignals.get(hash)!.add(receipt.emitter_agent_id);
          }
        }
      }
    }

    // 4. Compute threat levels and upsert
    const updates: ThreatUpdate[] = [];

    for (const [skillHash, reporters] of skillSignals) {
      // Get total interaction count for this skill to compute anomaly rate
      const countResult = await query<{ total: string; anomalies: string }>(
        `SELECT COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE anomaly_flagged = true)::text AS anomalies
         FROM interaction_receipts
         WHERE target_system_id = $1
           AND created_at >= now() - INTERVAL '24 hours'`,
        [`skill:${skillHash}`],
      );

      const total = parseInt(countResult[0]?.total ?? '0', 10);
      const anomalies = parseInt(countResult[0]?.anomalies ?? '0', 10);
      const anomalyRate = total > 0 ? anomalies / total : 0;
      const threatLevel = computeThreatLevel(reporters.size, anomalyRate);

      if (threatLevel !== 'none') {
        updates.push({
          skillHash,
          reporterCount: reporters.size,
          anomalyCount: anomalies,
          totalCount: total,
          anomalyRate,
          threatLevel,
        });

        // 7. UPSERT into skill_hashes
        await execute(
          `INSERT INTO skill_hashes (skill_hash, anomaly_signal_count, anomaly_signal_rate,
           threat_level, agent_count, interaction_count, last_updated)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (skill_hash) DO UPDATE SET
             anomaly_signal_count = $2,
             anomaly_signal_rate = $3,
             threat_level = $4,
             agent_count = GREATEST(skill_hashes.agent_count, $5),
             interaction_count = GREATEST(skill_hashes.interaction_count, $6),
             last_updated = now()`,
          [skillHash, anomalies, anomalyRate, threatLevel, reporters.size, total],
        );
      }
    }

    // 9. Alert on high/critical
    const critical = updates.filter((u) => u.threatLevel === 'high' || u.threatLevel === 'critical');
    if (critical.length > 0) {
      // Enrich with catalog metadata
      const catalogLookups = new Map<string, { skill_name: string; description: string; version: string } | null>();
      for (const c of critical) {
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
            text: `ACR Threat Alert: ${critical.length} skill(s) reached high/critical threat level.\n${critical.map((c) => {
              const info = catalogLookups.get(c.skillHash);
              const label = info?.skill_name ?? c.skillHash.substring(0, 12) + '...';
              const ver = info?.version ? ` v${info.version}` : '';
              return `- *${label}*${ver} (${c.threatLevel}, ${c.reporterCount} reporters, ${(c.anomalyRate * 100).toFixed(1)}% anomaly rate)`;
            }).join('\n')}`,
          }),
        });
      }
    }

    // Notify subscribed agents
    for (const u of updates) {
      if (u.threatLevel === 'high' || u.threatLevel === 'critical') {
        const subs = await query<{ agent_id: string }>(
          `SELECT agent_id AS "agent_id" FROM skill_subscriptions
           WHERE skill_hash = $1 AND active = true`,
          [u.skillHash],
        ).catch(() => []);

        for (const sub of subs) {
          await execute(
            `INSERT INTO skill_notifications
             (agent_id, skill_hash, notification_type, severity, title, message, metadata)
             VALUES ($1, $2, 'threat_warning', $3, $4, $5, $6)`,
            [sub.agent_id, u.skillHash, u.threatLevel,
             'Threat escalation: skill flagged as ' + u.threatLevel,
             u.reporterCount + ' agents reported anomalies. Anomaly rate: ' + (u.anomalyRate * 100).toFixed(1) + '%.',
             JSON.stringify({ reporter_count: u.reporterCount, anomaly_rate: u.anomalyRate })],
          ).catch(() => {});
        }
      }
    }

    log.info({ updatedCount: updates.length, criticalCount: critical.length }, 'Threat update completed');

    return {
      statusCode: 200,
      body: JSON.stringify({ updated: updates.length, critical: critical.length }),
    };
  } catch (err) {
    log.error({ err }, 'Skill threat update failed');
    return { statusCode: 500, body: 'Internal error' };
  }
}
