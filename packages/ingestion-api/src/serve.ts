/**
 * Local development server.
 * Run with: pnpm dev
 *
 * Loads .env from repo root, starts Hono on port 3000.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { app } from './index.js';

// Load .env from repo root
config({ path: resolve(import.meta.dirname, '../../../.env') });

const port = parseInt(process.env.PORT ?? '3000', 10);

console.log(`ACR Ingestion API listening on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
