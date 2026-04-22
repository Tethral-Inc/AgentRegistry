/**
 * Style module unit tests + CI grep-guard for output consistency.
 *
 * Two concerns in one file:
 *   1. The helpers in `utils/style.ts` behave (truncation, percentage
 *      formatting, date rendering) — ordinary unit tests.
 *   2. No tool module in `packages/mcp-server/src/tools/` uses an
 *      off-canon divider (`-- X --`) or off-canon hash truncation
 *      (`.substring(0, 16)` + literal `'...'`). A grep-guard fails the
 *      build if those reappear.
 *
 * Guard is scoped to the canonical lengths (16-char hash, `-- `
 * dividers) — chain pattern rendering and URL parsing happen to use
 * slice(0,N) for unrelated reasons and are fine as long as they don't
 * concatenate a literal `'...'` after.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARROW,
  ELLIPSIS,
  HASH_TRUNC_LENGTH,
  fmtDate,
  fmtDuration,
  fmtRatio,
  section,
  truncHash,
} from '../../packages/mcp-server/src/utils/style.js';

const TOOLS_DIR = fileURLToPath(new URL('../../packages/mcp-server/src/tools/', import.meta.url));

describe('truncHash', () => {
  it('passes through short strings unchanged', () => {
    expect(truncHash('abc123')).toBe('abc123');
  });

  it('truncates long strings with ellipsis at the canonical length', () => {
    const hash = 'a'.repeat(64);
    expect(truncHash(hash)).toBe('a'.repeat(HASH_TRUNC_LENGTH) + ELLIPSIS);
  });

  it('honors a custom length', () => {
    expect(truncHash('abcdefghij', 4)).toBe('abcd' + ELLIPSIS);
  });

  it('treats null/undefined as empty', () => {
    expect(truncHash(null)).toBe('');
    expect(truncHash(undefined)).toBe('');
  });
});

describe('section', () => {
  it('wraps a title in the canonical em-dash divider', () => {
    expect(section('Summary')).toBe('── Summary ──');
  });
});

describe('fmtRatio', () => {
  it('renders 0..1 as percentage with one decimal', () => {
    expect(fmtRatio(0.1234)).toBe('12.3%');
    expect(fmtRatio(0)).toBe('0.0%');
    expect(fmtRatio(1)).toBe('100.0%');
  });

  it('handles null/undefined/NaN/Infinity as n/a', () => {
    expect(fmtRatio(null)).toBe('n/a');
    expect(fmtRatio(undefined)).toBe('n/a');
    expect(fmtRatio(Number.NaN)).toBe('n/a');
    expect(fmtRatio(Number.POSITIVE_INFINITY)).toBe('n/a');
  });
});

describe('fmtDate', () => {
  it('renders ISO input as YYYY-MM-DD in UTC', () => {
    expect(fmtDate('2026-04-22T13:45:00Z')).toBe('2026-04-22');
  });

  it('passes invalid input through unchanged so bugs are visible', () => {
    expect(fmtDate('not a date')).toBe('not a date');
  });

  it('handles null/undefined', () => {
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });
});

describe('fmtDuration', () => {
  it('picks the right unit per magnitude', () => {
    expect(fmtDuration(500)).toBe('0.5s');
    expect(fmtDuration(9500)).toBe('9.5s');
    expect(fmtDuration(30_000)).toBe('30s');
    expect(fmtDuration(90_000)).toBe('1m 30s');
    expect(fmtDuration(3_600_000)).toBe('1h');
    expect(fmtDuration(3_720_000)).toBe('1h 2m');
  });

  it('renders 0 and invalid as 0s', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(null)).toBe('0s');
    expect(fmtDuration(undefined)).toBe('0s');
    expect(fmtDuration(Number.NaN)).toBe('0s');
  });
});

describe('style grep-guard', () => {
  /**
   * Files that may legitimately reference off-canon patterns in
   * comments or test-data. Keep this list small and justify each entry
   * with a short reason — every allowlist entry is a bypass.
   */
  const ALLOWLIST = new Set<string>([
    // The style module itself mentions the legacy pattern in its
    // jsdoc explaining what's replacing it.
  ]);

  it("no tool uses the legacy `-- Title --` divider", () => {
    const offenders: string[] = [];
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      if (ALLOWLIST.has(file)) continue;
      const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Looking for rendered text like `text += `-- Something --``
        // and similar. The regex is deliberately narrow so prose with
        // `--` inside doesn't trigger.
        if (/`\\n?-- .+ --\\n?`|text \+= `\\n?-- /.test(line)) {
          offenders.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `Use \`section('Title')\` from utils/style.ts instead of inline \`-- Title --\`:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no tool uses the legacy `.substring(0, 16) + \'...\'` hash shape', () => {
    const offenders: string[] = [];
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      if (ALLOWLIST.has(file)) continue;
      const src = readFileSync(join(TOOLS_DIR, file), 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // The combo we're replacing is specifically
        // `.substring(0, 16) + '...'` or the same with `.slice`.
        // Other uses of `.slice(0, N)` (description truncation, URL
        // parsing, top-N list slices) are fine.
        if (/\.(substring|slice)\(0,\s*16\)\s*\+\s*['"]\.\.\.['"]/.test(line)) {
          offenders.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `Use \`truncHash(...)\` from utils/style.ts instead of inline .substring/.slice + '...':\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('canonical glyph exports', () => {
  it('ARROW is the RIGHTWARDS ARROW (U+2192)', () => {
    expect(ARROW).toBe('\u2192');
  });

  it('ELLIPSIS is the HORIZONTAL ELLIPSIS (U+2026)', () => {
    expect(ELLIPSIS).toBe('\u2026');
  });
});
