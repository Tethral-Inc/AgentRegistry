-- Revert migration 000016
DROP INDEX IF EXISTS idx_receipts_substitution;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS prompt_cache_hit_ratio;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS context_bytes;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS result_used;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS decision_tokens;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS substitution_of;
