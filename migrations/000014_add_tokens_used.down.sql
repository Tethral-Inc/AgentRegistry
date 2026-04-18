-- Revert tokens_used column
DROP INDEX IF EXISTS idx_receipts_tokens_used;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS tokens_used;
