import { Hono } from 'hono';
import { query, queryOne, execute, makeError, createLogger } from '@acr/shared';

const log = createLogger({ name: 'notifications' });
const app = new Hono();

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/:agent_id/notifications — Get notifications for an agent.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/agent/:agent_id/notifications', async (c) => {
  const agentId = c.req.param('agent_id');
  const unreadOnly = c.req.query('read') !== 'true';
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)), 200);
  const since = c.req.query('since');
  if (since) {
    // Validate ISO 8601 format
    const parsed = new Date(since);
    if (isNaN(parsed.getTime())) {
      return c.json(makeError('INVALID_INPUT', 'Parameter "since" must be a valid ISO 8601 timestamp'), 400);
    }
  }

  const conditions: string[] = ['agent_id = $1'];
  const params: unknown[] = [agentId];

  if (unreadOnly) {
    conditions.push('read = false');
  }
  if (since) {
    params.push(since);
    conditions.push(`created_at > $${params.length}`);
  }

  params.push(limit);

  const notifications = await query<{
    id: string;
    skill_hash: string;
    notification_type: string;
    severity: string;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
    read: boolean;
    acknowledged: boolean;
    created_at: string;
  }>(
    `SELECT id AS "id", skill_hash AS "skill_hash",
            notification_type AS "notification_type", severity AS "severity",
            title AS "title", message AS "message", metadata AS "metadata",
            read AS "read", acknowledged AS "acknowledged",
            created_at::text AS "created_at"
     FROM skill_notifications
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  const unreadCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM skill_notifications
     WHERE agent_id = $1 AND read = false`,
    [agentId],
  );

  return c.json({
    notifications,
    unread_count: parseInt(unreadCount?.count ?? '0', 10),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/:agent_id/notifications/:id/read — Mark notification as read.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/agent/:agent_id/notifications/:id/read', async (c) => {
  const agentId = c.req.param('agent_id');
  const notifId = c.req.param('id');

  const updated = await execute(
    `UPDATE skill_notifications SET read = true
     WHERE id = $1 AND agent_id = $2`,
    [notifId, agentId],
  );

  if (updated === 0) {
    return c.json(makeError('NOT_FOUND', 'Notification not found'), 404);
  }

  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/:agent_id/notifications/:id/acknowledge — Acknowledge a threat.
// Records that the agent has reviewed the threat and chosen to proceed.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/agent/:agent_id/notifications/:id/acknowledge', async (c) => {
  const agentId = c.req.param('agent_id');
  const notifId = c.req.param('id');

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch { /* no body is ok */ }

  const reason = (body.reason as string) ?? null;

  // Get the notification
  const notif = await queryOne<{ skill_hash: string; severity: string; metadata: Record<string, unknown> }>(
    `SELECT skill_hash AS "skill_hash", severity AS "severity", metadata AS "metadata"
     FROM skill_notifications WHERE id = $1 AND agent_id = $2`,
    [notifId, agentId],
  );

  if (!notif) {
    return c.json(makeError('NOT_FOUND', 'Notification not found'), 404);
  }

  // Mark notification as acknowledged
  await execute(
    `UPDATE skill_notifications SET acknowledged = true, acknowledged_at = now(), read = true
     WHERE id = $1`,
    [notifId],
  );

  // Record the acknowledgement
  const threatPatterns = (notif.metadata as Record<string, unknown>).threat_patterns as string[] ?? [];
  await execute(
    `INSERT INTO threat_acknowledgements (agent_id, skill_hash, threat_level, threat_patterns, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '30 days')
     ON CONFLICT (agent_id, skill_hash) DO UPDATE SET
       threat_level = EXCLUDED.threat_level,
       threat_patterns = EXCLUDED.threat_patterns,
       reason = EXCLUDED.reason,
       acknowledged_at = now(),
       expires_at = now() + INTERVAL '30 days'`,
    [agentId, notif.skill_hash, notif.severity, threatPatterns, reason],
  );

  log.info({ agentId, skillHash: notif.skill_hash, severity: notif.severity }, 'Threat acknowledged');

  return c.json({ success: true, expires_in_days: 30 });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /agent/:agent_id/subscriptions — List active subscriptions.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/agent/:agent_id/subscriptions', async (c) => {
  const agentId = c.req.param('agent_id');

  const subs = await query<{
    id: string;
    skill_hash: string;
    notify_on: string;
    min_threat_level: string;
    active: boolean;
    created_at: string;
    skill_name: string | null;
    skill_source: string | null;
  }>(
    `SELECT s.id AS "id", s.skill_hash AS "skill_hash",
            s.notify_on AS "notify_on", s.min_threat_level AS "min_threat_level",
            s.active AS "active", s.created_at::text AS "created_at",
            sc.skill_name AS "skill_name", sc.skill_source AS "skill_source"
     FROM skill_subscriptions s
     LEFT JOIN skill_catalog sc ON sc.current_hash = s.skill_hash
     WHERE s.agent_id = $1 AND s.active = true
     ORDER BY s.created_at DESC`,
    [agentId],
  );

  return c.json({ subscriptions: subs });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/:agent_id/subscriptions — Create or update a subscription.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/agent/:agent_id/subscriptions', async (c) => {
  const agentId = c.req.param('agent_id');
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json(makeError('INVALID_INPUT', 'JSON required'), 400); }

  const skillHash = body.skill_hash as string;
  if (!skillHash) return c.json(makeError('INVALID_INPUT', 'skill_hash required'), 400);

  const notifyOn = (body.notify_on as string) ?? null;
  const minThreatLevel = (body.min_threat_level as string) ?? null;
  if (!notifyOn) return c.json(makeError('INVALID_INPUT', 'notify_on required'), 400);
  if (!minThreatLevel) return c.json(makeError('INVALID_INPUT', 'min_threat_level required'), 400);

  await execute(
    `INSERT INTO skill_subscriptions (agent_id, skill_hash, notify_on, min_threat_level)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, skill_hash) DO UPDATE SET
       notify_on = EXCLUDED.notify_on,
       min_threat_level = EXCLUDED.min_threat_level,
       active = true`,
    [agentId, skillHash, notifyOn, minThreatLevel],
  );

  return c.json({ success: true }, 201);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /agent/:agent_id/subscriptions/:skill_hash — Unsubscribe.
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/agent/:agent_id/subscriptions/:skill_hash', async (c) => {
  const agentId = c.req.param('agent_id');
  const skillHash = c.req.param('skill_hash');

  await execute(
    `UPDATE skill_subscriptions SET active = false
     WHERE agent_id = $1 AND skill_hash = $2`,
    [agentId, skillHash],
  );

  return c.json({ success: true });
});

export { app as notificationsRoute };
