/**
 * Bundle each Lambda function into a self-contained zip.
 * Each function gets its own directory under dist/functions/
 * with an index.js entry point that AWS Lambda can invoke.
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distFunctions = resolve(root, 'dist/functions');

const functions = [
  { name: 'health-check', entry: 'health/index.ts' },
  { name: 'partition-creator', entry: 'maintenance/partition-creator.ts' },
  { name: 'skill-threat-update', entry: 'anomaly/skill-threat-update.ts' },
  { name: 'system-health-aggregate', entry: 'anomaly/system-health-aggregate.ts' },
  { name: 'friction-baseline-compute', entry: 'anomaly/friction-baseline-compute.ts' },
  { name: 'clawhub-crawl', entry: 'maintenance/clawhub-crawl.ts' },
  { name: 'agent-expiration', entry: 'maintenance/agent-expiration.ts' },
  { name: 'data-archival', entry: 'maintenance/data-archival.ts' },
];

async function bundleAll() {
  mkdirSync(distFunctions, { recursive: true });

  for (const fn of functions) {
    const outdir = resolve(distFunctions, fn.name);
    mkdirSync(outdir, { recursive: true });

    const entryPoint = resolve(root, fn.entry);
    if (!existsSync(entryPoint)) {
      console.log(`  Skipping ${fn.name} (entry not found: ${fn.entry})`);
      continue;
    }

    await build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: resolve(outdir, 'index.js'),
      external: ['pg-native'],
      banner: {
        js: `
          import { createRequire } from 'module';
          const require = createRequire(import.meta.url);
        `,
      },
    });

    // Create zip for Lambda deployment
    execSync(`cd "${outdir}" && tar -cf "${resolve(distFunctions, fn.name + '.zip')}" index.js`, {
      stdio: 'pipe',
    });

    console.log(`  Bundled ${fn.name}`);
  }

  console.log(`\nBundled ${functions.length} Lambda functions`);
}

bundleAll().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
