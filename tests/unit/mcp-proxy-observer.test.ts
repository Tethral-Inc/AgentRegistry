import { describe, it, expect, vi } from 'vitest';
import { createStreamTap, splitLines } from '../../packages/acr-mcp-proxy/src/observer.js';

describe('splitLines', () => {
  it('splits complete lines, keeps partial line as rest', () => {
    const { complete, rest } = splitLines('', 'a\nb\nc');
    expect(complete).toEqual(['a', 'b']);
    expect(rest).toBe('c');
  });

  it('prepends buffered partial to next chunk', () => {
    const first = splitLines('', 'foo');
    expect(first.complete).toEqual([]);
    expect(first.rest).toBe('foo');

    const second = splitLines(first.rest, 'bar\nbaz');
    expect(second.complete).toEqual(['foobar']);
    expect(second.rest).toBe('baz');
  });

  it('handles empty chunk', () => {
    const { complete, rest } = splitLines('partial', '');
    expect(complete).toEqual([]);
    expect(rest).toBe('partial');
  });
});

describe('createStreamTap', () => {
  function reqLine(id: string | number, method: string, params: unknown = {}): string {
    return JSON.stringify({ jsonrpc: '2.0', id, method, params });
  }
  function respLine(id: string | number, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
  }
  function errLine(id: string | number, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  }

  it('emits a receipt for tools/call request/response pair', async () => {
    const emit = vi.fn();
    const tap = createStreamTap(emit);

    tap.observeRequest(reqLine(1, 'tools/call', { name: 'search' }));
    // Wait 1ms so duration is nonzero
    await new Promise((r) => setTimeout(r, 2));
    tap.observeResponse(respLine(1, { content: 'x' }));

    expect(emit).toHaveBeenCalledTimes(1);
    const call = emit.mock.calls[0][0];
    expect(call.method).toBe('tools/call');
    expect(call.error).toBeNull();
    expect(call.duration_ms).toBeGreaterThanOrEqual(1);
    expect(tap.pendingCount()).toBe(0);
  });

  it('ignores non-observed methods', () => {
    const emit = vi.fn();
    const tap = createStreamTap(emit);
    tap.observeRequest(reqLine(1, 'initialize', {}));
    tap.observeResponse(respLine(1, {}));
    expect(emit).not.toHaveBeenCalled();
  });

  it('reports failure when response has an error', () => {
    const emit = vi.fn();
    const tap = createStreamTap(emit);
    tap.observeRequest(reqLine(1, 'tools/call', {}));
    tap.observeResponse(errLine(1, -32000, 'boom'));
    expect(emit).toHaveBeenCalledTimes(1);
    const call = emit.mock.calls[0][0];
    expect(call.error).toEqual({ code: -32000, message: 'boom' });
  });

  it('drops malformed JSON silently', () => {
    const emit = vi.fn();
    const tap = createStreamTap(emit);
    expect(() => tap.observeRequest('{not-json')).not.toThrow();
    expect(() => tap.observeResponse('')).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it('ignores orphan responses without a matching request', () => {
    const emit = vi.fn();
    const tap = createStreamTap(emit);
    tap.observeResponse(respLine(99, {}));
    expect(emit).not.toHaveBeenCalled();
  });
});
