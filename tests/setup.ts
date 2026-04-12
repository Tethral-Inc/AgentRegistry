/**
 * Vitest setup: stub the DB query layer when no real DB is available.
 *
 * Routes import query/queryOne/execute from @acr/shared. This mock
 * replaces those functions with stubs returning empty results, so
 * route handlers exercise their response-shape logic without a DB.
 */
import { vi } from 'vitest';

if (!process.env.COCKROACH_CONNECTION_STRING) {
  vi.mock('@acr/shared', async (importOriginal) => {
    const original = await importOriginal<typeof import('@acr/shared')>();
    return {
      ...original,
      getPool: vi.fn().mockResolvedValue(null),
      closePool: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      queryOne: vi.fn().mockResolvedValue(null),
      execute: vi.fn().mockResolvedValue(0),
    };
  });
}
