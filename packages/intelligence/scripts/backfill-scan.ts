/**
 * One-time backfill: run content security scanner on all existing skills.
 *
 * Usage: COCKROACH_CONNECTION_STRING=... npx tsx packages/intelligence/scripts/backfill-scan.ts
 * Or bundle with esbuild and run with node.
 */
import { query, execute, createLogger, scanSkillContent } from '@acr/shared';

const log = createLogger({ name: 'backfill-scan' });
const BATCH_SIZE = 50;

async function backfill() {
  log.info('Starting security scan backfill');

  const skills = await query<{
    skill_id: string;
    skill_name: string;
    skill_content: string | null;
  }>(
    `SELECT skill_id AS "skill_id", skill_name AS "skill_name",
            skill_content AS "skill_content"
     FROM skill_catalog
     WHERE scan_result IS NULL AND skill_content IS NOT NULL
     ORDER BY created_at`,
  );

  log.info({ count: skills.length }, 'Skills to scan');

  let scanned = 0;
  let flagged = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };

  for (let i = 0; i < skills.length; i += BATCH_SIZE) {
    const batch = skills.slice(i, i + BATCH_SIZE);

    for (const skill of batch) {
      if (!skill.skill_content) continue;

      const scanResult = scanSkillContent(skill.skill_content, skill.skill_name);
      scanned++;
      severityCounts[scanResult.max_severity]!++;

      if (scanResult.max_severity === 'critical' || scanResult.max_severity === 'high') {
        flagged++;
      }

      // Store raw scanner output. Status stays as-is — no derived flagging.
      await execute(
        `UPDATE skill_catalog SET
          scan_result = $1, threat_patterns = $2, scan_score = $3,
          updated_at = now()
         WHERE skill_id = $4`,
        [
          JSON.stringify(scanResult),
          scanResult.threat_patterns,
          scanResult.scan_score,
          skill.skill_id,
        ],
      );
    }

    log.info({ progress: `${Math.min(i + BATCH_SIZE, skills.length)}/${skills.length}` }, 'Batch complete');
  }

  log.info({
    scanned,
    flagged,
    severities: severityCounts,
  }, 'Backfill complete');
}

backfill().catch((err) => {
  log.error({ err }, 'Backfill failed');
  process.exit(1);
});
