-- Revert 000022: drop the register-churn table and UNIQUE constraint.
-- The dedup step in the up migration is not reversible — deleted agent
-- rows stay deleted. A real rollback after a populated run would need a
-- snapshot restore, not this down migration.

DROP TABLE IF EXISTS ip_register_churn;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_public_key_unique;
