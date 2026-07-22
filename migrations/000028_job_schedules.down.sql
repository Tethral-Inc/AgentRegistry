-- Reverting drops the declared-intent signal. probeAggregationFreshness falls
-- back to the hardcoded 30 min / 2 h thresholds, so a suspended job reads as
-- "down" again — the exact false-red this migration removed.
DROP TABLE IF EXISTS job_schedules;
