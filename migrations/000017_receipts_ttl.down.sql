-- Revert migration 000017
ALTER TABLE interaction_receipts RESET (ttl_expiration_expression, ttl_job_cron);
