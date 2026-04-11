-- Migration 000012: Two-source agent composition.
--
-- Stores composition from two distinct sources — what the MCP directly
-- observes in the agent's environment, and what the agent explicitly
-- reports about itself — with explicit source attribution. The server
-- can compare the two sources and surface disagreements as a signal
-- (see proposals/open-items-plan.md Item 2).
--
-- The existing agents.composition column continues to serve as the
-- "canonical" merged composition the server uses for internal-vs-external
-- classification. This new table holds the per-source raw data so the
-- delta can be computed and the merge can be re-run if the merge rule
-- changes.

CREATE TABLE IF NOT EXISTS agent_composition_sources (
    agent_id          STRING NOT NULL,
    source            STRING NOT NULL CHECK (source IN ('mcp_observed', 'agent_reported')),
    composition       JSONB NOT NULL,
    composition_hash  STRING NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, source),
    INDEX idx_composition_sources_updated_at (updated_at)
);
