-- Migration 000026: null out legacy think-time durations.
--
-- The hook now emits duration_ms=NULL for interactive/orchestration tools
-- (AskUserQuestion, ExitPlanMode, EnterPlanMode, Workflow, Monitor) because
-- their wall-clock is human think-time or double-counted orchestration wait,
-- not target latency. Receipts written before that fix still carry real
-- durations (e.g. a 314s AskUserQuestion = 41% of a week's reported wait) and
-- there is no TTL that would age them out on any useful horizon — so the
-- friction lens's top-of-report stays polluted until they're corrected.
--
-- One-time backfill: NULL the durations so these rows still count as
-- interactions but contribute nothing to wait-time sums (the friction query
-- COALESCEs NULL durations to 0), matching what the hook emits today.
UPDATE interaction_receipts
SET duration_ms = NULL
WHERE target_system_id IN (
  'platform:askuserquestion',
  'platform:exitplanmode',
  'platform:enterplanmode',
  'platform:workflow',
  'platform:monitor'
)
  AND duration_ms IS NOT NULL;
