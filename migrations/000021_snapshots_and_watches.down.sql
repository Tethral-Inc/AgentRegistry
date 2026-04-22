-- Reverse migration 000021.

DROP INDEX IF EXISTS skill_notifications@idx_notif_source;
ALTER TABLE skill_notifications DROP COLUMN IF EXISTS source;
ALTER TABLE skill_notifications ALTER COLUMN skill_hash SET NOT NULL;

DROP TABLE IF EXISTS watches;
DROP TABLE IF EXISTS snapshots;
