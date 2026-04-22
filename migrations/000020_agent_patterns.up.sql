-- Migration 000020: Proactive pattern surfacing.
--
-- Phase J of the v2.5.0 – v2.9.0 roadmap. The cron-triggered pattern
-- detection job writes one row per (agent_id, pattern_type). At most four
-- pattern types exist today:
--   - composition_staleness : declared composition hasn't kept up with
--                             the targets the agent actually calls.
--   - retry_burst           : a target was retried repeatedly in a short
--                             window — unusually high retry rate vs the
--                             agent's own baseline.
--   - lens_call_spike       : lens tool-call frequency jumped vs the
--                             prior period (operator is hunting).
--   - skill_version_drift   : a declared skill has a newer version in the
--                             network that the agent hasn't moved to.
--
-- The table is small by design. Detection re-evaluates each pattern on
-- every cron tick and UPSERTs the latest confidence + metadata —
-- yesterday's detection doesn't linger as a second row. Dismissal sets
-- `dismissed_at` + `dismiss_reason`; dismissed rows are kept so a future
-- calibration job can query "which patterns do operators actually find
-- useful?" A 30-day expiry cap keeps truly stale patterns from re-
-- surfacing if the cron misses them.

CREATE TABLE IF NOT EXISTS agent_patterns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        STRING NOT NULL,
    pattern_type    STRING NOT NULL,
    confidence      FLOAT NOT NULL DEFAULT 0.0,
    title           STRING NOT NULL,
    message         STRING NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
    dismissed_at    TIMESTAMPTZ,
    dismiss_reason  STRING,
    UNIQUE (agent_id, pattern_type),
    INDEX idx_pattern_agent_active (agent_id, detected_at DESC) WHERE dismissed_at IS NULL,
    INDEX idx_pattern_type (pattern_type, detected_at DESC)
);
