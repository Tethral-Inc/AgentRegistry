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

function wrapJob(name: string, handler: JobHandler) {
  return async (c: { json: (body: unknown, status?: number) => Response }) => {
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
      return c.json(body, result.statusCode);
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ job: name, elapsed, err: msg }, 'Cron job failed');
      await beat(name, 'error', elapsed, msg);
      return c.json({ error: msg, elapsed_ms: elapsed }, 500);
    }
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

// Phase K: Watch evaluation. Evaluates enabled watches every hour,
// writes notifications on fresh threshold crossings. Runs off the
// same `interaction_receipts` table the lenses read so the metric
// the watch sees matches what the operator sees in MCP.
app.get('/cron/watch-evaluation', wrapJob('watch-evaluation', watchEvaluation));

export { app as cronRoute };
