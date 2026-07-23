-- Migration 000028: job_schedules — declare each job's EXPECTED cadence.
--
-- job_heartbeats (000025) records what actually happened. Nothing recorded what
-- was supposed to happen, so freshness was judged against thresholds hardcoded
-- to a */15 cadence (30 min = stale, 2 h = down). Two consequences:
--
--   1. A job deliberately switched off was indistinguishable from a broken one.
--      On 2026-07-12 the lens-aggregation schedules were commented out on
--      purpose (no external users); /health reported `status: down` with
--      "cron likely stuck" for the next 10 days, and get_network_status printed
--      "DATA MAY BE STALE" and "network looks healthy" in the same response.
--   2. Any job NOT on a 15-minute cadence was judged by 15-minute thresholds.
--      A daily job is "down" 2 h after it runs, which is nonsense.
--
-- This table is the declaration of intent the probe compares against:
--   * expected_interval_minutes NOT NULL → job is expected to run that often;
--     stale/down thresholds are derived from it, not hardcoded.
--   * expected_interval_minutes NULL     → job is intentionally suspended.
--     Not an incident. /health reports `paused` and names the reason.
--
-- Suspending a job is now a one-row UPDATE that keeps every reader honest,
-- instead of a commented-out YAML block that silently freezes the product.
CREATE TABLE IF NOT EXISTS job_schedules (
  job_name STRING PRIMARY KEY,
  -- NULL means suspended. Non-NULL is the cadence the scheduler is configured
  -- for (keep in sync with the `crons` block in packages/ingestion-api/vercel.json).
  expected_interval_minutes INT8,
  -- When the job was suspended; NULL while it is expected to run.
  suspended_at TIMESTAMPTZ,
  -- Why it is suspended, or a note about the cadence. Surfaced verbatim by
  -- /health, so write it for whoever reads the alert at 3am.
  reason STRING,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The two states are exclusive: suspended (no interval, has a timestamp) or
  -- scheduled (has an interval, no timestamp). Without this the table could
  -- claim both at once and the probe would have to guess.
  CONSTRAINT suspended_xor_scheduled CHECK (
    (expected_interval_minutes IS NULL AND suspended_at IS NOT NULL)
    OR (expected_interval_minutes IS NOT NULL AND suspended_at IS NULL)
  )
);

-- Seed: every job driven by /api/cron/daily-tick, declared at its real cadence.
-- 1440 = daily. These replace the suspended */15 + 7,37 + daily GitHub Actions
-- schedules; see the migration header and packages/ingestion-api/vercel.json.
INSERT INTO job_schedules (job_name, expected_interval_minutes, reason)
VALUES
  ('system-health-aggregate',   1440, 'daily consolidated tick (was */15 until 2026-07-12)'),
  ('chain-analysis',            1440, 'daily consolidated tick'),
  ('skill-threat-update',       1440, 'daily consolidated tick'),
  ('agent-baseline-compute',    1440, 'daily consolidated tick'),
  ('agent-anomaly-detect',      1440, 'daily consolidated tick (detector still in shadow mode)'),
  ('anomaly-correlation',       1440, 'daily consolidated tick'),
  ('pattern-detection',         1440, 'daily consolidated tick'),
  ('watch-evaluation',          1440, 'daily consolidated tick — backs set_watch notifications'),
  ('friction-baseline-compute', 1440, 'daily consolidated tick'),
  ('agent-expiration',          1440, 'daily consolidated tick — backs the privacy retention promise'),
  ('data-archival',             1440, 'daily consolidated tick — backs the privacy retention promise'),
  ('daily-tick',                1440, 'the scheduler entry itself: one Vercel cron runs all jobs above')
ON CONFLICT (job_name) DO NOTHING;
