const { readJsonBody, sendJson, publicUser, isPlusActive, safeDataUrl, PLUS_REACTIONS, PLUS_STICKERS, PLUS_EFFECTS } = require('../auth');
const { uid, dayKey } = require('../db');

function parseJsonSafe(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function hydrateMessage(db, row, viewerId) {
  const authorRow = db.prepare('SELECT * FROM users WHERE id = ?').get(row.author_id);
  const openedBy = parseJsonSafe(row.opened_by, []);
  const reactions = parseJsonSafe(row.reactions, {});
  const snapMeta = parseJsonSafe(row.snap_meta, {});

  let replyTo = null;
  if (row.reply_to_id) {
    const r = db.prepare('SELECT id, author_id, kind, content FROM messages WHERE id = ?').get(row.reply_to_id);
    if (r) {
      const rAuthor = db.prepare('SELECT display_name FROM users WHERE id = ?').get(r.author_id);
      replyTo = { id: r.id, kind: r.kind, content: r.content, authorName: rAuthor ? rAuthor.display_name : 'Unknown' };
    }
  }

  const viewerOpened = openedBy.find((o) => o.userId === viewerId);
  const sealedForViewer = row.kind === 'snap' && row.author_id !== viewerId && Boolean(viewerOpened) && !row.is_saved;

  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    authorId: row.author_id,
    author: authorRow ? publicUser(authorRow) : null,
    kind: row.kind,
    content: row.content,
    mediaData: sealedForViewer ? '' : row.media_data,
    snapMeta,
    replyToId: row.reply_to_id || '',
    replyTo,
    isEphemeral: Boolean(row.is_ephemeral),
    ttlSec: Number(row.ttl_sec || 0),
    expiresAt: Number(row.expires_at || 0),
    isSaved: Boolean(row.is_saved),
    isPinned: Boolean(row.is_pinned),
    openedBy,
    viewerOpened: Boolean(viewerOpened),
    viewerReplayed: Boolean(viewerOpened && viewerOpened.replayed),
    reactions,
    effect: row.effect || '',
    createdAt: row.created_at
  };
}

function getScopeRecipients(db, scopeType, scopeId) {
  if (scopeType === 'channel') {
    const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(scopeId);
    if (!ch) return [];
    return db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(ch.server_id).map((m) => m.user_id);
  }
  if (scopeType === 'dm') {
    const dm = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(scopeId);
    return dm ? [dm.user_a, dm.user_b] : [];
  }
  return [];
}

function userCanAccessScope(db, userId, scopeType, scopeId) {
  if (scopeType === 'channel') {
    const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(scopeId);
    if (!ch) return false;
    return Boolean(db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(ch.server_id, userId));
  }
  if (scopeType === 'dm') {
    const dm = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(scopeId);
    return Boolean(dm && (dm.user_a === userId || dm.user_b === userId));
  }
  return false;
}

async function handleMessageRoutes({ req, res, pathname, urlObj, db, authUser, wsHub }) {
  if (!pathname.startsWith('/api/messages')) return false;
  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/messages' && req.method === 'GET') {
    const scopeType = urlObj.searchParams.get('scopeType');
    const scopeId = urlObj.searchParams.get('scopeId');
    if (!scopeType || !scopeId) return sendJson(res, 400, { error: 'Missing scopeType or scopeId.' });
    if (!userCanAccessScope(db, authUser.id, scopeType, scopeId)) {
      return sendJson(res, 403, { error: 'You do not have access to this conversation.' });
    }

    const now = Date.now();
    db.prepare('DELETE FROM messages WHERE scope_type = ? AND scope_id = ? AND expires_at > 0 AND expires_at <= ? AND is_saved = 0')
      .run(scopeType, scopeId, now);

    const rows = db
      .prepare('SELECT * FROM messages WHERE scope_type = ? AND scope_id = ? ORDER BY created_at ASC LIMIT 200')
      .all(scopeType, scopeId);

    return sendJson(res, 200, { messages: rows.map((r) => hydrateMessage(db, r, authUser.id)) });
  }

  if (pathname === '/api/messages' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const scopeType = body.scopeType;
    const scopeId = body.scopeId;
    if (!userCanAccessScope(db, authUser.id, scopeType, scopeId)) return sendJson(res, 403, { error: 'Access denied.' });

    // 'system' messages are made by the server only, never by people.
    const kind = ['text', 'snap', 'voice', 'sticker'].includes(body.kind) ? body.kind : 'text';
    const content = String(body.content || '').trim().slice(0, 2000);
    const mediaKinds = kind === 'voice' ? ['audio'] : ['image', 'video'];
    const mediaData = kind === 'snap' || kind === 'voice' ? safeDataUrl(String(body.mediaData || '').slice(0, 8_000_000), mediaKinds) : '';
    const plus = isPlusActive(authUser);
    if (kind === 'sticker' && (!plus || !PLUS_STICKERS.includes(content))) {
      return sendJson(res, 403, { error: 'Premium stickers are part of VYRO+.' });
    }
    const effect = PLUS_EFFECTS.includes(body.effect) ? body.effect : '';
    if (effect && !plus) return sendJson(res, 403, { error: 'Message effects are part of VYRO+.' });
    const snapMeta = body.snapMeta ? JSON.stringify(body.snapMeta) : '{}';
    const replyToId = String(body.replyToId || '');
    const ttlSec = Math.max(0, Math.min(86400, Number(body.ttlSec || 0)));
    const isEphemeral = ttlSec > 0 || Boolean(body.isEphemeral);
    const now = Date.now();
    const expiresAt = kind !== 'snap' && ttlSec > 0 ? now + ttlSec * 1000 : 0;

    if (kind === 'text' && !content) return sendJson(res, 400, { error: 'Message cannot be empty.' });
    if ((kind === 'snap' || kind === 'voice') && !mediaData) return sendJson(res, 400, { error: 'Missing Snap/Audio payload.' });

    const msgId = uid('msg_');
    db.prepare(`
      INSERT INTO messages (
        id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
        reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, effect, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '[]', '{}', ?, ?)
    `).run(msgId, scopeType, scopeId, authUser.id, kind, content, mediaData, snapMeta, replyToId, isEphemeral ? 1 : 0, ttlSec, expiresAt, effect, now);

    if (scopeType === 'dm') {
      db.prepare('UPDATE dm_threads SET last_message_at = ? WHERE id = ?').run(now, scopeId);
      const dm = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(scopeId);
      if (dm && kind === 'snap') {
        const fr = db.prepare('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?').get(dm.user_a, dm.user_b);
        if (fr) {
          const today = dayKey(now);
          const yesterday = dayKey(now - 86400000);
          let nextStreak = fr.streak_count || 0;
          if (!fr.streak_last_day || fr.streak_last_day === yesterday) nextStreak = Math.max(1, nextStreak + 1);
          else if (fr.streak_last_day !== today) nextStreak = 1;
          else if (nextStreak === 0) nextStreak = 1;
          db.prepare('UPDATE friendships SET streak_count = ?, streak_last_day = ?, last_snap_at = ? WHERE id = ?')
            .run(nextStreak, today, now, fr.id);
        }
      }
    }

    if (kind === 'snap') db.prepare('UPDATE users SET snap_score = snap_score + 2 WHERE id = ?').run(authUser.id);

    const savedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    const recipients = getScopeRecipients(db, scopeType, scopeId);
    for (const rid of recipients) {
      wsHub.broadcastToUsers([rid], 'message:new', { message: hydrateMessage(db, savedRow, rid) });
    }

    if (scopeType === 'dm') {
      const dm = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(scopeId);
      const otherId = dm.user_a === authUser.id ? dm.user_b : dm.user_a;
      if (otherId === 'usr_vyro_bot') {
        const botTimer = setTimeout(() => {
          try {
            const replyId = uid('msg_');
            const replyText =
              kind === 'snap'
                ? '🔥 Nice Snap! Your Snap Score just went up +2 and your VYRO XP climbed!'
                : `Got your message ("${content.slice(0, 60)}")! Try sending a filtered Snap or hopping in Voice Chat ⚡`;
            const t = Date.now();
            db.prepare(`
              INSERT INTO messages (
                id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
                reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, created_at
              ) VALUES (?, 'dm', ?, 'usr_vyro_bot', 'text', ?, '', '{}', '', 0, 0, 0, 0, 0, '[]', '{}', ?)
            `).run(replyId, scopeId, replyText, t);
            const botRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(replyId);
            wsHub.broadcastToUsers([authUser.id], 'message:new', { message: hydrateMessage(db, botRow, authUser.id) });
          } catch {}
        }, 400);
        botTimer.unref();
      }
    }

    return sendJson(res, 201, { message: hydrateMessage(db, savedRow, authUser.id) });
  }

  const actionMatch = pathname.match(/^\/api\/messages\/([^/]+)\/(open-snap|replay-snap|screenshot|save|pin|react)$/);
  if (actionMatch && req.method === 'POST') {
    const msgId = actionMatch[1];
    const action = actionMatch[2];
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    if (!row) return sendJson(res, 404, { error: 'Message not found.' });
    if (!userCanAccessScope(db, authUser.id, row.scope_type, row.scope_id)) return sendJson(res, 403, { error: 'Access denied.' });

    const recipients = getScopeRecipients(db, row.scope_type, row.scope_id);

    if (action === 'open-snap') {
      const openedBy = parseJsonSafe(row.opened_by, []);
      if (!openedBy.some((o) => o.userId === authUser.id) && row.author_id !== authUser.id) {
        openedBy.push({ userId: authUser.id, openedAt: Date.now(), replayed: false });
        db.prepare('UPDATE messages SET opened_by = ? WHERE id = ?').run(JSON.stringify(openedBy), msgId);
        db.prepare('UPDATE users SET snap_score = snap_score + 1 WHERE id = ?').run(authUser.id);
      }
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:update', { message: hydrateMessage(db, updated, rid) });
      }
      return sendJson(res, 200, { message: hydrateMessage(db, updated, authUser.id), mediaData: row.media_data });
    }

    if (action === 'replay-snap') {
      const openedBy = parseJsonSafe(row.opened_by, []);
      const entry = openedBy.find((o) => o.userId === authUser.id);
      if (entry && entry.replayed && row.author_id !== authUser.id && !row.is_saved) {
        return sendJson(res, 400, { error: 'Snap was already replayed once!' });
      }
      if (entry) entry.replayed = true;
      else openedBy.push({ userId: authUser.id, openedAt: Date.now(), replayed: true });
      db.prepare('UPDATE messages SET opened_by = ? WHERE id = ?').run(JSON.stringify(openedBy), msgId);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:update', { message: hydrateMessage(db, updated, rid) });
      }
      return sendJson(res, 200, { message: hydrateMessage(db, updated, authUser.id), mediaData: row.media_data });
    }

    if (action === 'screenshot') {
      const sysId = uid('msg_');
      const now = Date.now();
      const text = `📸 ${authUser.display_name} captured/saved a screenshot of a Snap!`;
      db.prepare(`
        INSERT INTO messages (
          id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
          reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, created_at
        ) VALUES (?, ?, ?, ?, 'system', ?, '', '{}', '', 0, 0, 0, 0, 0, '[]', '{}', ?)
      `).run(sysId, row.scope_type, row.scope_id, authUser.id, text, now);
      const sysRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(sysId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:new', { message: hydrateMessage(db, sysRow, rid) });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'save') {
      const nextSaved = row.is_saved ? 0 : 1;
      db.prepare('UPDATE messages SET is_saved = ?, expires_at = ? WHERE id = ?')
        .run(nextSaved, nextSaved ? 0 : (row.ttl_sec > 0 ? Date.now() + row.ttl_sec * 1000 : 0), msgId);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:update', { message: hydrateMessage(db, updated, rid) });
      }
      return sendJson(res, 200, { message: hydrateMessage(db, updated, authUser.id) });
    }

    if (action === 'pin') {
      db.prepare('UPDATE messages SET is_pinned = ? WHERE id = ?').run(row.is_pinned ? 0 : 1, msgId);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:update', { message: hydrateMessage(db, updated, rid) });
      }
      return sendJson(res, 200, { message: hydrateMessage(db, updated, authUser.id) });
    }

    if (action === 'react') {
      const body = await readJsonBody(req);
      const emoji = String(body.emoji || '').trim().slice(0, 8);
      if (!emoji) return sendJson(res, 400, { error: 'Emoji required.' });
      if (PLUS_REACTIONS.includes(emoji) && !isPlusActive(authUser)) {
        const already = (parseJsonSafe(row.reactions, {})[emoji] || []).includes(authUser.id);
        if (!already) return sendJson(res, 403, { error: 'Premium reactions are part of VYRO+.' });
      }
      const reactions = parseJsonSafe(row.reactions, {});
      const list = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
      const idx = list.indexOf(authUser.id);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) delete reactions[emoji];
        else reactions[emoji] = list;
      } else {
        list.push(authUser.id);
        reactions[emoji] = list;
      }
      db.prepare('UPDATE messages SET reactions = ? WHERE id = ?').run(JSON.stringify(reactions), msgId);
      const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
      for (const rid of recipients) {
        wsHub.broadcastToUsers([rid], 'message:update', { message: hydrateMessage(db, updated, rid) });
      }
      return sendJson(res, 200, { message: hydrateMessage(db, updated, authUser.id) });
    }
  }

  const delMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (delMatch && req.method === 'DELETE') {
    const msgId = delMatch[1];
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msgId);
    if (!row) return sendJson(res, 404, { error: 'Message not found.' });
    if (row.author_id !== authUser.id) return sendJson(res, 403, { error: 'You can only delete your own messages.' });
    const recipients = getScopeRecipients(db, row.scope_type, row.scope_id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
    wsHub.broadcastToUsers(recipients, 'message:delete', { id: msgId, scopeType: row.scope_type, scopeId: row.scope_id });
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

module.exports = { handleMessageRoutes, hydrateMessage };
