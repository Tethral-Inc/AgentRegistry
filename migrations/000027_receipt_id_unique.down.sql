-- Deleted duplicate rows are not restorable (they were retry artifacts).
DROP INDEX IF EXISTS interaction_receipts@idx_receipts_receipt_id_unique CASCADE;
