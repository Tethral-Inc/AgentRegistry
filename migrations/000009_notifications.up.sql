-- Migration 000009: Agent skill subscriptions, notifications, and acknowledgement gates.

CREATE TABLE IF NOT EXISTS skill_subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    skill_hash          STRING NOT NULL,
    notify_on           STRING NOT NULL DEFAULT 'threat',
    min_threat_level    STRING NOT NULL DEFAULT 'medium',
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (agent_id, skill_hash),
    INDEX idx_sub_agent (agent_id) WHERE active = true,
    INDEX idx_sub_skill (skill_hash) WHERE active = true
);

CREATE TABLE IF NOT EXISTS skill_notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    skill_hash          STRING NOT NULL,
    notification_type   STRING NOT NULL,
    severity            STRING NOT NULL,
    title               STRING NOT NULL,
    message             STRING NOT NULL,
    metadata            JSONB DEFAULT '{}',
    read                BOOLEAN NOT NULL DEFAULT false,
    acknowledged        BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_notif_agent (agent_id, created_at DESC),
    INDEX idx_notif_unread (agent_id) WHERE read = false,
    INDEX idx_notif_unacked (agent_id) WHERE acknowledged = false
);

CREATE TABLE IF NOT EXISTS threat_acknowledgements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    skill_hash          STRING NOT NULL,
    threat_level        STRING NOT NULL,
    threat_patterns     STRING[] DEFAULT '{}',
    acknowledged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by     STRING,
    reason              STRING,
    expires_at          TIMESTAMPTZ,
    UNIQUE (agent_id, skill_hash),
    INDEX idx_ack_agent (agent_id),
    INDEX idx_ack_skill (skill_hash)
);
