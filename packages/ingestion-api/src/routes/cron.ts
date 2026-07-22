/**
 * Cron routes — thin wrappers around intelligence job handlers.
 * Vercel cron invokes these on schedule. Protected by CRON_SECRET.
 */
import { Hono } from 'hono';
import { cronAuth } from '../middleware/cron-auth.js';
import { createLogger, execute } from '@acr/shared';

import {
  systemHealthAggregate,
  chainAnalysis,
  skillThreatUpdate,
  frictionBaselineCompute,
  agentExpiration,
  dataArchival,
  agentBaselineCompute,
  agentAnomalyDetect,
  patternDetection,
  watchEvaluation,
  anomalyCorrelation,
} from '@acr/intelligence';

const log = createLogger({ name: 'cron' });
const app = new Hono();

app.use('/cron/*', cronAuth);

type JobHandler = () => Promise<{ statusCode: number; body: string }>;

// Heartbeat: every run (success or failure) is recorded so freshness probes
// can tell "pipeline broken" from "pipeline fine, network quiet". Best-effort:
// a heartbeat failure (e.g. migration 000025 not yet applied) must never fail
// the job itself.
async function beat(name: string, status: string, elapsedMs: number, result: string | null): Promise<void> {
  await execute(
    `INSERT INTO job_heartbeats (job_name, last_run_at, last_status, elapsed_ms, last_result)
     VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (job_name) DO UPDATE SET
       last_run_at = now(), last_status = $2, elapsed_ms = $3, last_result = $4`,
    [name, status, elapsedMs, result ? result.slice(0, 512) : null],
  ).catch((err) => { log.warn({ err, job: name }, 'job heartbeat upsert failed'); });
}

interface JobRun {
  job: string;
  statusCode: number;
  elapsed_ms: number;
  /** Parsed handler output, or `{ error }` when the handler threw. */
  body: unknown;
}

/**
 * Run one job and record its heartbeat. Shared by the per-job routes and by
 * the consolidated daily tick so both paths write identical heartbeats —
 * otherwise freshness would depend on which scheduler happened to invoke it.
 */
async function runJob(name: string, handler: JobHandler): Promise<JobRun> {
  const start = Date.now();
  log.info({ job: name }, 'Cron job started');
  try {
    const result = await handler();
    const elapsed = Date.now() - start;
    log.info({ job: name, elapsed, statusCode: result.statusCode }, 'Cron job completed');
    // Awaited: Vercel can freeze the function once the response returns,
    // so a fire-and-forget heartbeat would be silently dropped.
    await beat(name, result.statusCode < 300 ? 'ok' : `http_${result.statusCode}`, elapsed, result.body);
    let body: unknown;
    try { body = JSON.parse(result.body); } catch { body = { message: result.body }; }
    return { job: name, statusCode: result.statusCode, elapsed_ms: elapsed, body };
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ job: name, elapsed, err: msg }, 'Cron job failed');
    await beat(name, 'error', elapsed, msg);
    return { job: name, statusCode: 500, elapsed_ms: elapsed, body: { error: msg } };
  }
}

function wrapJob(name: string, handler: JobHandler) {
  return async (c: { json: (body: unknown, status?: number) => Response }) => {
    const run = await runJob(name, handler);
    return c.json(run.body, run.statusCode);
  };
}

// Phase 1: Unblock lens data
app.get('/cron/system-health-aggregate', wrapJob('system-health-aggregate', systemHealthAggregate));
app.get('/cron/chain-analysis', wrapJob('chain-analysis', chainAnalysis));
app.get('/cron/skill-threat-update', wrapJob('skill-threat-update', skillThreatUpdate));
app.get('/cron/friction-baseline-compute', wrapJob('friction-baseline-compute', frictionBaselineCompute));

// Phase 2: Housekeeping
app.get('/cron/agent-expiration', wrapJob('agent-expiration', agentExpiration));
app.get('/cron/data-archival', wrapJob('data-archival', dataArchival));

// Phase 3: Anomaly-on-ingest (shadow mode). Baselines recomputed hourly,
// detection runs on the schedule the external caller picks (15 min).
app.get('/cron/agent-baseline-compute', wrapJob('agent-baseline-compute', agentBaselineCompute));
app.get('/cron/agent-anomaly-detect', wrapJob('agent-anomaly-detect', agentAnomalyDetect));

// Phase J: Proactive pattern surfacing. Detects 4 named patterns per
// active agent hourly; MCP tools read from `agent_patterns` and render
// a "Things we noticed" section.
app.get('/cron/pattern-detection', wrapJob('pattern-detection', patternDetection));

// Phase L: Cross-agent anomaly correlation. Clusters last-6h anomaly receipts
// by target and writes daily_summaries[entity_type='correlation'] escalations,
// which network-status reads for "Recent cross-agent escalations". Previously
// unscheduled (orphaned from the retired Lambda pipeline) → that section was
// always empty. Reads the same interaction_receipts the other lenses read.
app.get('/cron/anomaly-correlation', wrapJob('anomaly-correlation', anomalyCorrelation));

// Phase K: Watch evaluation. Evaluates enabled watches every hour,
// writes notifications on fresh threshold crossings. Runs off the
// same `interaction_receipts` table the lenses read so the metric
// the watch sees matches what the operator sees in MCP.
app.get('/cron/watch-evaluation', wrapJob('watch-evaluation', watchEvaluation));

/**
 * Consolidated daily tick — the single scheduler entry point.
 *
 * Every job above used to need its own cron line. That worked only on a plan
 * with unlimited crons and minute granularity, and it spread the schedule
 * across a repo-root vercel.json whose `crons` never registered (the deploy
 * ships from packages/ingestion-api) plus a GitHub Actions workflow that fired
 * hours late under throttle and was one commented-out block away from silently
 * freezing every lens. One daily cron hitting one endpoint runs anywhere,
 * including plans capped at 2 daily crons.
 *
 * Ordered by data dependency: rollups first, then things that read rollups,
 * then baselines, then retention housekeeping.
 *
 * Failure isolation: each job is independent, so one failure must not skip the
 * rest — every job runs, each writes its own heartbeat, and the response
 * reports per-job status. Overall status is 207 if any job failed, so a
 * scheduler that only checks the HTTP code still notices.
 */
const DAILY_TICK_JOBS: Array<[string, JobHandler]> = [
  ['system-health-aggregate', systemHealthAggregate],
  ['chain-analysis', chainAnalysis],
  ['skill-threat-update', skillThreatUpdate],
  ['agent-baseline-compute', agentBaselineCompute],
  ['agent-anomaly-detect', agentAnomalyDetect],
  ['anomaly-correlation', anomalyCorrelation],
  ['pattern-detection', patternDetection],
  ['watch-evaluation', watchEvaluation],
  ['friction-baseline-compute', frictionBaselineCompute],
  ['agent-expiration', agentExpiration],
  ['data-archival', dataArchival],
];

/**
 * Stop starting new jobs past this point so the response (and the tick's own
 * heartbeat) still lands inside the function's maxDuration. A tick that gets
 * killed mid-run writes no summary at all, which is the one outcome that would
 * reintroduce "why is the pipeline silent?".
 */
const DAILY_TICK_BUDGET_MS = 240_000;

app.get('/cron/daily-tick', async (c) => {
  const start = Date.now();
  const runs: JobRun[] = [];
  const skipped: string[] = [];

  for (const [name, handler] of DAILY_TICK_JOBS) {
    if (Date.now() - start > DAILY_TICK_BUDGET_MS) {
      skipped.push(name);
      continue;
    }
    runs.push(await runJob(name, handler));
  }

  const failed = runs.filter((r) => r.statusCode >= 300).map((r) => r.job);
  const elapsed = Date.now() - start;
  const summary = {
    ran: runs.length,
    failed,
    // Never silently truncate: a short tick must say what it did not reach.
    skipped_for_time: skipped,
    elapsed_ms: elapsed,
    jobs: runs,
  };

  if (skipped.length > 0) {
    log.warn({ skipped, elapsed }, 'daily-tick ran out of time budget');
  }

  // The tick's own heartbeat: distinguishes "the scheduler never fired" from
  // "the scheduler fired and the jobs failed" — job_schedules declares it too.
  await beat(
    'daily-tick',
    failed.length === 0 && skipped.length === 0 ? 'ok' : `partial_${failed.length + skipped.length}`,
    elapsed,
    JSON.stringify({ ran: runs.length, failed, skipped_for_time: skipped }),
  );

  return c.json(summary, failed.length > 0 || skipped.length > 0 ? 207 : 200);
});

export { app as cronRoute };
