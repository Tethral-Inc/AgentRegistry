-- Migration 000011: Receipt category classification fields.
--
-- Adds a JSONB `categories` column to interaction_receipts so clients can
-- classify the kind of work each interaction represents. The taxonomy is
-- expected to evolve, so it's stored as JSONB rather than flat columns —
-- new dimensions can be added client-side without a DB migration.
--
-- First-pass taxonomy (see proposals/open-items-plan.md Item 1):
--   target_type         — e.g. "api.llm_provider", "mcp.database"
--   activity_class      — "language", "math", "visuals", "creative",
--                         "deterministic", "sound" (expandable)
--   interaction_purpose — "read", "write", "search", "generate",
--                         "transform", "acknowledge"
--   workflow_role       — "initial", "intermediate", "recovery", "cleanup"
--   workflow_phase      — "plan", "act", "reflect"
--   data_shape          — "tabular", "text", "binary", "structured_json",
--                         "stream", "image", "audio"
--   criticality         — "core", "enrichment", "debug"
--
-- All fields are optional. Clients that don't populate `categories` get an
-- empty object by default; reads handle missing keys gracefully.
--
-- Expression indexes on activity_class and target_type are the likely
-- first-hot fields. Other dimensions can get indexes as they prove hot
-- via the "flatten-later" path described in the plan.

-- Add the categories column (additive, NOT NULL with default — safe for
-- running clients; existing rows get '{}').
ALTER TABLE interaction_receipts
  ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Expression index on activity_class (likely the first hot field).
-- Partial index keeps cost bounded to populated rows.
CREATE INDEX IF NOT EXISTS idx_receipts_activity_class
  ON interaction_receipts ((categories->>'activity_class'))
  WHERE categories ? 'activity_class';

-- Expression index on target_type (second likely hot field for target-type
-- rollups in the friction lens).
CREATE INDEX IF NOT EXISTS idx_receipts_target_type
  ON interaction_receipts ((categories->>'target_type'))
  WHERE categories ? 'target_type';
