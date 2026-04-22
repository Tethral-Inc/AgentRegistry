/**
 * Style module — one source of truth for the tool-output visual
 * vocabulary.
 *
 * Before this module lived in one place, we had two divider styles
 * (`── Section ──` and `-- Section --`), three arrow variants (`->`,
 * `=>`, `→`), two hash-truncation shapes (`.slice(0, 16) + '...'` and
 * `.substring(0, 16) + '...'`), plus a sprinkling of `.slice(0, 12)`.
 * A grep-guard test enforces the canonical set from this point forward.
 *
 * Why this matters: tool outputs are read by both humans and LLM agents
 * that re-use the output as context. Inconsistent glyphs and formats
 * force the reader — human or model — to re-parse the structure on
 * every tool, which costs attention and tokens. Consistency is not
 * cosmetic.
 *
 * The canonical choices:
 *   Dividers  — `── Title ──` (Unicode box-drawing, matches friction
 *              lens which is the most-used output).
 *   Arrows    — `→` (Unicode RIGHTWARDS ARROW) for next-step + flow
 *              direction. The legacy `->` ASCII arrow stays in chain
 *              pattern rendering because it's data-shape, not prose.
 *   Hashes    — `truncHash(s, 16)` = first 16 chars + `…` (Unicode
 *              HORIZONTAL ELLIPSIS instead of three dots — matches a
 *              single column width).
 *   Ratios    — `fmtRatio(n)` gives `xx.x%`; negatives, zero, NaN all
 *              render sensibly.
 *   Dates     — `fmtDate(iso)` gives `YYYY-MM-DD` from an ISO string;
 *              invalid input returns the input unchanged so bugs are
 *              visible rather than swallowed.
 */

/**
 * Hash truncation length used across every tool. 16 chars is enough to
 * be visually distinct (collision-avoidant) without wrapping on narrow
 * terminals. Don't change this — grep and the CI guard both assume it.
 */
export const HASH_TRUNC_LENGTH = 16;

/** The canonical horizontal-ellipsis glyph. One column wide. */
export const ELLIPSIS = '…';

/** Canonical right-arrow glyph for next-step footers and flow indicators. */
export const ARROW = '→';

/**
 * Truncate a hash-like string to the canonical length + ellipsis.
 * Short strings pass through unchanged — no pointless ellipsis on a
 * 10-char id.
 */
export function truncHash(s: string | null | undefined, length: number = HASH_TRUNC_LENGTH): string {
  if (!s) return '';
  if (s.length <= length) return s;
  return s.slice(0, length) + ELLIPSIS;
}

/**
 * Render a section divider. Nested sections get the same top-level
 * divider — the name is what the reader scans for, not the weight of
 * the line.
 */
export function section(title: string): string {
  return `── ${title} ──`;
}

/**
 * Render a percentage from a 0..1 ratio with one decimal. `null`,
 * `undefined`, NaN, and ±Infinity all render as `n/a` — bugs are still
 * visible because the surrounding context tells you what should be there.
 */
export function fmtRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Render an ISO datetime as a YYYY-MM-DD date. Invalid input returns
 * the input unchanged, so a broken timestamp shows up verbatim in the
 * output (easier to debug than a silent fallback to "now").
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Render a duration in ms as a human-friendly string. Picks the right
 * unit for the magnitude — mirrors the ad-hoc formatter that used to
 * live inside friction-report.
 */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}
