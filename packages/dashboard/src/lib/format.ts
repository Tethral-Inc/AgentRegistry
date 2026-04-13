export function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function rateColor(rate: number): string {
  if (rate >= 0.1) return '#ef4444';
  if (rate >= 0.05) return '#f97316';
  return '#22c55e';
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
