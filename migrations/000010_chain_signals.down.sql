DROP TABLE IF EXISTS directional_pairs;
DROP TABLE IF EXISTS chain_analysis;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS preceded_by;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS chain_position;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS chain_id;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS response_size_bytes;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS error_code;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS retry_count;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS queue_wait_ms;
