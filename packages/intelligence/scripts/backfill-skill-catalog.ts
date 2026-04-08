/**
 * One-time backfill script: creates skill_catalog entries from existing
 * skill_hashes rows and links them via catalog_skill_id.
 *
 * Usage: npx tsx packages/intelligence/scripts/backfill-skill-catalog.ts
 */
import { query, queryOne, execute, createLogger } from '@acr/shared';

const log = createLogger({ name: 'backfill-skill-catalog' });

async function backfill() {
  log.info('Starting skill catalog backfill');

  const skills = await query<{
    skill_hash: string;
    skill_name: string;
    skill_source: string;
  }>(
    `SELECT skill_hash AS "skill_hash", skill_name AS "skill_name",
            skill_source AS "skill_source"
     FROM skill_hashes
     WHERE skill_name IS NOT NULL AND skill_source IS NOT NULL
       AND catalog_skill_id IS NULL`,
  );

  log.info({ count: skills.length }, 'Found skill_hashes to backfill');

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const skill of skills) {
    // Derive source URL
    let sourceUrl: string;
    switch (skill.skill_source) {
      case 'clawhub':
        sourceUrl = `https://clawhub.ai/skills/${skill.skill_name}/SKILL.md`;
        break;
      default:
        sourceUrl = `https://${skill.skill_source}/skills/${skill.skill_name}/SKILL.md`;
    }

    // Check if catalog entry already exists
    const existing = await queryOne<{ skill_id: string }>(
      `SELECT skill_id AS "skill_id" FROM skill_catalog
       WHERE skill_name = $1 AND skill_source = $2`,
      [skill.skill_name, skill.skill_source],
    );

    let skillId: string;

    if (existing) {
      skillId = existing.skill_id;
      skipped++;
    } else {
      // Create catalog entry
      const row = await queryOne<{ skill_id: string }>(
        `INSERT INTO skill_catalog (skill_name, skill_source, source_url, current_hash, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING skill_id AS "skill_id"`,
        [skill.skill_name, skill.skill_source, sourceUrl, skill.skill_hash],
      );

      if (!row) {
        log.warn({ skill: skill.skill_name }, 'Failed to create catalog entry');
        continue;
      }
      skillId = row.skill_id;
      created++;

      // Create initial version history
      await execute(
        `INSERT INTO skill_version_history (skill_id, skill_hash, change_type)
         VALUES ($1, $2, 'initial')`,
        [skillId, skill.skill_hash],
      );
    }

    // Link skill_hashes to catalog
    await execute(
      `UPDATE skill_hashes SET catalog_skill_id = $1 WHERE skill_hash = $2`,
      [skillId, skill.skill_hash],
    );
    linked++;
  }

  log.info({ created, linked, skipped }, 'Backfill completed');
}

backfill().catch((err) => {
  log.error({ err }, 'Backfill failed');
  process.exit(1);
});
