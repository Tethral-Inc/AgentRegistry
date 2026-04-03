CREATE TABLE IF NOT EXISTS agents (
    agent_id            STRING PRIMARY KEY,
    public_key          STRING NOT NULL,
    provider_class      STRING NOT NULL DEFAULT 'unknown',
    current_composition_hash STRING,
    operational_domain  STRING,
    registration_method STRING NOT NULL,
    status              STRING NOT NULL DEFAULT 'active',
    registered          BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    credential_jwt      STRING,
    INDEX idx_agents_status (status),
    INDEX idx_agents_provider (provider_class)
);

CREATE TABLE IF NOT EXISTS composition_snapshots (
    snapshot_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            STRING NOT NULL,
    composition_hash    STRING NOT NULL,
    component_hashes    STRING[] NOT NULL,
    reported_components JSONB NOT NULL DEFAULT '{}',
    snapshot_method     STRING NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_snapshots_agent_time (agent_id, recorded_at DESC),
    INDEX idx_snapshots_hash (composition_hash)
);

CREATE TABLE IF NOT EXISTS interaction_receipts (
    receipt_id              STRING NOT NULL,
    emitter_agent_id        STRING NOT NULL,
    emitter_composition_hash STRING,
    emitter_provider_class  STRING,
    target_system_id        STRING NOT NULL,
    target_system_type      STRING NOT NULL,
    interaction_category    STRING NOT NULL,
    request_timestamp_ms    BIGINT NOT NULL,
    response_timestamp_ms   BIGINT,
    duration_ms             INT,
    status                  STRING NOT NULL,
    anomaly_flagged         BOOLEAN NOT NULL DEFAULT false,
    anomaly_category        STRING,
    anomaly_detail          STRING,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (receipt_id, created_at),
    INDEX idx_receipts_emitter (emitter_agent_id, created_at DESC),
    INDEX idx_receipts_target (target_system_id, created_at DESC),
    INDEX idx_receipts_anomaly (created_at DESC) WHERE anomaly_flagged = true,
    INDEX idx_receipts_timing (target_system_id, duration_ms),
    INDEX idx_receipts_category (interaction_category, created_at DESC)
);

CREATE TABLE IF NOT EXISTS skill_hashes (
    skill_hash          STRING PRIMARY KEY,
    skill_name          STRING,
    skill_source        STRING,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    agent_count         INT NOT NULL DEFAULT 0,
    interaction_count   INT NOT NULL DEFAULT 0,
    anomaly_signal_count INT NOT NULL DEFAULT 0,
    anomaly_signal_rate FLOAT NOT NULL DEFAULT 0.0,
    threat_level        STRING NOT NULL DEFAULT 'none',
    known_bad_source    STRING,
    last_updated        TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX idx_skills_threat (threat_level) WHERE threat_level != 'none'
);

CREATE TABLE IF NOT EXISTS friction_baselines (
    target_class        STRING PRIMARY KEY,
    baseline_median_ms  INT NOT NULL,
    baseline_p95_ms     INT NOT NULL,
    baseline_p99_ms     INT NOT NULL,
    sample_count        BIGINT NOT NULL DEFAULT 0,
    volatility_score    FLOAT NOT NULL DEFAULT 0.0,
    failure_rate        FLOAT NOT NULL DEFAULT 0.0,
    last_computed       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_health (
    system_id           STRING PRIMARY KEY,
    system_type         STRING NOT NULL,
    total_interactions  BIGINT NOT NULL DEFAULT 0,
    distinct_agent_count INT NOT NULL DEFAULT 0,
    anomaly_signal_count INT NOT NULL DEFAULT 0,
    anomaly_rate        FLOAT NOT NULL DEFAULT 0.0,
    median_duration_ms  INT,
    p95_duration_ms     INT,
    failure_rate        FLOAT NOT NULL DEFAULT 0.0,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    health_status       STRING NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS canonical_name_mappings (
    variant_name        STRING PRIMARY KEY,
    canonical_name      STRING NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_summaries (
    summary_date        DATE NOT NULL,
    entity_type         STRING NOT NULL,
    entity_id           STRING NOT NULL,
    total_interactions  BIGINT NOT NULL DEFAULT 0,
    anomaly_count       INT NOT NULL DEFAULT 0,
    median_duration_ms  INT,
    p95_duration_ms     INT,
    failure_count       INT NOT NULL DEFAULT 0,
    distinct_counterparts INT NOT NULL DEFAULT 0,
    PRIMARY KEY (summary_date, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS skill_versions (
    skill_name          STRING PRIMARY KEY,
    current_version     STRING NOT NULL,
    download_url        STRING NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    key_hash            STRING PRIMARY KEY,
    operator_id         STRING NOT NULL,
    name                STRING NOT NULL,
    tier                STRING NOT NULL DEFAULT 'free',
    rate_limit_per_hour INT NOT NULL DEFAULT 100,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at        TIMESTAMPTZ,
    revoked             BOOLEAN NOT NULL DEFAULT false,
    INDEX idx_apikeys_operator (operator_id)
);
