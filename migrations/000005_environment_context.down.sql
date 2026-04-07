-- Rollback migration 000005: Remove environment context fields

DROP INDEX IF EXISTS idx_receipts_source;
DROP INDEX IF EXISTS idx_receipts_transport;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS source;
ALTER TABLE interaction_receipts DROP COLUMN IF EXISTS transport_type;

DROP INDEX IF EXISTS idx_agents_transport;
DROP INDEX IF EXISTS idx_agents_platform;
ALTER TABLE agents DROP COLUMN IF EXISTS transport_type;
ALTER TABLE agents DROP COLUMN IF EXISTS client_type;
ALTER TABLE agents DROP COLUMN IF EXISTS arch;
ALTER TABLE agents DROP COLUMN IF EXISTS platform;
ALTER TABLE agents DROP COLUMN IF EXISTS device_class;
