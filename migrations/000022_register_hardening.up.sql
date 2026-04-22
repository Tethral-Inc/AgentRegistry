-- Migration 000022: Harden /register against anonymous abuse.
--
-- Two changes in one migration because they land together in the handler:
--
-- 1. agents.public_key becomes UNIQUE. The register endpoint accepts any
--    32-char string as public_key and previously minted a new agent_id
--    per call (agent_id = sha256(public_key:timestamp)). That let one
--    caller spam a single key into N distinct agents. UNIQUE makes
--    register idempotent at the storage layer; the handler turns conflict
--    into "return existing agent, no new api_key."
--
-- 2. ip_register_churn mirrors ip_agent_churn (000019) but counts
--    registrations instead of receipt-emitter agent_ids. One row per
--    (ip, bucket_hour, agent_id). Handler queries COUNT(*) per
--    (ip, current_hour) and 429s above the threshold.
--
-- Dedup step below is safe because the project has no production users
-- yet. In a populated DB this step would need a case-by-case ops
-- decision about which duplicate row wins.

-- Preserve the oldest agent row per public_key; hard-delete dupes.
-- ROW_NUMBER partitions by public_key so rn=1 is the first-registered
-- row and any rn>1 is a later dupe.
WITH ranked AS (
    SELECT agent_id,
           ROW_NUMBER() OVER (PARTITION BY public_key ORDER BY created_at ASC) AS rn
    FROM agents
)
DELETE FROM agents WHERE agent_id IN (
    SELECT agent_id FROM ranked WHERE rn > 1
);

-- Now the UNIQUE constraint is safe to add.
ALTER TABLE agents ADD CONSTRAINT agents_public_key_unique UNIQUE (public_key);

-- Per-IP register churn tracking. Shape matches ip_agent_churn so the
-- receipts pattern is directly transferable.
CREATE TABLE IF NOT EXISTS ip_register_churn (
    ip           STRING NOT NULL,
    bucket_hour  TIMESTAMPTZ NOT NULL,
    agent_id     STRING NOT NULL,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ip, bucket_hour, agent_id)
) WITH (
    ttl_expiration_expression = 'bucket_hour + INTERVAL ''3 days''',
    ttl_job_cron = '@daily'
);
