-- Migration 000027: make receipt_id actually idempotent.
--
-- receipt_id is computed deterministically from (agent, target,
-- request_timestamp_ms), and ingestion has always written with
-- ON CONFLICT (receipt_id, created_at) DO NOTHING — but created_at defaults
-- to now(), so a client RETRY of the same receipt arrives with a new
-- created_at, misses the conflict target, and double-counts. The dedupe was
-- illusory for exactly the case it existed for.
--
-- Step 1: remove any historical duplicates (keep the earliest row per
-- receipt_id) so the unique index can build.
DELETE FROM interaction_receipts
WHERE (receipt_id, created_at) IN (
  SELECT receipt_id, created_at FROM (
    SELECT receipt_id, created_at,
           row_number() OVER (PARTITION BY receipt_id ORDER BY created_at ASC) AS rn
    FROM interaction_receipts
  ) WHERE rn > 1
);

-- Step 2: enforce uniqueness on receipt_id alone. Ingestion writes with a
-- target-less ON CONFLICT DO NOTHING, which arbitrates this index once it
-- exists (and is a harmless no-op before it does — deploy-order safe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_receipt_id_unique
  ON interaction_receipts (receipt_id);
