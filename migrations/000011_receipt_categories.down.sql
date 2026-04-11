-- Rollback of migration 000011: drops the categories column and its indexes.

DROP INDEX IF EXISTS idx_receipts_target_type;
DROP INDEX IF EXISTS idx_receipts_activity_class;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS categories;
