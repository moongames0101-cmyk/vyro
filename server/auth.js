const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

let cachedSecret = null;

function getSecret(dataDir) {
  if (process.env.VYRO_SECRET) return process.env.VYRO_SECRET;
  if (cachedSecret) return cachedSecret;
  if (dataDir) {
    const secretFile = path.join(dataDir, '.vyro-secret');
    try {
      if (fs.existsSync(secretFile)) {
        cachedSecret = fs.readFileSync(secretFile, 'utf8').trim();
        if (cachedSecret) return cachedSecret;
      }
      fs.mkdirSync(dataDir, { recursive: true });
      cachedSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, cachedSecret, 'utf8');
      return cachedSecret;
    } catch {}
  }
  cachedSecret = crypto.randomBytes(32).toString('hex');
  return cachedSecret;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const expected = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

function signToken(payload, dataDir, ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + ttlMs };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret(dataDir)).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token, dataDir) {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', getSecret(dataDir)).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return cookies;
}

function extractToken(req, urlObj) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (urlObj && urlObj.searchParams && urlObj.searchParams.get('token')) return urlObj.searchParams.get('token');
  return parseCookies(req).vyro_token || null;
}

function readJsonBody(req, maxBytes = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

// ---------- VYRO+ helpers ----------
const PLUS_NAME_COLORS = ['gold', 'violet', 'sunset', 'ocean', 'candy', 'mint'];
const PLUS_NAME_EFFECTS = ['none', 'shine', 'glow', 'wave'];
const PLUS_NAME_FONTS = ['default', 'script', 'serif', 'block'];
const PLUS_THEMES = ['none', 'aurora', 'sunset', 'ocean', 'candy', 'midnight'];
const PLUS_BORDERS = ['none', 'neon', 'gold', 'glow', 'rainbow'];
const PLUS_LABELS = ['OG', 'VIP', 'CREATOR', 'GAMER', 'ARTIST', 'MUSIC', 'NIGHT OWL', 'EARLY USER'];
// Premium chat extras (kept in sync with public/js/plus.js)
const PLUS_REACTIONS = ['👑', '💎', '✨', '🚀', '🌈', '💜'];
const PLUS_STICKERS = ['crown', 'fire', 'gg', 'love', 'lol', 'hype', 'night', 'wave'];
const PLUS_EFFECTS = ['glow', 'sparkle', 'confetti'];

function parseJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function isPlusActive(row, now = Date.now()) {
  return Boolean(row && Number(row.plus_until || 0) > now);
}

// Only ever returns values from the allow-lists above, so nothing user-typed reaches the page.
function sanitizePlusStyle(input) {
  const src = input && typeof input === 'object' ? input : {};
  const pick = (val, list, dflt) => (list.includes(val) ? val : dflt);
  const labels = Array.isArray(src.labels)
    ? [...new Set(src.labels.filter((l) => PLUS_LABELS.includes(l)))].slice(0, 3)
    : [];
  return {
    showBadge: src.showBadge !== false,
    nameColor: pick(src.nameColor, PLUS_NAME_COLORS, 'gold'),
    nameEffect: pick(src.nameEffect, PLUS_NAME_EFFECTS, 'shine'),
    nameFont: pick(src.nameFont, PLUS_NAME_FONTS, 'default'),
    theme: pick(src.theme, PLUS_THEMES, 'aurora'),
    border: pick(src.border, PLUS_BORDERS, 'neon'),
    labels
  };
}

function plusPublic(row) {
  if (!isPlusActive(row)) return null;
  return { active: true, ...sanitizePlusStyle(parseJson(row.plus_style, {})) };
}

function ageFromBirthday(birthday, now = new Date()) {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(String(birthday))) return null;
  const [y, m, d] = String(birthday).split('-').map(Number);
  const dob = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dob.getTime()) || dob.getUTCFullYear() !== y) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() < m - 1 || (now.getUTCMonth() === m - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

// What other people are allowed to see about a user. Never includes email, birthday or account flags.
function publicUser(row) {
  if (!row) return null;
  let avatarConfig = null;
  try {
    avatarConfig = row.avatar_config ? JSON.parse(row.avatar_config) : null;
  } catch {}
  return {
    id: row.id,
    username: row.username,
    discriminator: row.discriminator,
    tag: `${row.username}#${row.discriminator}`,
    displayName: row.display_name,
    bio: row.bio || '',
    statusText: row.status_text || '',
    presence: row.presence || 'online',
    avatarType: row.avatar_type || 'svg',
    avatarConfig,
    avatarUrl: row.avatar_url || '',
    snapScore: Number(row.snap_score || 0),
    isBot: Boolean(row.is_bot),
    plus: plusPublic(row),
    createdAt: row.created_at
  };
}

// What the signed-in user sees about their own account.
function selfUser(row) {
  if (!row) return null;
  const age = ageFromBirthday(row.birthday);
  return {
    ...publicUser(row),
    email: row.email,
    birthday: row.birthday || '',
    hasBirthday: age !== null,
    isAdult: age !== null && age >= 18,
    hasRecoveryPhrase: Boolean(row.recovery_hint),
    plusUntil: Number(row.plus_until || 0),
    plusSource: row.plus_source || '',
    plusStyle: sanitizePlusStyle(parseJson(row.plus_style, {})),
    liveBanned: Boolean(row.live_banned),
    isAdmin: Boolean(row.is_admin)
  };
}


// ---------- input sanitising for things that end up in styles or <img src> ----------
const SAFE_HEX = /^#[0-9a-fA-F]{3,8}$/;
const SAFE_BACKGROUND = /^(#[0-9a-fA-F]{3,8}|linear-gradient\(\s*-?\d{1,3}deg\s*(,\s*#[0-9a-fA-F]{3,8}(\s+\d{1,3}%)?\s*){2,4}\))$/;
const AVATAR_WORD = /^[a-z]{1,16}$/;

function safeCssBackground(value, fallback = 'linear-gradient(135deg,#8B5CF6,#FACC15)') {
  const v = String(value || '').trim();
  return v.length <= 200 && SAFE_BACKGROUND.test(v) ? v : fallback;
}

function sanitizeAvatarConfig(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const hex = (v, d) => (SAFE_HEX.test(String(v || '')) ? String(v) : d);
  const word = (v, d) => (AVATAR_WORD.test(String(v || '')) ? String(v) : d);
  return {
    bg: safeCssBackground(src.bg),
    skin: hex(src.skin, '#F5C9A6'),
    hair: word(src.hair, 'short'),
    eyes: word(src.eyes, 'happy'),
    outfit: hex(src.outfit, '#6D28D9'),
    accent: hex(src.accent, '#FACC15'),
    badge: String(src.badge || '⚡').slice(0, 4)
  };
}

// Only inline (data:) pictures, video and audio. Stops links to outside servers that could track people.
const DATA_URL = /^data:(image|video|audio)\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=]+$/i;
function safeDataUrl(value, kinds = ['image']) {
  const v = String(value || '');
  if (!v || !DATA_URL.test(v)) return '';
  const kind = v.slice(5, v.indexOf('/')).toLowerCase();
  return kinds.includes(kind) ? v : '';
}

// ---------- recovery phrase (stored hashed, compared case-insensitively) ----------
function hashRecoveryPhrase(phrase) {
  const norm = String(phrase || '').trim().toLowerCase();
  if (!norm) return '';
  return `rh1:${hashPassword(norm)}`;
}

function verifyRecoveryPhrase(phrase, stored) {
  const norm = String(phrase || '').trim().toLowerCase();
  if (!stored || !norm) return false;
  if (stored.startsWith('rh1:')) return verifyPassword(norm, stored.slice(4));
  // Older accounts stored the phrase as plain text
  const a = Buffer.from(stored.trim().toLowerCase());
  const b = Buffer.from(norm);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- simple in-memory rate limiter ----------
const rateBuckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  if (rateBuckets.size > 50000) {
    for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  }
  return { allowed: b.count <= max, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

// Behind a hosting proxy (Render sets RENDER=true) every request arrives from the proxy,
// so the visitor's real address is read from X-Forwarded-For instead.
function trustsProxy() {
  return process.env.VYRO_TRUST_PROXY === '1' || Boolean(process.env.RENDER);
}

function clientIp(req) {
  if (trustsProxy()) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// True only for requests made on the server machine itself (not through a proxy).
function isLocalRequest(req) {
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false;
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = {
  PLUS_NAME_COLORS,
  PLUS_REACTIONS,
  PLUS_STICKERS,
  PLUS_EFFECTS,
  safeCssBackground,
  sanitizeAvatarConfig,
  safeDataUrl,
  parseJson,
  PLUS_NAME_EFFECTS,
  PLUS_NAME_FONTS,
  PLUS_THEMES,
  PLUS_BORDERS,
  PLUS_LABELS,
  isPlusActive,
  sanitizePlusStyle,
  ageFromBirthday,
  selfUser,
  hashRecoveryPhrase,
  verifyRecoveryPhrase,
  rateLimit,
  clientIp,
  isLocalRequest,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  extractToken,
  readJsonBody,
  sendJson,
  publicUser
};
