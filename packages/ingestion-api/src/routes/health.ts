import { Hono } from 'hono';
import { query, makeError } from '@acr/shared';

const app = new Hono();

app.get('/health', async (c) => {
  try {
    await query('SELECT 1');
    return c.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    return c.json(
      makeError('INTERNAL_ERROR', 'Database connection failed'),
      503,
    );
  }
});

export { app as healthRoute };
