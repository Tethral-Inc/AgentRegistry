-- Migration 000016: Capture-surface expansion — five optional receipt fields.
--
-- All nullable. Existing agents continue to work unchanged. Agents that opt
-- into reporting these fields seed future lenses at zero marginal cost:
--   - substitution_of:        substitution graph lens
--   - decision_tokens:        decision-cost lens
--   - result_used:            wasted-attention lens
--   - context_bytes:          contextual cost surface
--   - prompt_cache_hit_ratio: prompt-cache efficiency lens
--
-- Schema lands in this sprint; lenses that consume the data come in later
-- versions. The goal is to start seeding the columns immediately so that
-- when the lenses ship, backfilled data is already available.

ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS substitution_of STRING;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS decision_tokens INT;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS result_used BOOL;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS context_bytes INT;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS prompt_cache_hit_ratio FLOAT;

-- Partial index only on receipts that actually report a substitution — the
-- substitution graph lens will scan these often.
CREATE INDEX IF NOT EXISTS idx_receipts_substitution
    ON interaction_receipts (substitution_of, created_at DESC)
    WHERE substitution_of IS NOT NULL;
