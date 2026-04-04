// Vercel serverless catch-all entry point
import { handle } from 'hono/vercel';
import { app } from '../packages/ingestion-api/src/index.js';

export const config = { runtime: 'nodejs' };

const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
