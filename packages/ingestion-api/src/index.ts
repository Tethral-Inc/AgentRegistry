import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from './middleware/request-id.js';
import { rateLimiter } from './middleware/rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';
import { registerRoute } from './routes/register.js';
import { receiptsRoute } from './routes/receipts.js';
import { compositionRoute } from './routes/composition.js';
import { frictionRoute } from './routes/friction.js';
import { skillVersionRoute } from './routes/skill-version.js';
import { healthRoute } from './routes/health.js';
import { internalQueryRoute } from './routes/internal-query.js';
import { threatFeedRoute } from './routes/threat-feed.js';
import { apiKeysRoute } from './routes/api-keys.js';
import { agentsRoute } from './routes/agents.js';
import { receiptsReadRoute } from './routes/receipts-read.js';
import { networkStatusRoute } from './routes/network-status.js';
import { networkSkillsRoute } from './routes/network-skills.js';
import { skillCatalogRoute } from './routes/skill-catalog.js';

export const app = new Hono().basePath('/');

// Global middleware
app.use('*', requestId());
app.use('*', secureHeaders());
app.use('*', cors({ origin: '*' }));
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));
app.use('/api/*', rateLimiter());

// Error handler
app.onError(errorHandler);

// API routes
app.route('/api/v1', registerRoute);
app.route('/api/v1', receiptsRoute);
app.route('/api/v1', compositionRoute);
app.route('/api/v1', frictionRoute);
app.route('/api/v1', skillVersionRoute);
app.route('/api/v1', healthRoute);
app.route('/api/v1', threatFeedRoute);
app.route('/api/v1', apiKeysRoute);
app.route('/api/v1', agentsRoute);
app.route('/api/v1', receiptsReadRoute);
app.route('/api/v1', networkStatusRoute);
app.route('/api/v1', networkSkillsRoute);
app.route('/api/v1', skillCatalogRoute);
app.route('/api', internalQueryRoute);

// Vercel serverless handler
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);

// Default export for tests and local dev
export default app;
