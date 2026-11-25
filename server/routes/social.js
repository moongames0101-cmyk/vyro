const { readJsonBody, sendJson, publicUser } = require('../auth');
const { uid } = require('../db');

async function handleSocialRoutes({ req, res, pathname, urlObj, db, authUser, wsHub }) {
  if (!pathname.startsWith('/api/friends') && !pathname.startsWith('/api/dms') && !pathname.startsWith('/api/users')) {
    return false;
  }
  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/users/search' && req.method === 'GET') {
    const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
    let rows;
    if (!q) {
      rows = db.prepare('SELECT * FROM users WHERE id != ? ORDER BY snap_score DESC LIMIT 20').all(authUser.id);
    } else {
      const [namePart, discPart] = q.split('#');
      if (discPart) {
        rows = db
          .prepare('SELECT * FROM users WHERE id != ? AND username_lower LIKE ? AND discriminator LIKE ? LIMIT 20')
          .all(authUser.id, `%${namePart}%`, `%${discPart}%`);
      } else {
        rows = db
          .prepare('SELECT * FROM users WHERE id != ? AND (username_lower LIKE ? OR LOWER(display_name) LIKE ?) LIMIT 20')
          .all(authUser.id, `%${q}%`, `%${q}%`);
      }
    }
    return sendJson(res, 200, { users: rows.map(publicUser) });
  }

  if (pathname === '/api/friends' && req.method === 'GET') {
    const rows = db
      .prepare('SELECT * FROM friendships WHERE user_a = ? OR user_b = ? ORDER BY last_snap_at DESC, created_at DESC')
      .all(authUser.id, authUser.id);

    const friends = [];
    const incoming = [];
    const outgoing = [];

    for (const f of rows) {
      const otherId = f.user_a === authUser.id ? f.user_b : f.user_a;
      const otherRow = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
      if (!otherRow) continue;
      const other = publicUser(otherRow);

      if (f.status === 'accepted') {
        const [uA, uB] = [authUser.id, otherId].sort();
        const dmId = `dm_${uA}_${uB}`;
        let thread = db.prepare('SELECT * FROM dm_threads WHERE id = ?').get(dmId);
        if (!thread) {
          db.prepare('INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)')
            .run(dmId, uA, uB, f.created_at);
          thread = { id: dmId, user_a: uA, user_b: uB, last_message_at: f.created_at };
        }

        const lastMsg = db
          .prepare("SELECT id, author_id, kind, content, created_at, opened_by FROM messages WHERE scope_type = 'dm' AND scope_id = ? ORDER BY created_at DESC LIMIT 1")
          .get(dmId);

        let unopenedSnapCount = 0;
        const snapRows = db
          .prepare("SELECT author_id, opened_by FROM messages WHERE scope_type = 'dm' AND scope_id = ? AND kind = 'snap' AND author_id != ?")
          .all(dmId, authUser.id);
        for (const sr of snapRows) {
          let opened = [];
          try { opened = JSON.parse(sr.opened_by || '[]'); } catch {}
          if (!opened.some((o) => o.userId === authUser.id)) unopenedSnapCount++;
        }

        const today = new Date().toISOString().slice(0, 10);
        const streakExpiring = f.streak_count > 0 && f.streak_last_day && f.streak_last_day !== today;

        friends.push({
          friendshipId: f.id,
          dmId,
          user: other,
          streakCount: f.streak_count || 0,
          streakExpiring,
          lastMessageAt: thread.last_message_at || f.created_at,
          lastMessage: lastMsg || null,
          unopenedSnapCount
        });
      } else if (f.status === 'pending') {
        const entry = { friendshipId: f.id, user: other, createdAt: f.created_at };
        if (f.requester_id === authUser.id) outgoing.push(entry);
        else incoming.push(entry);
      }
    }

    return sendJson(res, 200, { friends, incoming, outgoing });
  }

  if (pathname === '/api/friends/request' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const target = String(body.target || '').trim();
    if (!target) return sendJson(res, 400, { error: 'Enter a username or username#tag.' });

    let other = null;
    if (target.startsWith('usr_')) {
      other = db.prepare('SELECT * FROM users WHERE id = ?').get(target);
    } else if (target.includes('#')) {
      const [uname, disc] = target.split('#');
      other = db
        .prepare('SELECT * FROM users WHERE username_lower = ? AND discriminator = ?')
        .get(uname.trim().toLowerCase(), (disc || '').trim());
    } else {
      other = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(target.toLowerCase());
    }

    if (!other) return sendJson(res, 404, { error: `No VYRO user found matching "${target}".` });
    if (other.id === authUser.id) return sendJson(res, 400, { error: 'You cannot add yourself.' });

    const [uA, uB] = [authUser.id, other.id].sort();
    const existing = db.prepare('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?').get(uA, uB);

    if (existing) {
      if (existing.status === 'accepted') return sendJson(res, 200, { status: 'accepted', message: 'You are already friends!' });
      if (existing.requester_id !== authUser.id) {
        db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(existing.id);
        const dmId = `dm_${uA}_${uB}`;
        db.prepare('INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)')
          .run(dmId, uA, uB, Date.now());
        wsHub.broadcastToUsers([authUser.id, other.id], 'friend:accept', { friendshipId: existing.id });
        return sendJson(res, 200, { status: 'accepted', message: `You and ${other.display_name} are now friends!` });
      }
      return sendJson(res, 200, { status: 'pending', message: 'Friend request already sent.' });
    }

    const frId = uid('fr_');
    const now = Date.now();
    const autoAccept = Boolean(other.is_bot);
    db.prepare(`
      INSERT INTO friendships (id, user_a, user_b, status, requester_id, streak_count, streak_last_day, last_snap_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, '', 0, ?)
    `).run(frId, uA, uB, autoAccept ? 'accepted' : 'pending', authUser.id, now);

    if (autoAccept) {
      const dmId = `dm_${uA}_${uB}`;
      db.prepare('INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)')
        .run(dmId, uA, uB, now);
      wsHub.broadcastToUsers([authUser.id], 'friend:accept', { friendshipId: frId });
    } else {
      wsHub.broadcastToUsers([other.id], 'friend:request', { friendshipId: frId, from: publicUser(authUser) });
    }

    return sendJson(res, 201, {
      status: autoAccept ? 'accepted' : 'pending',
      message: autoAccept ? `Added ${other.display_name}!` : `Friend request sent to ${other.username}#${other.discriminator}!`
    });
  }

  if (pathname === '/api/friends/respond' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const { friendshipId, action } = body;
    const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
    if (!row || (row.user_a !== authUser.id && row.user_b !== authUser.id)) {
      return sendJson(res, 404, { error: 'Friend request not found.' });
    }
    if (action === 'accept') {
      db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(row.id);
      const dmId = `dm_${row.user_a}_${row.user_b}`;
      db.prepare('INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)')
        .run(dmId, row.user_a, row.user_b, Date.now());
      wsHub.broadcastToUsers([row.user_a, row.user_b], 'friend:accept', { friendshipId: row.id, dmId });
      return sendJson(res, 200, { ok: true, status: 'accepted', dmId });
    }
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
    wsHub.broadcastToUsers([row.user_a, row.user_b], 'friend:accept', { friendshipId: row.id });
    return sendJson(res, 200, { ok: true, status: 'declined' });
  }

  if (pathname === '/api/dms/open' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const otherId = String(body.userId || '');
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(otherId);
    if (!other || other.id === authUser.id) return sendJson(res, 404, { error: 'User not found.' });
    const [uA, uB] = [authUser.id, other.id].sort();
    const dmId = `dm_${uA}_${uB}`;
    const now = Date.now();
    db.prepare('INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)')
      .run(dmId, uA, uB, now);
    const fr = db.prepare('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?').get(uA, uB);
    if (!fr) {
      db.prepare(`
        INSERT INTO friendships (id, user_a, user_b, status, requester_id, streak_count, streak_last_day, last_snap_at, created_at)
        VALUES (?, ?, ?, 'accepted', ?, 0, '', 0, ?)
      `).run(uid('fr_'), uA, uB, authUser.id, now);
      wsHub.broadcastToUsers([authUser.id, other.id], 'friend:accept', { dmId });
    }
    return sendJson(res, 200, { dmId, user: publicUser(other) });
  }

  return false;
}

module.exports = { handleSocialRoutes };
