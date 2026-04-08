#!/usr/bin/env node
/**
 * General-purpose migration runner for CockroachDB.
 * Replaces golang-migrate — no pg_advisory_lock needed.
 *
 * Usage:
 *   node scripts/run-migration.mjs up          # run all pending migrations
 *   node scripts/run-migration.mjs up 3        # run next 3 pending migrations
 *   node scripts/run-migration.mjs down        # roll back last migration
 *   node scripts/run-migration.mjs down 3      # roll back last 3 migrations
 *   node scripts/run-migration.mjs force 5     # set version to 5, clear dirty flag
 *   node scripts/run-migration.mjs version     # show current version
 *   node scripts/run-migration.mjs status      # show all migrations and applied state
 *
 * Connection string resolution (first wins):
 *   1. COCKROACH_CONNECTION_STRING env var
 *   2. .env.local file in repo root
 *   3. CLI argument: --connection-string <url>
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('../shared/node_modules/pg');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const rootDir = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Connection string resolution
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^COCKROACH_CONNECTION_STRING\s*=\s*['"]?(.+?)['"]?\s*$/);
    if (match) return match[1];
  }
  return null;
}

function resolveConnectionString() {
  if (process.env.COCKROACH_CONNECTION_STRING) {
    return process.env.COCKROACH_CONNECTION_STRING;
  }
  const fromEnv = loadEnvLocal();
  if (fromEnv) return fromEnv;
  const idx = process.argv.indexOf('--connection-string');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Migration file discovery
// ---------------------------------------------------------------------------
function discoverMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    console.error(`Migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir);
  const migrations = new Map(); // version -> { version, name, upFile, downFile }

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.(up|down)\.sql$/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    const name = match[2];
    const direction = match[3];
    if (!migrations.has(version)) {
      migrations.set(version, { version, name, upFile: null, downFile: null });
    }
    const entry = migrations.get(version);
    if (direction === 'up') entry.upFile = file;
    else entry.downFile = file;
  }

  return Array.from(migrations.values()).sort((a, b) => a.version - b.version);
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      dirty BOOLEAN DEFAULT false
    )
  `);
}

async function getAppliedVersions(client) {
  const res = await client.query(
    `SELECT version, dirty FROM schema_migrations ORDER BY version`
  );
  return res.rows; // [{ version, dirty }]
}

async function getCurrentVersion(client) {
  const rows = await getAppliedVersions(client);
  if (rows.length === 0) return { version: 0, dirty: false };
  const last = rows[rows.length - 1];
  return { version: last.version, dirty: last.dirty };
}

async function markApplied(client, version) {
  await client.query(
    `INSERT INTO schema_migrations (version, dirty) VALUES ($1, false)
     ON CONFLICT (version) DO UPDATE SET dirty = false`,
    [version]
  );
}

async function markDirty(client, version) {
  await client.query(
    `INSERT INTO schema_migrations (version, dirty) VALUES ($1, true)
     ON CONFLICT (version) DO UPDATE SET dirty = true`,
    [version]
  );
}

async function removeVersion(client, version) {
  await client.query(`DELETE FROM schema_migrations WHERE version = $1`, [version]);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdUp(client, migrations, limit) {
  const applied = await getAppliedVersions(client);
  const current = await getCurrentVersion(client);

  if (current.dirty) {
    console.error(`ERROR: schema_migrations is dirty at version ${current.version}.`);
    console.error(`Fix manually, then run: node scripts/run-migration.mjs force ${current.version}`);
    process.exit(1);
  }

  const appliedSet = new Set(applied.map((r) => r.version));
  const pending = migrations.filter((m) => !appliedSet.has(m.version));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  const toRun = limit != null ? pending.slice(0, limit) : pending;
  console.log(`${toRun.length} migration(s) to apply.\n`);

  for (const m of toRun) {
    if (!m.upFile) {
      console.error(`ERROR: No up file for version ${m.version}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(path.join(migrationsDir, m.upFile), 'utf-8');
    console.log(`  -> ${m.upFile} ...`);
    try {
      await client.query(sql);
      await markApplied(client, m.version);
      console.log(`     OK`);
    } catch (err) {
      await markDirty(client, m.version);
      console.error(`     FAILED: ${err.message}`);
      console.error(`\nMigration ${m.version} marked dirty. Fix the issue, then run:`);
      console.error(`  node scripts/run-migration.mjs force ${m.version}`);
      process.exit(1);
    }
  }

  console.log(`\nDone. Current version: ${toRun[toRun.length - 1].version}`);
}

async function cmdDown(client, migrations, count) {
  const applied = await getAppliedVersions(client);
  const current = await getCurrentVersion(client);

  if (current.dirty) {
    console.error(`ERROR: schema_migrations is dirty at version ${current.version}.`);
    console.error(`Fix manually, then run: node scripts/run-migration.mjs force ${current.version}`);
    process.exit(1);
  }

  if (applied.length === 0) {
    console.log('No applied migrations to roll back.');
    return;
  }

  const appliedVersions = applied.map((r) => r.version).sort((a, b) => b - a);
  const toRollback = appliedVersions.slice(0, count);

  console.log(`Rolling back ${toRollback.length} migration(s).\n`);

  for (const version of toRollback) {
    const m = migrations.find((m) => m.version === version);
    if (!m || !m.downFile) {
      console.error(`ERROR: No down file for version ${version}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(path.join(migrationsDir, m.downFile), 'utf-8');
    console.log(`  <- ${m.downFile} ...`);
    try {
      await client.query(sql);
      await removeVersion(client, version);
      console.log(`     OK`);
    } catch (err) {
      await markDirty(client, version);
      console.error(`     FAILED: ${err.message}`);
      console.error(`\nMigration ${version} marked dirty. Fix the issue, then run:`);
      console.error(`  node scripts/run-migration.mjs force ${version}`);
      process.exit(1);
    }
  }

  const remaining = await getCurrentVersion(client);
  console.log(`\nDone. Current version: ${remaining.version}`);
}

async function cmdForce(client, version) {
  // Clear all dirty flags first, then ensure this version is set clean
  await client.query(`DELETE FROM schema_migrations WHERE dirty = true`);
  if (version > 0) {
    await markApplied(client, version);
  }
  console.log(`Forced version to ${version}, dirty flag cleared.`);
}

async function cmdVersion(client) {
  const { version, dirty } = await getCurrentVersion(client);
  console.log(`Version: ${version}${dirty ? ' (dirty)' : ''}`);
}

async function cmdStatus(client, migrations) {
  const applied = await getAppliedVersions(client);
  const appliedMap = new Map(applied.map((r) => [r.version, r]));

  console.log('Migration Status:\n');
  console.log('  Version  | Applied | Dirty | Name');
  console.log('  ---------+---------+-------+------------------------------');

  for (const m of migrations) {
    const row = appliedMap.get(m.version);
    const appliedStr = row ? 'yes' : 'no ';
    const dirtyStr = row?.dirty ? 'YES ' : '    ';
    const versionStr = String(m.version).padStart(6, '0');
    console.log(`  ${versionStr}   | ${appliedStr}     | ${dirtyStr}  | ${m.name}`);
  }

  const current = await getCurrentVersion(client);
  console.log(`\n  Current version: ${current.version}${current.dirty ? ' (DIRTY)' : ''}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const command = args[0];
  const arg = args[1];

  if (!command || ['help', '-h', '--help'].includes(command)) {
    console.log(`
Usage: node scripts/run-migration.mjs <command> [arg]

Commands:
  up [N]          Run all (or next N) pending migrations
  down [N]        Roll back last (or last N) migration(s)  [default N=1]
  force VERSION   Set schema_migrations to VERSION, clear dirty flag
  version         Show current migration version
  status          Show all migrations and applied state
`);
    process.exit(0);
  }

  const connStr = resolveConnectionString();
  if (!connStr) {
    console.error('ERROR: No connection string found.');
    console.error('Set COCKROACH_CONNECTION_STRING, add it to .env.local, or pass --connection-string <url>');
    process.exit(1);
  }

  const migrations = discoverMigrations();
  const client = new pg.Client({ connectionString: connStr });

  try {
    await client.connect();
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    process.exit(1);
  }

  try {
    await ensureSchemaMigrationsTable(client);

    switch (command) {
      case 'up':
        await cmdUp(client, migrations, arg ? parseInt(arg, 10) : null);
        break;
      case 'down':
        await cmdDown(client, migrations, arg ? parseInt(arg, 10) : 1);
        break;
      case 'force': {
        if (arg == null) {
          console.error('Usage: force <VERSION>');
          process.exit(1);
        }
        await cmdForce(client, parseInt(arg, 10));
        break;
      }
      case 'version':
        await cmdVersion(client);
        break;
      case 'status':
        await cmdStatus(client, migrations);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main();
