// Vercel serverless catch-all entry point
// Routes all requests through the Hono app — imports the pre-bundled file
// so Vercel's file tracer doesn't need to resolve pnpm-symlinked deps.
// @ts-ignore — bundle file is generated at build time by scripts/bundle-vercel.js
export { GET, POST, PUT, DELETE, OPTIONS } from '../src/index.vercel-bundle.mjs';
