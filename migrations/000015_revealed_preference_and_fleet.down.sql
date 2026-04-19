-- Revert migration 000015
DROP TABLE IF EXISTS chain_analysis_fleet;
DROP INDEX IF EXISTS idx_receipts_agent_target_time;
