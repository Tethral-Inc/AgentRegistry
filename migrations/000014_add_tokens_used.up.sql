-- Add tokens_used to interaction_receipts for wasted-token tracking
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS tokens_used INT;

-- Sparse index: most receipts won't have this field initially
CREATE INDEX IF NOT EXISTS idx_receipts_tokens_used
  ON interaction_receipts (tokens_used)
  WHERE tokens_used IS NOT NULL;
