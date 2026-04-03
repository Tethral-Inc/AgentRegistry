import { describe, it, expect } from 'vitest';

/**
 * Test the friction report sorting logic in isolation.
 * Extracts the grouping + sorting algorithm from the friction route
 * to verify correctness without needing a database.
 */

interface ReceiptRow {
  target_system_id: string;
  target_system_type: string;
  duration_ms: number | null;
  status: string;
}

function computeFriction(rows: ReceiptRow[]) {
  const targetMap = new Map<string, {
    system_type: string;
    durations: number[];
    failures: number;
  }>();

  let totalWaitMs = 0;
  let totalFailures = 0;

  for (const row of rows) {
    const dur = row.duration_ms ?? 0;
    totalWaitMs += dur;
    const isFailed = row.status !== 'success';
    if (isFailed) totalFailures++;

    let entry = targetMap.get(row.target_system_id);
    if (!entry) {
      entry = { system_type: row.target_system_type, durations: [], failures: 0 };
      targetMap.set(row.target_system_id, entry);
    }
    entry.durations.push(dur);
    if (isFailed) entry.failures++;
  }

  const targets = Array.from(targetMap.entries())
    .map(([targetId, data]) => {
      const sorted = [...data.durations].sort((a, b) => a - b);
      const totalDur = sorted.reduce((a, b) => a + b, 0);
      const medianIdx = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 === 0
        ? Math.round((sorted[medianIdx - 1]! + sorted[medianIdx]!) / 2)
        : sorted[medianIdx]!;

      return {
        target_system_id: targetId,
        target_system_type: data.system_type,
        interaction_count: data.durations.length,
        total_duration_ms: totalDur,
        proportion_of_total: totalWaitMs > 0 ? totalDur / totalWaitMs : 0,
        failure_count: data.failures,
        median_duration_ms: median,
      };
    })
    .sort((a, b) => b.total_duration_ms - a.total_duration_ms)
    .slice(0, 10);

  return {
    summary: {
      total_interactions: rows.length,
      total_wait_time_ms: totalWaitMs,
      total_failures: totalFailures,
      failure_rate: rows.length > 0 ? totalFailures / rows.length : 0,
    },
    top_targets: targets,
  };
}

describe('Friction report sorting', () => {
  it('sorts top_targets by total_duration_ms descending', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 100, status: 'success' },
      { target_system_id: 'api:stripe.com', target_system_type: 'api', duration_ms: 5000, status: 'success' },
      { target_system_id: 'mcp:slack', target_system_type: 'mcp_server', duration_ms: 300, status: 'success' },
      { target_system_id: 'api:stripe.com', target_system_type: 'api', duration_ms: 4000, status: 'success' },
    ];

    const result = computeFriction(rows);

    expect(result.top_targets[0]!.target_system_id).toBe('api:stripe.com');
    expect(result.top_targets[0]!.total_duration_ms).toBe(9000);
    expect(result.top_targets[1]!.target_system_id).toBe('mcp:slack');
    expect(result.top_targets[2]!.target_system_id).toBe('mcp:github');
  });

  it('computes correct proportions', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 250, status: 'success' },
      { target_system_id: 'api:stripe.com', target_system_type: 'api', duration_ms: 750, status: 'success' },
    ];

    const result = computeFriction(rows);

    expect(result.top_targets[0]!.proportion_of_total).toBeCloseTo(0.75);
    expect(result.top_targets[1]!.proportion_of_total).toBeCloseTo(0.25);
  });

  it('computes correct median for odd count', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 100, status: 'success' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 200, status: 'success' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 900, status: 'success' },
    ];

    const result = computeFriction(rows);
    expect(result.top_targets[0]!.median_duration_ms).toBe(200);
  });

  it('computes correct median for even count', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 100, status: 'success' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 300, status: 'success' },
    ];

    const result = computeFriction(rows);
    expect(result.top_targets[0]!.median_duration_ms).toBe(200);
  });

  it('counts failures correctly per target', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 100, status: 'success' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 200, status: 'failure' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 150, status: 'timeout' },
      { target_system_id: 'api:stripe.com', target_system_type: 'api', duration_ms: 500, status: 'success' },
    ];

    const result = computeFriction(rows);
    const github = result.top_targets.find((t) => t.target_system_id === 'mcp:github')!;
    expect(github.failure_count).toBe(2);
    expect(result.summary.total_failures).toBe(2);
    expect(result.summary.failure_rate).toBeCloseTo(0.5);
  });

  it('limits to top 10 targets', () => {
    const rows: ReceiptRow[] = Array.from({ length: 15 }, (_, i) => ({
      target_system_id: `mcp:target-${i}`,
      target_system_type: 'mcp_server',
      duration_ms: (i + 1) * 100,
      status: 'success' as const,
    }));

    const result = computeFriction(rows);
    expect(result.top_targets).toHaveLength(10);
    // Highest duration first
    expect(result.top_targets[0]!.target_system_id).toBe('mcp:target-14');
  });

  it('handles null duration_ms as zero', () => {
    const rows: ReceiptRow[] = [
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: null, status: 'success' },
      { target_system_id: 'mcp:github', target_system_type: 'mcp_server', duration_ms: 500, status: 'success' },
    ];

    const result = computeFriction(rows);
    expect(result.top_targets[0]!.total_duration_ms).toBe(500);
    expect(result.summary.total_wait_time_ms).toBe(500);
  });
});
