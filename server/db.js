const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

function uid(prefix = '') {
  return `${prefix}${crypto.randomBytes(8).toString('hex')}`;
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function makeDemoSnapSvgDataUrl({ title, subtitle, bg1, bg2, accent, badge }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="720" viewBox="0 0 540 720">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="540" height="720" fill="url(#g)"/>
    <circle cx="430" cy="130" r="160" fill="${accent}" opacity="0.24"/>
    <circle cx="110" cy="590" r="190" fill="#ffffff" opacity="0.08"/>
    <rect x="44" y="64" rx="22" width="170" height="44" fill="rgba(0,0,0,0.48)"/>
    <text x="129" y="93" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="#FFE600">${badge}</text>
    <rect x="0" y="310" width="540" height="96" fill="rgba(0,0,0,0.65)"/>
    <text x="270" y="355" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="800" fill="#ffffff">${title}</text>
    <text x="270" y="388" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="600" fill="#FACC15">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function initDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'vyro.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      discriminator TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      birthday TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      status_text TEXT DEFAULT '',
      presence TEXT DEFAULT 'online',
      avatar_type TEXT DEFAULT 'svg',
      avatar_config TEXT DEFAULT '{}',
      avatar_url TEXT DEFAULT '',
      snap_score INTEGER DEFAULT 0,
      is_bot INTEGER DEFAULT 0,
      recovery_hint TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      status TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      streak_count INTEGER DEFAULT 0,
      streak_last_day TEXT DEFAULT '',
      last_snap_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      last_message_at INTEGER DEFAULT 0,
      UNIQUE(user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_emoji TEXT DEFAULT '⚡',
      icon_color TEXT DEFAULT '#8B5CF6',
      banner_color TEXT DEFAULT 'linear-gradient(135deg,#8B5CF6,#FACC15)',
      description TEXT DEFAULT '',
      owner_id TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS server_members (
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      role_color TEXT DEFAULT '#E2E8F0',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (server_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      topic TEXT DEFAULT '',
      default_ttl_sec INTEGER DEFAULT 0,
      position INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT DEFAULT '',
      media_data TEXT DEFAULT '',
      snap_meta TEXT DEFAULT '{}',
      reply_to_id TEXT DEFAULT '',
      is_ephemeral INTEGER DEFAULT 0,
      ttl_sec INTEGER DEFAULT 0,
      expires_at INTEGER DEFAULT 0,
      is_saved INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      opened_by TEXT DEFAULT '[]',
      reactions TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_scope ON messages(scope_type, scope_id, created_at);

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      media_data TEXT NOT NULL,
      caption TEXT DEFAULT '',
      caption_y REAL DEFAULT 0.5,
      bg_gradient TEXT DEFAULT '',
      duration_sec INTEGER DEFAULT 6,
      viewed_by TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  seedInitialData(db);
  return db;
}

function seedInitialData(db) {
  try {
    // Purge any legacy bots and demo users so real users have a completely clean platform
    db.exec(`
      DELETE FROM messages WHERE author_id IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe');
      DELETE FROM stories WHERE author_id IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe');
      DELETE FROM dm_threads WHERE user_a IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe') OR user_b IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe');
      DELETE FROM friendships WHERE user_a IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe') OR user_b IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe');
      DELETE FROM server_members WHERE user_id IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe') OR server_id IN ('srv_vyro_hq', 'srv_gaming_squad', 'srv_music_vibes', 'srv_chill_zone', 'srv_tech_talk');
      DELETE FROM channels WHERE server_id IN ('srv_vyro_hq', 'srv_gaming_squad', 'srv_music_vibes', 'srv_chill_zone', 'srv_tech_talk');
      DELETE FROM servers WHERE owner_id IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe') OR id IN ('srv_vyro_hq', 'srv_gaming_squad', 'srv_music_vibes', 'srv_chill_zone', 'srv_tech_talk');
      DELETE FROM users WHERE is_bot = 1 OR id IN ('usr_vyro_bot', 'usr_nova', 'usr_kai', 'usr_zoe');
    `);
  } catch {}
}

function onboardNewUser(db, userId) {
  // Real users start completely clean — 0 bots, 0 fake friends, 0 pre-populated clutter.
}

module.exports = {
  initDatabase,
  onboardNewUser,
  uid,
  dayKey
};
