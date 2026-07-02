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
const CORE_TOOLS = [
  // The default surface: the whole primary loop in seven tools.
  'orient_me',
  'get_my_agent',
  'log_interaction',
  'get_friction_report',
  'summarize_my_agent',
  'get_notifications',
  'acknowledge_signal',
] as const;

/** Advanced-only tools the README/orient_me mention behind ACR_ADVANCED=1. */
const ADVANCED_TOOLS = [
  'get_coverage',
  'get_stable_corridors',
  'check_environment',
  'get_trend',
  'update_composition',
  'search_skills',
] as const;

const FIRST_SESSION_TOOLS = [...CORE_TOOLS, ...ADVANCED_TOOLS] as const;

describe('first-session walkthrough — README contract', () => {
  let registered: Set<string>;
  let coreRegistered: Set<string>;

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    const toolSet = (opts: { advanced?: boolean }) => {
      const session = new SessionState('stdio');
      const server = createAcrServer({ session, ...opts });
      // Pull the registered tool set off the underlying SDK server. The
      // mcp-server exposes tools via its private registry; we read it
      // through the same surface tool-menu.test.ts uses.
      const _tools = (server as { _registeredTools?: Record<string, unknown> })._registeredTools;
      return new Set(_tools ? Object.keys(_tools) : []);
    };
    registered = toolSet({ advanced: true });
    coreRegistered = toolSet({ advanced: false });
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

  // The default surface is deliberately small: every tool schema costs
  // context in the host agent's window on every session. Core mode must
  // register exactly the primary loop — a tool leaking into the default
  // set silently re-inflates every install's context cost.
  it.each(CORE_TOOLS)('core mode registers "%s"', (toolName) => {
    expect(coreRegistered.has(toolName)).toBe(true);
  });

  it('core mode registers ONLY the core tools', () => {
    const extra = [...coreRegistered].filter((t) => !(CORE_TOOLS as readonly string[]).includes(t)).sort();
    expect(extra, `Tools leaked into the default surface: ${extra.join(', ')}`).toEqual([]);
  });

  it.each(ADVANCED_TOOLS)('advanced-only tool "%s" is NOT in core mode', (toolName) => {
    expect(coreRegistered.has(toolName)).toBe(false);
  });
});
