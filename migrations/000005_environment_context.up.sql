-- Migration 000005: Add environment context fields
-- Enables tracking device class, platform, architecture, client type, and transport type
-- for agents and interactions. All columns nullable for backwards compatibility.

-- Agent-level environment (set once at registration)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS device_class STRING;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS platform STRING;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS arch STRING;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS client_type STRING;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS transport_type STRING;

CREATE INDEX IF NOT EXISTS idx_agents_platform ON agents (platform) WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_transport ON agents (transport_type) WHERE transport_type IS NOT NULL;

-- Per-interaction transport + source tracking
-- transport_type: 'stdio' or 'streamable-http'
-- source: 'agent' (LLM-initiated log_interaction) or 'server' (auto-logged by middleware)
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS transport_type STRING;
ALTER TABLE interaction_receipts ADD COLUMN IF NOT EXISTS source STRING DEFAULT 'agent';

CREATE INDEX IF NOT EXISTS idx_receipts_transport ON interaction_receipts (transport_type, created_at DESC)
  WHERE transport_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_source ON interaction_receipts (source, created_at DESC);
