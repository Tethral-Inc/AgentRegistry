import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { app } from '../packages/ingestion-api/src/index.js';

// Re-export Vercel handlers - direct hono import satisfies framework detection
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);

// Satisfy Vercel's entrypoint detection
export default app;
