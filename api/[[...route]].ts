// Vercel serverless catch-all entry point
// Re-exports the Hono app from packages/ingestion-api
export { GET, POST, PUT, DELETE, OPTIONS } from '../packages/ingestion-api/src/index.js';
