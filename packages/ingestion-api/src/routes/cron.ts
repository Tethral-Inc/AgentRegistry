/**
 * Cron routes — thin wrappers around intelligence job handlers.
 * Vercel cron invokes these on schedule. Protected by CRON_SECRET.
 */
import { Hono } from 'hono';
import { cronAuth } from '../middleware/cron-auth.js';
import { createLogger } from '@acr/shared';

import {
  systemHealthAggregate,
  chainAnalysis,
  skillThreatUpdate,
  frictionBaselineCompute,
  agentExpiration,
  dataArchival,
  agentBaselineCompute,
  agentAnomalyDetect,
} from '@acr/intelligence';

const log = createLogger({ name: 'cron' });
const app = new Hono();

app.use('/cron/*', cronAuth);

type JobHandler = () => Promise<{ statusCode: number; body: string }>;

function wrapJob(name: string, handler: JobHandler) {
  return async (c: { json: (body: unknown, status?: number) => Response }) => {
    const start = Date.now();
    log.info({ job: name }, 'Cron job started');
    try {
      const result = await handler();
      const elapsed = Date.now() - start;
      log.info({ job: name, elapsed, statusCode: result.statusCode }, 'Cron job completed');
      let body: unknown;
      try { body = JSON.parse(result.body); } catch { body = { message: result.body }; }
      return c.json(body, result.statusCode);
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error({ job: name, elapsed, err: msg }, 'Cron job failed');
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

export { app as cronRoute };
