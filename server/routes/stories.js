const { readJsonBody, sendJson, publicUser } = require('../auth');
const { uid } = require('../db');

async function handleStoryRoutes({ req, res, pathname, db, authUser, wsHub }) {
  if (!pathname.startsWith('/api/stories')) return false;
  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/stories' && req.method === 'GET') {
    const now = Date.now();
    db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now);
    const rows = db.prepare('SELECT * FROM stories WHERE expires_at > ? ORDER BY created_at ASC').all(now);
    const byAuthor = new Map();

    for (const s of rows) {
      let viewedBy = [];
      try { viewedBy = JSON.parse(s.viewed_by || '[]'); } catch {}
      const item = {
        id: s.id,
        authorId: s.author_id,
        mediaData: s.media_data,
        caption: s.caption,
        captionY: s.caption_y,
        bgGradient: s.bg_gradient,
        durationSec: s.duration_sec,
        viewedBy,
        seenByMe: viewedBy.some((v) => v.userId === authUser.id),
        createdAt: s.created_at,
        expiresAt: s.expires_at
      };
      if (!byAuthor.has(s.author_id)) {
        const authorRow = db.prepare('SELECT * FROM users WHERE id = ?').get(s.author_id);
        if (!authorRow) continue;
        byAuthor.set(s.author_id, { author: publicUser(authorRow), stories: [], hasUnseen: false });
      }
      const bucket = byAuthor.get(s.author_id);
      bucket.stories.push(item);
      if (!item.seenByMe && s.author_id !== authUser.id) bucket.hasUnseen = true;
    }

    const groups = Array.from(byAuthor.values()).sort((a, b) => {
      if (a.author.id === authUser.id) return -1;
      if (b.author.id === authUser.id) return 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return b.stories[b.stories.length - 1].createdAt - a.stories[a.stories.length - 1].createdAt;
    });

    return sendJson(res, 200, { storyGroups: groups });
  }

  if (pathname === '/api/stories' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const mediaData = String(body.mediaData || '').slice(0, 8_000_000);
    if (!mediaData) return sendJson(res, 400, { error: 'Story image or canvas required.' });

    const caption = String(body.caption || '').trim().slice(0, 140);
    const captionY = Number(body.captionY ?? 0.6);
    const bgGradient = String(body.bgGradient || 'linear-gradient(135deg,#8B5CF6,#FACC15)');
    const durationSec = Math.max(3, Math.min(15, Number(body.durationSec || 6)));
    const now = Date.now();
    const expiresAt = now + 24 * 3600 * 1000;
    const id = uid('sty_');

    db.prepare(`
      INSERT INTO stories (id, author_id, media_data, caption, caption_y, bg_gradient, duration_sec, viewed_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(id, authUser.id, mediaData, caption, captionY, bgGradient, durationSec, now, expiresAt);

    db.prepare('UPDATE users SET snap_score = snap_score + 3 WHERE id = ?').run(authUser.id);
    wsHub.broadcastAll('story:new', { storyId: id, authorId: authUser.id });
    return sendJson(res, 201, { id, expiresAt });
  }

  const viewMatch = pathname.match(/^\/api\/stories\/([^/]+)\/view$/);
  if (viewMatch && req.method === 'POST') {
    const storyId = viewMatch[1];
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
    if (!row) return sendJson(res, 404, { error: 'Story expired or not found.' });

    let viewedBy = [];
    try { viewedBy = JSON.parse(row.viewed_by || '[]'); } catch {}
    if (!viewedBy.some((v) => v.userId === authUser.id)) {
      viewedBy.push({ userId: authUser.id, displayName: authUser.display_name, username: authUser.username, viewedAt: Date.now() });
      db.prepare('UPDATE stories SET viewed_by = ? WHERE id = ?').run(JSON.stringify(viewedBy), storyId);
    }
    return sendJson(res, 200, { ok: true, viewedBy });
  }

  const delMatch = pathname.match(/^\/api\/stories\/([^/]+)$/);
  if (delMatch && req.method === 'DELETE') {
    const storyId = delMatch[1];
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
    if (!row) return sendJson(res, 404, { error: 'Story not found.' });
    if (row.author_id !== authUser.id) return sendJson(res, 403, { error: 'Forbidden.' });
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
    wsHub.broadcastAll('story:new', { deletedId: storyId });
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

module.exports = { handleStoryRoutes };
