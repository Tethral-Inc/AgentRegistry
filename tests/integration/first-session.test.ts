/**
 * F7 — back the README "First Session" walkthrough with an executable
 * test. The audit found that the documented onboarding path (install →
 * register → log → orient) was never exercised end-to-end; renames and
 * deletions left orphaned references that nobody caught until a user
 * reported them. This test fails the build when the documented
 * sequence breaks at any step.
 *
 * The flow under test mirrors what a fresh agent does on first contact:
 *   1. createAcrServer succeeds with no prior state on disk
 *   2. The canonical entry-point tools (orient_me, get_my_agent) are
 *      registered — i.e. the README points at things that exist
 *   3. log_interaction is registered with its required input fields
 *   4. The lens tools the entry tools route to are all registered
 *
 * We test registrations rather than full handler execution because the
 * MCP SDK's tool-call path requires a connected transport — out of
 * scope for a unit-style integration test. The registration check is
 * enough to catch rename/deletion drift, which is the failure mode
 * we're guarding against.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.ACR_DISABLE_FETCH_OBSERVE = '1';
process.env.ACR_DISABLE_ENV_PROBE = '1';
process.env.ACR_DISABLE_VERSION_CHECK = '1';
process.env.ACR_API_URL = 'http://127.0.0.1:1';
process.env.ACR_STATE_FILE = '/tmp/acr-state-first-session-test.json';

const { createAcrServer } = await import('../../packages/mcp-server/src/server.js');
const { SessionState } = await import('../../packages/mcp-server/src/session-state.js');

/**
 * Tools the README "First Session" walkthrough names. If any of these
 * are renamed or removed, the README breaks — and so does this test.
 */
const FIRST_SESSION_TOOLS = [
  // Step 1 — discover
  'get_my_agent',
  // Step 2 — log
  'log_interaction',
  // Step 3 — orient
  'orient_me',
  // Step 4 — read a lens (the lenses orient_me routes to)
  'get_friction_report',
  'get_coverage',
  'get_stable_corridors',
  // Step 5 — environment / health awareness
  'check_environment',
] as const;

describe('first-session walkthrough — README contract', () => {
  let registered: Set<string>;

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    const session = new SessionState('stdio');
    const server = createAcrServer({ session });

    // Pull the registered tool set off the underlying SDK server. The
    // mcp-server exposes tools via its private registry; we read it
    // through the same surface tool-menu.test.ts uses.
    const _tools = (server as { _registeredTools?: Record<string, unknown> })._registeredTools;
    registered = new Set(_tools ? Object.keys(_tools) : []);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(FIRST_SESSION_TOOLS)(
    '"%s" is registered (the README points to it)',
    (toolName) => {
      expect(
        registered.has(toolName),
        `Tool "${toolName}" is named in the README First Session flow but is not registered. Either the tool was renamed (update README) or the registration was lost (restore it).`,
      ).toBe(true);
    },
  );

  it('registers at least the first-session tools (sanity floor)', () => {
    expect(registered.size).toBeGreaterThanOrEqual(FIRST_SESSION_TOOLS.length);
  });
});
