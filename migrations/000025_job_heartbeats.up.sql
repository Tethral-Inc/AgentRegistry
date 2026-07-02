-- Migration 000025: job_heartbeats — record every cron job run.
--
-- Before this table, "is the aggregation pipeline alive?" was inferred from
-- MAX(last_seen_at) on system_health — i.e. from the recency of the DATA the
-- jobs write. That conflates two independent facts:
--   * the pipeline is broken (job not running / erroring), and
--   * the network is quiet (job ran fine, there was nothing new to write).
-- A successful run over a quiet network advanced nothing, so /health reported
-- "aggregation stale" minutes after a green cron run (a false-red).
--
-- Every cron handler now upserts a row here on completion (success or
-- failure). Freshness probes read last_run_at for pipeline health and keep
-- data recency as a separate, neutral signal.
CREATE TABLE IF NOT EXISTS job_heartbeats (
  job_name STRING PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status STRING NOT NULL DEFAULT 'ok',
  elapsed_ms INT8,
  -- First 512 chars of the handler's JSON response (e.g. {"updated":30}) so
  -- an operator can see whether a "successful" run actually wrote anything.
  last_result STRING
);
