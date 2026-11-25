const {
  hashPassword,
  verifyPassword,
  signToken,
  readJsonBody,
  sendJson,
  publicUser
} = require('../auth');
const { uid, onboardNewUser } = require('../db');

function randomDiscriminator(db, usernameLower) {
  for (let i = 0; i < 20; i++) {
    const disc = String(Math.floor(1000 + Math.random() * 9000));
    const exists = db
      .prepare('SELECT 1 FROM users WHERE username_lower = ? AND discriminator = ?')
      .get(usernameLower, disc);
    if (!exists) return disc;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function cookieHeader(token, maxAgeSec = 30 * 24 * 3600) {
  return `vyro_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

async function handleAuthRoutes({ req, res, pathname, urlObj, db, dataDir, authUser, wsHub }) {
  if (pathname === '/api/auth/check-username' && req.method === 'GET') {
    const raw = (urlObj.searchParams.get('username') || '').trim();
    if (raw.length < 3 || raw.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(raw)) {
      return sendJson(res, 200, { available: false, reason: 'Use 3–20 letters, numbers, underscores, dots, or hyphens.' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(raw.toLowerCase());
    return sendJson(res, 200, { available: !taken, reason: taken ? 'That username is already claimed.' : 'Username available!' });
  }

  if (pathname === '/api/auth/demo-users' && req.method === 'GET') {
    const rows = db
      .prepare("SELECT * FROM users WHERE is_bot = 0 AND email LIKE '%@vyro.app' ORDER BY created_at ASC LIMIT 4")
      .all();
    return sendJson(res, 200, { users: rows.map(publicUser) });
  }

  if (pathname === '/api/auth/nearby-accounts' && req.method === 'GET') {
    const rows = db
      .prepare("SELECT * FROM users WHERE is_bot = 0 ORDER BY created_at DESC LIMIT 20")
      .all();
    return sendJson(res, 200, { users: rows.map(publicUser) });
  }

  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || username).trim();
    const birthday = String(body.birthday || '').trim();
    const bio = String(body.bio || '').trim().slice(0, 180);
    const statusText = String(body.statusText || 'New on VYRO ⚡').trim().slice(0, 80);
    const recoveryHint = String(body.recoveryHint || '').trim().slice(0, 80);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Please enter a valid email address.' });
    }
    if (username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return sendJson(res, 400, { error: 'Username must be 3–20 characters (letters, numbers, _ . -).' });
    }
    if (password.length < 6) {
      return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
    }
    if (birthday) {
      const birthDate = new Date(birthday);
      const ageMs = Date.now() - birthDate.getTime();
      if (!Number.isNaN(ageMs) && ageMs < 13 * 365.25 * 24 * 3600 * 1000) {
        return sendJson(res, 400, { error: 'You must be at least 13 years old to join VYRO.' });
      }
    }

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return sendJson(res, 409, { error: 'An account with this email already exists.' });
    }
    if (db.prepare('SELECT id FROM users WHERE username_lower = ?').get(username.toLowerCase())) {
      return sendJson(res, 409, { error: 'That username is already taken.' });
    }

    let disc = String(body.discriminator || '').replace(/\D/g, '').slice(0, 4);
    if (disc.length !== 4) disc = randomDiscriminator(db, username.toLowerCase());

    const avatarType = body.avatarType === 'image' && body.avatarUrl ? 'image' : 'svg';
    const avatarUrl = avatarType === 'image' ? String(body.avatarUrl).slice(0, 2_000_000) : '';
    const defaultAvatar = {
      bg: 'linear-gradient(135deg,#8B5CF6,#FACC15)',
      skin: '#F5C9A6',
      hair: 'short',
      eyes: 'happy',
      outfit: '#6D28D9',
      accent: '#FACC15',
      badge: '⚡'
    };
    const avatarConfig = JSON.stringify(body.avatarConfig || defaultAvatar);

    const id = uid('usr_');
    const now = Date.now();
    const passHash = hashPassword(password);

    db.prepare(`
      INSERT INTO users (
        id, email, username, username_lower, discriminator, display_name,
        password_hash, birthday, bio, status_text, presence,
        avatar_type, avatar_config, avatar_url, snap_score, is_bot, recovery_hint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, 10, 0, ?, ?)
    `).run(
      id, email, username, username.toLowerCase(), disc, displayName || username,
      passHash, birthday, bio, statusText,
      avatarType, avatarConfig, avatarUrl, recoveryHint, now
    );

    onboardNewUser(db, id);
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const user = publicUser(row);
    const token = signToken({ userId: user.id }, dataDir);
    wsHub.broadcastAll('server:update', { serverId: 'srv_vyro_hq' });

    return sendJson(res, 201, { token, user }, { 'Set-Cookie': cookieHeader(token) });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier || '').trim();
    const password = String(body.password || '');
    const remember = body.remember !== false;

    if (!identifier || !password) {
      return sendJson(res, 400, { error: 'Enter your username or email and password.' });
    }

    let row = null;
    if (identifier.includes('@')) {
      row = db.prepare('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase());
    } else if (identifier.includes('#')) {
      const [uname, disc] = identifier.split('#');
      row = db
        .prepare('SELECT * FROM users WHERE username_lower = ? AND discriminator = ?')
        .get(uname.trim().toLowerCase(), (disc || '').trim());
    } else {
      row = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(identifier.toLowerCase());
    }

    if (!row || !verifyPassword(password, row.password_hash)) {
      return sendJson(res, 401, { error: 'Invalid credentials. Check your username/email and password.' });
    }

    db.prepare("UPDATE users SET presence = 'online' WHERE id = ?").run(row.id);
    row.presence = 'online';

    const user = publicUser(row);
    const ttl = remember ? 30 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
    const token = signToken({ userId: user.id }, dataDir, ttl);
    wsHub.broadcastAll('presence:update', { userId: user.id, presence: 'online' });

    return sendJson(res, 200, { token, user }, { 'Set-Cookie': cookieHeader(token, Math.floor(ttl / 1000)) });
  }

  if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier || '').trim().toLowerCase();
    const recoveryHint = String(body.recoveryHint || '').trim();
    const newPassword = String(body.newPassword || '');

    if (!identifier || newPassword.length < 6) {
      return sendJson(res, 400, { error: 'Provide account identifier and a new password (6+ chars).' });
    }

    const row = identifier.includes('@')
      ? db.prepare('SELECT * FROM users WHERE email = ?').get(identifier)
      : db.prepare('SELECT * FROM users WHERE username_lower = ?').get(identifier);

    if (!row) return sendJson(res, 404, { error: 'No matching account found.' });
    if (row.recovery_hint && row.recovery_hint.toLowerCase() !== recoveryHint.toLowerCase()) {
      return sendJson(res, 403, { error: 'Recovery phrase does not match the one set at signup.' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.id);
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
    return sendJson(res, 200, { ok: true, message: 'Password updated! You can now log in.' });
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!authUser) return sendJson(res, 401, { error: 'Not signed in.' });
    return sendJson(res, 200, { user: publicUser(authUser) });
  }

  if (pathname === '/api/auth/me' && req.method === 'PATCH') {
    if (!authUser) return sendJson(res, 401, { error: 'Not signed in.' });
    const body = await readJsonBody(req);
    const displayName = body.displayName !== undefined ? String(body.displayName).trim().slice(0, 32) : authUser.display_name;
    const bio = body.bio !== undefined ? String(body.bio).trim().slice(0, 180) : authUser.bio;
    const statusText = body.statusText !== undefined ? String(body.statusText).trim().slice(0, 80) : authUser.status_text;
    const presence = ['online', 'idle', 'dnd', 'offline'].includes(body.presence) ? body.presence : authUser.presence;
    const avatarType = body.avatarType === 'image' || body.avatarType === 'svg' ? body.avatarType : authUser.avatar_type;
    const avatarUrl = body.avatarUrl !== undefined ? String(body.avatarUrl).slice(0, 2_000_000) : authUser.avatar_url;
    const avatarConfig = body.avatarConfig !== undefined ? JSON.stringify(body.avatarConfig) : authUser.avatar_config;

    db.prepare(`
      UPDATE users
      SET display_name = ?, bio = ?, status_text = ?, presence = ?, avatar_type = ?, avatar_config = ?, avatar_url = ?
      WHERE id = ?
    `).run(displayName || authUser.username, bio, statusText, presence, avatarType, avatarConfig, avatarUrl, authUser.id);

    const updated = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(authUser.id));
    wsHub.broadcastAll('presence:update', { userId: updated.id, presence: updated.presence, user: updated });
    return sendJson(res, 200, { user: updated });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    if (authUser) {
      db.prepare("UPDATE users SET presence = 'offline' WHERE id = ?").run(authUser.id);
      wsHub.broadcastAll('presence:update', { userId: authUser.id, presence: 'offline' });
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }

  return false;
}

module.exports = { handleAuthRoutes };
