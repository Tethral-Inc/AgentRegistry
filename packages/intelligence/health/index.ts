import { query } from '@acr/shared';
import { createLogger } from '@acr/shared';

const log = createLogger({ name: 'acr-health-check' });

interface HealthCheckEvent {
  source: string;
}

export async function handler(event: HealthCheckEvent) {
  const checks: Record<string, string> = {};

  try {
    await query('SELECT 1');
    checks.database = 'connected';
  } catch (err) {
    checks.database = 'failed';
    log.error({ err }, 'Database health check failed');
  }

  try {
    const apiUrl = process.env.ACR_API_URL;
    if (apiUrl) {
      const res = await fetch(`${apiUrl}/api/v1/health`);
      checks.ingestion_api = res.ok ? 'healthy' : `status_${res.status}`;
    }
  } catch (err) {
    checks.ingestion_api = 'unreachable';
    log.error({ err }, 'Ingestion API health check failed');
  }

  const allHealthy = Object.values(checks).every(
    (v) => v === 'connected' || v === 'healthy',
  );

  if (!allHealthy) {
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      try {
        await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `ACR Health Check Failed: ${JSON.stringify(checks)}`,
          }),
        });
      } catch (err) {
        log.error({ err }, 'Failed to send Slack alert');
      }
    }
  }

  log.info({ checks, healthy: allHealthy }, 'Health check completed');

  return {
    statusCode: allHealthy ? 200 : 503,
    body: JSON.stringify({ status: allHealthy ? 'ok' : 'degraded', checks }),
  };
}
