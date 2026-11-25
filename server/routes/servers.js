const crypto = require('node:crypto');
const { readJsonBody, sendJson, publicUser } = require('../auth');
const { uid } = require('../db');

function randomInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function hydrateServer(db, srv) {
  const channels = db
    .prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, name ASC')
    .all(srv.id)
    .map((c) => ({
      id: c.id,
      serverId: c.server_id,
      category: c.category,
      name: c.name,
      type: c.type,
      topic: c.topic,
      defaultTtlSec: c.default_ttl_sec,
      position: c.position
    }));

  const members = db
    .prepare(`
      SELECT u.*, sm.role, sm.role_color, sm.joined_at
      FROM server_members sm
      JOIN users u ON u.id = sm.user_id
      WHERE sm.server_id = ?
      ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 WHEN 'bot' THEN 4 ELSE 3 END, u.username ASC
    `)
    .all(srv.id)
    .map((m) => ({
      ...publicUser(m),
      role: m.role,
      roleColor: m.role_color,
      joinedAt: m.joined_at
    }));

  return {
    id: srv.id,
    name: srv.name,
    iconEmoji: srv.icon_emoji,
    iconColor: srv.icon_color,
    bannerColor: srv.banner_color,
    description: srv.description,
    ownerId: srv.owner_id,
    inviteCode: srv.invite_code,
    createdAt: srv.created_at,
    channels,
    members
  };
}

async function handleServerRoutes({ req, res, pathname, db, authUser, wsHub }) {
  if (!pathname.startsWith('/api/servers')) return false;
  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/servers' && req.method === 'GET') {
    const rows = db
      .prepare(`
        SELECT s.* FROM servers s
        JOIN server_members sm ON sm.server_id = s.id
        WHERE sm.user_id = ?
        ORDER BY s.created_at ASC
      `)
      .all(authUser.id);
    return sendJson(res, 200, {
      servers: rows.map((s) => hydrateServer(db, s)),
      voiceState: wsHub.getVoiceStateSnapshot()
    });
  }

  if (pathname === '/api/servers' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (name.length < 2) return sendJson(res, 400, { error: 'Server name must be at least 2 characters.' });

    const iconEmoji = String(body.iconEmoji || '🚀').slice(0, 8);
    const iconColor = String(body.iconColor || 'linear-gradient(135deg,#8B5CF6,#FACC15)');
    const description = String(body.description || `${name} community hub on VYRO.`).slice(0, 160);
    const srvId = uid('srv_');
    const inviteCode = randomInviteCode();
    const now = Date.now();

    db.prepare(`
      INSERT INTO servers (id, name, icon_emoji, icon_color, banner_color, description, owner_id, invite_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(srvId, name, iconEmoji, iconColor, iconColor, description, authUser.id, inviteCode, now);

    db.prepare(`
      INSERT INTO server_members (server_id, user_id, role, role_color, joined_at)
      VALUES (?, ?, 'owner', '#FACC15', ?)
    `).run(srvId, authUser.id, now);

    const defaults = [
      [uid('ch_'), srvId, 'TEXT CHANNELS', 'general', 'text', `Welcome to ${name}!`, 0, 1],
      [uid('ch_'), srvId, 'SNAP ROOMS', 'flash-snaps', 'ephemeral', 'Disappearing 15s snaps & chats.', 15, 2],
      [uid('ch_'), srvId, 'VOICE & STAGE', 'Voice Chat', 'voice', 'Hang out live.', 0, 3]
    ];
    const insCh = db.prepare(`
      INSERT INTO channels (id, server_id, category, name, type, topic, default_ttl_sec, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of defaults) insCh.run(...d);

    const server = hydrateServer(db, db.prepare('SELECT * FROM servers WHERE id = ?').get(srvId));
    wsHub.broadcastToUsers([authUser.id], 'server:update', { serverId: srvId });
    return sendJson(res, 201, { server });
  }

  if (pathname === '/api/servers/join' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const code = String(body.inviteCode || '').trim().toUpperCase();
    if (!code) return sendJson(res, 400, { error: 'Enter an invite code (e.g. VYROHQ or GAME24).' });

    const srv = db.prepare('SELECT * FROM servers WHERE UPPER(invite_code) = ?').get(code);
    if (!srv) return sendJson(res, 404, { error: `No server found for invite code "${code}".` });

    db.prepare(`
      INSERT OR IGNORE INTO server_members (server_id, user_id, role, role_color, joined_at)
      VALUES (?, ?, 'member', '#E2E8F0', ?)
    `).run(srv.id, authUser.id, Date.now());

    const server = hydrateServer(db, srv);
    wsHub.broadcastToUsers(server.members.map((m) => m.id), 'server:update', { serverId: srv.id });
    return sendJson(res, 200, { server });
  }

  const channelMatch = pathname.match(/^\/api\/servers\/([^/]+)\/channels$/);
  if (channelMatch && req.method === 'POST') {
    const serverId = channelMatch[1];
    const membership = db
      .prepare('SELECT role FROM server_members WHERE server_id = ? AND user_id = ?')
      .get(serverId, authUser.id);
    if (!membership) return sendJson(res, 403, { error: 'Not a member of this server.' });

    const body = await readJsonBody(req);
    const rawName = String(body.name || '').trim().slice(0, 32);
    if (!rawName) return sendJson(res, 400, { error: 'Channel name is required.' });

    const type = ['text', 'ephemeral', 'voice'].includes(body.type) ? body.type : 'text';
    const name = type === 'voice' ? rawName : rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    const category = body.category || (type === 'ephemeral' ? 'SNAP ROOMS' : type === 'voice' ? 'VOICE & STAGE' : 'TEXT CHANNELS');
    const defaultTtlSec = type === 'ephemeral' ? Math.max(5, Math.min(300, Number(body.defaultTtlSec || 15))) : 0;
    const topic = String(body.topic || '').slice(0, 140);

    const chId = uid('ch_');
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM channels WHERE server_id = ?').get(serverId).m;
    db.prepare(`
      INSERT INTO channels (id, server_id, category, name, type, topic, default_ttl_sec, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chId, serverId, category, name || 'channel', type, topic, defaultTtlSec, maxPos + 1);

    const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId);
    wsHub.broadcastToUsers(members.map((m) => m.user_id), 'server:update', { serverId });
    return sendJson(res, 201, {
      channel: { id: chId, serverId, category, name: name || 'channel', type, topic, defaultTtlSec, position: maxPos + 1 }
    });
  }

  return false;
}

module.exports = { handleServerRoutes };
