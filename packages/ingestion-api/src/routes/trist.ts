import { Hono } from 'hono';
import { makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'trist' });
const app = new Hono();

app.post('/trist/submit', async (c) => {
  let body: Record<string, unknown>;
  try { body = await c.req.json() as Record<string, unknown>; }
  catch { return c.json(makeError('INVALID_INPUT', 'JSON required'), 400); }

  if (!body.agent_id || !body.window_start || !body.window_end || !body.receipts) {
    return c.json(makeError('INVALID_INPUT', 'Missing: agent_id, window_start, window_end, receipts'), 400);
  }

  log.info({ agent_id: body.agent_id, receipt_count: (body.receipts as unknown[])?.length }, 'TriST submission received');

  return c.json({
    status: 'accepted',
    message: 'TriST pipeline not yet connected. Submission logged for future processing.',
    agent_id: body.agent_id,
    receipt_count: (body.receipts as unknown[])?.length ?? 0,
  }, 202);
});

app.get('/agent/:id/trist-report', async (c) => {
  const agentId = c.req.param('id');
  return c.json({
    agent_id: agentId,
    status: 'unavailable',
    message: 'TriST analysis not yet available. This endpoint will return deformation profiles, interaction shapes, and response geometry when the TriST pipeline is connected.',
    results: [],
  });
});

export { app as tristRoute };
