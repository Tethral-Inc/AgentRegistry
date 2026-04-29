/**
 * parseApiResponse — validate an ACR API response against a Zod schema
 * and return a discriminated result the caller can render directly.
 *
 * Why this exists: tools used to do `await res.json()` without
 * validation, then trust whatever shape came back. A 200 with a
 * malformed body (server change, partial outage, accidental empty
 * payload) silently became a fake success — for `log_interaction`
 * that meant the operator believed they'd logged a receipt when in
 * fact ingestion no-op'd. Schema validation here turns those
 * invisible failures into `isError: true` responses with a specific
 * Zod issue trail.
 *
 * Usage:
 *   const parsed = await parseApiResponse(res, MyResponseSchema, 'tool_name');
 *   if (!parsed.ok) return parsed.error;
 *   const data = parsed.data;  // typed by inference
 *
 * The helper deliberately does NOT retry, log, or self-emit. It only
 * parses. Self-telemetry on parse failure lives in the tool's own
 * handler so the helper stays a pure function.
 */
import type { z } from 'zod';

type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: McpToolResult };

const MAX_BODY_PREVIEW_BYTES = 500;

function previewBody(text: string): string {
  if (text.length <= MAX_BODY_PREVIEW_BYTES) return text;
  return text.slice(0, MAX_BODY_PREVIEW_BYTES) + '... [truncated]';
}

/**
 * Read the response body and validate it against the schema. Returns a
 * `ParseResult` discriminated by `ok`. On `!ok`, the embedded `error`
 * is a fully-formed MCP tool response with `isError: true` and a
 * single text block describing what failed (HTTP status, JSON parse
 * error, or Zod issue list).
 *
 * `context` is a short label (e.g. `log_interaction`) used in error
 * copy so the operator can tell which tool's response failed when
 * multiple tools emit errors in the same session.
 */
export async function parseApiResponse<T>(
  res: Response,
  schema: z.ZodType<T>,
  context: string,
): Promise<ParseResult<T>> {
  // HTTP-level failure: read text body for the operator (a JSON body
  // works too — text() handles both). Don't try to parse — error
  // bodies often aren't the same shape as success bodies.
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      error: {
        content: [{
          type: 'text',
          text: `${context}: HTTP ${res.status} ${res.statusText || ''}`.trim()
            + (text ? `\n${previewBody(text)}` : ''),
        }],
        isError: true,
      },
    };
  }

  // Read body once. We need the raw text for the error copy if JSON
  // parse fails; reading twice would consume the stream.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      ok: false,
      error: {
        content: [{
          type: 'text',
          text: `${context}: failed to read response body: ${msg}`,
        }],
        isError: true,
      },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      ok: false,
      error: {
        content: [{
          type: 'text',
          text: `${context}: response body was not valid JSON (${msg}).\n${previewBody(text)}`,
        }],
        isError: true,
      },
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    // Zod's issue list is the most useful diagnostic — it names the
    // missing/wrong fields. Truncate aggressively so a deep schema
    // mismatch doesn't blow up the tool output.
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    const more = result.error.issues.length > 5
      ? `\n  ... and ${result.error.issues.length - 5} more`
      : '';
    return {
      ok: false,
      error: {
        content: [{
          type: 'text',
          text: `${context}: response did not match expected shape:\n${issues}${more}`,
        }],
        isError: true,
      },
    };
  }

  return { ok: true, data: result.data };
}
