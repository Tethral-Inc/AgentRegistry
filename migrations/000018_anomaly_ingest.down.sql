-- Revert migration 000018
DROP TABLE IF EXISTS agent_baselines;
DROP TABLE IF EXISTS agent_quarantine;
DROP TABLE IF EXISTS ingest_counters;
