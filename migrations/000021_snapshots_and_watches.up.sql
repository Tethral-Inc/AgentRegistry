-- Migration 000021: Shareable snapshots + watches.
--
-- Phase K of the v2.5.0 – v2.9.0 roadmap. Two new tables, plus one
-- small shape change on the existing notifications table so a watch
-- match can flow through the same channel as an anomaly signal.
--
-- `snapshots` : a frozen (lens, query, result) tuple under a short
--               public ID. Every lens tool POSTs one at render time and
--               includes the URL in its footer. Read path is public by
--               design — sharing with a teammate who doesn't have an
--               agent ID is the point. 30-day expiry; the expiry column
--               is authoritative (no separate TTL job required).
--
-- `watches`   : a persistent "tell me when X crosses Y" condition. The
--               watch-evaluation cron re-runs each enabled watch against
--               current lens data every hour and writes a notification
--               on a fresh crossing. `last_matched_at` gates re-
--               notification so a persistent breach doesn't spam.
--
-- Notifications table change: `skill_notifications` was built assuming
-- every notification was about a skill hash. Watch matches aren't —
-- they're about a target system, metric, and threshold. Drop NOT NULL
-- on skill_hash and add a `source` column that defaults to 'skill' so
-- existing data stays valid. Watch-match writes set source='watch' and
-- leave skill_hash NULL.

CREATE TABLE IF NOT EXISTS snapshots (
    short_id        STRING PRIMARY KEY,
    agent_id        STRING NOT NULL,
    lens            STRING NOT NULL,
    query           JSONB NOT NULL DEFAULT '{}',
    result_text     STRING NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
    INDEX idx_snapshot_agent (agent_id, created_at DESC),
    INDEX idx_snapshot_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS watches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    lens                STRING NOT NULL,
    target_system_id    STRING NOT NULL,
    metric              STRING NOT NULL,
    threshold           FLOAT NOT NULL,
    condition           STRING NOT NULL,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    last_evaluated_at   TIMESTAMPTZ,
    last_matched_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, lens, target_system_id, metric, condition),
    INDEX idx_watch_agent (agent_id) WHERE enabled = true,
    INDEX idx_watch_eval (last_evaluated_at) WHERE enabled = true
);

ALTER TABLE skill_notifications ALTER COLUMN skill_hash DROP NOT NULL;
ALTER TABLE skill_notifications ADD COLUMN IF NOT EXISTS source STRING NOT NULL DEFAULT 'skill';

CREATE INDEX IF NOT EXISTS idx_notif_source ON skill_notifications (source, created_at DESC);
