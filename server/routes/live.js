// VYRO Live: hosting is for verified-by-birthday adults (18+) only.
// Anyone under 18 who is found going live is banned from going live permanently.
// Also holds reports and the small admin API used to review them.
const { readJsonBody, sendJson, publicUser, ageFromBirthday, rateLimit } = require('../auth');
const { uid } = require('../db');
const { grantPlusGift } = require('./plus');

const AUDIENCES = ['adults', 'everyone'];
const REPORT_KINDS = ['underage_live', 'inappropriate', 'harassment', 'spam', 'other'];

// ---------- face age scan ----------
// The scan runs on the host's own device; only the estimated age number arrives here.
// VYRO_FACE_CHECK=off turns it off. VYRO_FACE_MIN_AGE is the estimate needed to pass (default 18).
const FACE_PASS_VALID_MS = 15 * 60 * 1000;
const FACE_ATTEMPTS_PER_DAY = 6;
function faceCheckConfig() {
  const minAge = Number(process.env.VYRO_FACE_MIN_AGE) || 18;
  return { required: process.env.VYRO_FACE_CHECK !== 'off', minAge };
}

function recentFacePass(db, userId) {
  return db
    .prepare("SELECT * FROM age_checks WHERE user_id = ? AND kind = 'golive' AND passed = 1 AND created_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(userId, Date.now() - FACE_PASS_VALID_MS);
}

function attemptsToday(db, userId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM age_checks WHERE user_id = ? AND kind = 'golive' AND created_at > ?")
    .get(userId, Date.now() - 24 * 60 * 60 * 1000).n;
}

// Sends very young estimates to the Mod tab (at most one per person per day). Never bans by itself.
function flagYoungFace(db, wsHub, user, estimate, contextId, where) {
  const recent = db
    .prepare("SELECT 1 FROM reports WHERE target_user_id = ? AND kind = 'age_check' AND created_at > ?")
    .get(user.id, Date.now() - 24 * 60 * 60 * 1000);
  if (recent) return;
  const age = ageFromBirthday(user.birthday);
  const id = uid('rep');
  db.prepare(
    'INSERT INTO reports (id, reporter_id, target_user_id, kind, context_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    'system',
    user.id,
    'age_check',
    String(contextId || ''),
    `Face scan ${where} estimated about ${Math.round(estimate * 10) / 10}. Their date of birth says ${age === null ? 'unknown' : age}.`,
    'open',
    Date.now()
  );
  const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all().map((a) => a.id);
  wsHub.broadcastToUsers(admins, 'admin:report', { id, kind: 'age_check' });
}

function liveEligibility(user) {
  if (!user) return { ok: false, code: 'signin', error: 'Sign in first.' };
  if (user.live_banned) {
    return { ok: false, code: 'banned', error: 'Your account is permanently banned from going live.' };
  }
  const age = ageFromBirthday(user.birthday);
  if (age === null) return { ok: false, code: 'birthday_required', error: 'Add your date of birth to use VYRO Live.' };
  if (age < 18) return { ok: false, code: 'under_18', error: 'VYRO Live is for people aged 18 and over.' };
  return { ok: true };
}

function canWatch(live, viewer) {
  if (!live || !viewer) return false;
  if (live.audience === 'adults') {
    const age = ageFromBirthday(viewer.birthday);
    return age !== null && age >= 18;
  }
  return true;
}

function liveView(db, row, viewerCount = 0) {
  const host = db.prepare('SELECT * FROM users WHERE id = ?').get(row.host_id);
  return {
    id: row.id,
    title: row.title,
    audience: row.audience,
    startedAt: row.started_at,
    viewers: viewerCount,
    host: publicUser(host)
  };
}

function endLive(db, wsHub, liveId, reason) {
  const row = db.prepare('SELECT * FROM lives WHERE id = ?').get(liveId);
  if (!row || row.ended_at) return false;
  db.prepare('UPDATE lives SET ended_at = ?, ended_reason = ? WHERE id = ?').run(Date.now(), reason, liveId);
  if (wsHub.liveEnded) wsHub.liveEnded(liveId, reason);
  wsHub.broadcastAll('live:list-changed', {});
  return true;
}

function banFromLive(db, wsHub, userId, reason) {
  db.prepare('UPDATE users SET live_banned = 1, live_ban_reason = ?, live_banned_at = ? WHERE id = ?').run(
    String(reason || 'Under 18').slice(0, 200),
    Date.now(),
    userId
  );
  const active = db.prepare('SELECT id FROM lives WHERE host_id = ? AND ended_at = 0').all(userId);
  for (const l of active) endLive(db, wsHub, l.id, 'banned');
  wsHub.broadcastToUsers([userId], 'live:banned', { reason });
}

async function handleLiveRoutes({ req, res, pathname, db, authUser, wsHub }) {
  const isLive = pathname.startsWith('/api/live');
  const isReport = pathname === '/api/reports';
  const isAdmin = pathname.startsWith('/api/admin');
  if (!isLive && !isReport && !isAdmin) return false;
  if (!authUser) return sendJson(res, 401, { error: 'Authentication required.' });

  if (pathname === '/api/live' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM lives WHERE ended_at = 0 ORDER BY started_at DESC LIMIT 100').all();
    const lives = rows
      .filter((r) => r.host_id === authUser.id || canWatch(r, authUser))
      .map((r) => liveView(db, r, wsHub.liveViewerCount ? wsHub.liveViewerCount(r.id) : 0));
    return sendJson(res, 200, { lives, eligibility: liveEligibility(authUser), faceCheck: faceCheckConfig() });
  }

  if (pathname === '/api/live/age-check' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const kind = body.kind === 'spot' ? 'spot' : 'golive';
    const estimate = Number(body.estimate);
    const samples = Math.max(0, Math.min(500, Math.floor(Number(body.samples) || 0)));
    if (!(estimate >= 1 && estimate <= 100)) return sendJson(res, 400, { error: 'Bad scan result.' });
    const cfg = faceCheckConfig();

    if (kind === 'spot') {
      const live = db.prepare('SELECT * FROM lives WHERE id = ? AND host_id = ? AND ended_at = 0').get(String(body.liveId || ''), authUser.id);
      if (!live) return sendJson(res, 404, { error: 'Live not found.' });
      const limit = rateLimit(`face-spot:${authUser.id}`, 40, 60 * 60 * 1000);
      if (!limit.allowed) return sendJson(res, 429, { error: 'Too many checks.' });
      db.prepare('INSERT INTO age_checks (id, user_id, kind, estimate, samples, passed, live_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        uid('age'), authUser.id, 'spot', estimate, samples, estimate >= 18 ? 1 : 0, live.id, Date.now()
      );
      if (estimate < 16) flagYoungFace(db, wsHub, authUser, estimate, live.id, 'during a live');
      return sendJson(res, 200, { ok: true });
    }

    const elig = liveEligibility(authUser);
    if (!elig.ok) return sendJson(res, 403, { error: elig.error, code: elig.code });
    const used = attemptsToday(db, authUser.id);
    if (used >= FACE_ATTEMPTS_PER_DAY) {
      return sendJson(res, 429, { error: 'Too many age scans today. Try again tomorrow.', code: 'face_limit' });
    }
    const liveness = body.liveness === true;
    const passed = liveness && samples >= 8 && estimate >= cfg.minAge;
    db.prepare('INSERT INTO age_checks (id, user_id, kind, estimate, samples, passed, live_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      uid('age'), authUser.id, 'golive', estimate, samples, passed ? 1 : 0, '', Date.now()
    );
    if (liveness && samples >= 8 && estimate < 18) flagYoungFace(db, wsHub, authUser, estimate, '', 'before going live');
    return sendJson(res, 200, {
      passed,
      minAge: cfg.minAge,
      attemptsLeft: Math.max(0, FACE_ATTEMPTS_PER_DAY - used - 1),
      reason: passed ? '' : !liveness ? 'no_liveness' : samples < 8 ? 'too_few' : 'too_young'
    });
  }

  if (pathname === '/api/live/start' && req.method === 'POST') {
    const elig = liveEligibility(authUser);
    if (!elig.ok) return sendJson(res, 403, { error: elig.error, code: elig.code });
    if (faceCheckConfig().required && !recentFacePass(db, authUser.id)) {
      return sendJson(res, 403, { error: 'Do the quick age scan before going live.', code: 'face_check_required' });
    }
    const limit = rateLimit(`live-start:${authUser.id}`, 12, 60 * 60 * 1000);
    if (!limit.allowed) return sendJson(res, 429, { error: 'You have started a lot of lives. Try again later.' });
    const body = await readJsonBody(req);
    const title = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `${authUser.display_name} is live`;
    const audience = AUDIENCES.includes(body.audience) ? body.audience : 'adults';
    // One live at a time per host
    for (const l of db.prepare('SELECT id FROM lives WHERE host_id = ? AND ended_at = 0').all(authUser.id)) {
      endLive(db, wsHub, l.id, 'replaced');
    }
    const id = uid('live');
    db.prepare('INSERT INTO lives (id, host_id, title, audience, started_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      authUser.id,
      title,
      audience,
      Date.now()
    );
    wsHub.broadcastAll('live:list-changed', {});
    return sendJson(res, 200, { live: liveView(db, db.prepare('SELECT * FROM lives WHERE id = ?').get(id)) });
  }

  const endMatch = pathname.match(/^\/api\/live\/([^/]+)\/end$/);
  if (endMatch && req.method === 'POST') {
    const row = db.prepare('SELECT * FROM lives WHERE id = ?').get(endMatch[1]);
    if (!row) return sendJson(res, 404, { error: 'Live not found.' });
    if (row.host_id !== authUser.id && !authUser.is_admin) return sendJson(res, 403, { error: 'Only the host can end this live.' });
    endLive(db, wsHub, row.id, row.host_id === authUser.id ? 'host_ended' : 'admin_ended');
    return sendJson(res, 200, { ok: true });
  }

  if (isReport && req.method === 'POST') {
    const limit = rateLimit(`report:${authUser.id}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) return sendJson(res, 429, { error: 'Too many reports. Try again later.' });
    const body = await readJsonBody(req);
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(String(body.targetUserId || ''));
    if (!target) return sendJson(res, 404, { error: 'User not found.' });
    if (target.id === authUser.id) return sendJson(res, 400, { error: 'You cannot report yourself.' });
    const kind = REPORT_KINDS.includes(body.kind) ? body.kind : 'other';
    const id = uid('rep');
    db.prepare(
      'INSERT INTO reports (id, reporter_id, target_user_id, kind, context_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, authUser.id, target.id, kind, String(body.contextId || '').slice(0, 80), String(body.reason || '').slice(0, 500), 'open', Date.now());
    const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all().map((a) => a.id);
    wsHub.broadcastToUsers(admins, 'admin:report', { id, kind });
    return sendJson(res, 200, { ok: true, id });
  }

  // ----- admin only from here -----
  if (isAdmin) {
    if (!authUser.is_admin) return sendJson(res, 403, { error: 'Admins only.' });
    const findUser = (body) =>
      db.prepare('SELECT * FROM users WHERE id = ? OR lower(username) = lower(?)').get(String(body.userId || ''), String(body.username || ''));

    if (pathname === '/api/admin/reports' && req.method === 'GET') {
      const rows = db
        .prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 200")
        .all();
      const reports = rows.map((r) => {
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(r.target_user_id);
        const reporter = db.prepare('SELECT * FROM users WHERE id = ?').get(r.reporter_id);
        return {
          id: r.id,
          kind: r.kind,
          reason: r.reason,
          contextId: r.context_id,
          createdAt: r.created_at,
          target: target ? { ...publicUser(target), liveBanned: Boolean(target.live_banned) } : null,
          reporter: publicUser(reporter)
        };
      });
      return sendJson(res, 200, { reports });
    }

    const resolveMatch = pathname.match(/^\/api\/admin\/reports\/([^/]+)\/resolve$/);
    if (resolveMatch && req.method === 'POST') {
      const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(resolveMatch[1]);
      if (!rep) return sendJson(res, 404, { error: 'Report not found.' });
      const body = await readJsonBody(req);
      if (body.action === 'live_ban') banFromLive(db, wsHub, rep.target_user_id, body.reason || 'Under 18 found going live');
      db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(body.action === 'live_ban' ? 'actioned' : 'dismissed', rep.id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/live-ban' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const target = findUser(body);
      if (!target) return sendJson(res, 404, { error: 'User not found.' });
      banFromLive(db, wsHub, target.id, body.reason);
      return sendJson(res, 200, { ok: true });
    }

    // Only for correcting a mistake (e.g. the wrong account was banned).
    if (pathname === '/api/admin/live-unban' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const target = findUser(body);
      if (!target) return sendJson(res, 404, { error: 'User not found.' });
      db.prepare("UPDATE users SET live_banned = 0, live_ban_reason = '', live_banned_at = 0 WHERE id = ?").run(target.id);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/plus/gift' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const target = findUser(body);
      if (!target) return sendJson(res, 404, { error: 'User not found.' });
      const days = Math.max(0, Math.min(366, Number(body.days) || 0));
      grantPlusGift(db, wsHub, target.id, days);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'API endpoint not found.' });
}

module.exports = { handleLiveRoutes, liveEligibility, canWatch, endLive };
