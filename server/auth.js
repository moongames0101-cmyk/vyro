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

function publicUser(row) {
  if (!row) return null;
  let avatarConfig = null;
  try {
    avatarConfig = row.avatar_config ? JSON.parse(row.avatar_config) : null;
  } catch {}
  return {
    id: row.id,
    email: row.email,
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
    createdAt: row.created_at
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  extractToken,
  readJsonBody,
  sendJson,
  publicUser
};
