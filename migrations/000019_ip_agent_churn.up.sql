-- Migration 000019: Per-IP agent-id churn tracking.
--
-- Replaces the Upstash IP rate limiter. Instead of a generic req/min cap,
-- tracks how many distinct agent_ids a single IP declares per hour —
-- which is the one remaining attack vector per-agent ingest_counters
-- (000018) don't catch: someone spraying fake agent_ids from one source.
--
-- One row per (ip, bucket_hour, agent_id). Count via COUNT(*). Shadow
-- mode logs only; enforcement is a later flip once thresholds are tuned.
--
-- Known blindspot: distributed-IP spray (botnet/proxy rotation) defeats
-- this. Mitigation at that point is Cloudflare as a proxy for edge-level
-- protection, not more SQL.

CREATE TABLE IF NOT EXISTS ip_agent_churn (
    ip           STRING NOT NULL,
    bucket_hour  TIMESTAMPTZ NOT NULL,
    agent_id     STRING NOT NULL,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ip, bucket_hour, agent_id)
) WITH (
    ttl_expiration_expression = 'bucket_hour + INTERVAL ''3 days''',
    ttl_job_cron = '@daily'
);
