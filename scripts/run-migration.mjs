#!/usr/bin/env node
/**
 * Direct migration runner for CockroachDB (bypasses golang-migrate lock issues).
 * Usage: node scripts/run-migration.mjs <up|down> [migration_number]
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('../shared/node_modules/pg');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

const connStr = process.env.COCKROACH_CONNECTION_STRING
  || process.argv[3]
  || 'REDACTED_CONNECTION_STRING';

const direction = process.argv[2] || 'up';
const migrationNum = process.argv[4] || '000006';

const suffix = direction === 'up' ? '.up.sql' : '.down.sql';
const filename = `${migrationNum}_skill_catalog${suffix}`;
const filepath = path.join(migrationsDir, filename);

if (!fs.existsSync(filepath)) {
  console.error(`Migration file not found: ${filepath}`);
  process.exit(1);
}

const sql = fs.readFileSync(filepath, 'utf-8');

async function run() {
  const client = new pg.Client({ connectionString: connStr });
  await client.connect();
  console.log(`Connected. Running ${direction} migration ${migrationNum}...`);

  try {
    await client.query(sql);
    console.log(`Migration ${migrationNum} ${direction} completed successfully.`);

    // Update schema_migrations table
    if (direction === 'up') {
      await client.query(
        `DELETE FROM schema_migrations WHERE version = $1`,
        [parseInt(migrationNum, 10)]
      );
      await client.query(
        `INSERT INTO schema_migrations (version, dirty) VALUES ($1, false)`,
        [parseInt(migrationNum, 10)]
      );
      console.log(`schema_migrations updated to version ${migrationNum}`);
    } else {
      await client.query(
        `DELETE FROM schema_migrations WHERE version = $1`,
        [parseInt(migrationNum, 10)]
      );
      console.log(`schema_migrations: removed version ${migrationNum}`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
