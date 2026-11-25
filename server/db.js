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
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (existing && existing.count > 0) return;

  const now = Date.now();
  const today = dayKey(now);
  const demoPassHash = hashPassword('vyro1234');

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, email, username, username_lower, discriminator, display_name,
      password_hash, birthday, bio, status_text, presence,
      avatar_type, avatar_config, avatar_url, snap_score, is_bot, recovery_hint, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const demoUsers = [
    {
      id: 'usr_vyro_bot',
      email: 'bot@vyro.app',
      username: 'VYRO',
      disc: '0001',
      display: 'VYRO Guide',
      bio: 'Official VYRO onboarding bot. Drop snaps, start streaks, build communities!',
      status: 'Online • Ready to help',
      presence: 'online',
      avatar: { bg: 'linear-gradient(135deg,#8B5CF6,#FACC15)', skin: '#FFE600', hair: 'bolt', eyes: 'star', outfit: '#1E1B4B', accent: '#A855F7', badge: '⚡' },
      score: 9999,
      isBot: 1
    },
    {
      id: 'usr_nova',
      email: 'nova@vyro.app',
      username: 'Nova',
      disc: '0420',
      display: 'Nova',
      bio: 'Living the dream, keeping streaks alive & hosting Snap Stage.',
      status: 'Living the dream 🎵',
      presence: 'online',
      avatar: { bg: 'linear-gradient(135deg,#7C3AED,#EC4899)', skin: '#F5C9A6', hair: 'bob', eyes: 'shades', outfit: '#6D28D9', accent: '#FACC15', badge: '🔥' },
      score: 4280,
      isBot: 0
    },
    {
      id: 'usr_kai',
      email: 'kai@vyro.app',
      username: 'Kai',
      disc: '8812',
      display: 'Kai',
      bio: 'Gaming Squad lead & late-night voice chat regular.',
      status: 'In a game 🎮',
      presence: 'idle',
      avatar: { bg: 'linear-gradient(135deg,#0EA5E9,#8B5CF6)', skin: '#D99B72', hair: 'spiky', eyes: 'wink', outfit: '#0369A1', accent: '#38BDF8', badge: '🎮' },
      score: 2910,
      isBot: 0
    },
    {
      id: 'usr_zoe',
      email: 'zoe@vyro.app',
      username: 'Zoe',
      disc: '1337',
      display: 'Zoe',
      bio: 'Posting 24h stories & custom doodle snaps 📸',
      status: 'Editing a Snap 🎨',
      presence: 'online',
      avatar: { bg: 'linear-gradient(135deg,#F59E0B,#EF4444)', skin: '#8D5524', hair: 'curly', eyes: 'happy', outfit: '#B45309', accent: '#FDE047', badge: '📸' },
      score: 5120,
      isBot: 0
    }
  ];

  for (const u of demoUsers) {
    insertUser.run(
      u.id, u.email, u.username, u.username.toLowerCase(), u.disc, u.display,
      demoPassHash, '2002-05-14', u.bio, u.status, u.presence,
      'svg', JSON.stringify(u.avatar), '', u.score, u.isBot, 'demo', now - 86400000
    );
  }

  const insertFriend = db.prepare(`
    INSERT INTO friendships (id, user_a, user_b, status, requester_id, streak_count, streak_last_day, last_snap_at, created_at)
    VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?)
  `);
  const insertDm = db.prepare(`INSERT INTO dm_threads (id, user_a, user_b, last_message_at) VALUES (?, ?, ?, ?)`);

  const pairs = [
    ['usr_kai', 'usr_nova', 18],
    ['usr_nova', 'usr_zoe', 7],
    ['usr_kai', 'usr_zoe', 4],
    ['usr_nova', 'usr_vyro_bot', 1]
  ];

  for (const [a, b, streak] of pairs) {
    const [uA, uB] = [a, b].sort();
    insertFriend.run(uid('fr_'), uA, uB, a, streak, today, now - 3600000, now - 86400000);
    insertDm.run(`dm_${uA}_${uB}`, uA, uB, now - 600000);
  }

  const insertServer = db.prepare(`
    INSERT INTO servers (id, name, icon_emoji, icon_color, banner_color, description, owner_id, invite_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertServer.run('srv_vyro_hq', 'VYRO HQ', '⚡', 'linear-gradient(135deg,#8B5CF6,#FACC15)', 'linear-gradient(135deg,#4C1D95,#8B5CF6,#F59E0B)', 'Official VYRO Lounge — channels meet disappearing Snap rooms.', 'usr_nova', 'VYROHQ', now - 86400000);
  insertServer.run('srv_gaming_squad', 'Gaming Squad', '🎮', 'linear-gradient(135deg,#7C3AED,#6366F1)', 'linear-gradient(135deg,#312E81,#7C3AED)', 'Squad up, share highlights, and jump into voice comms.', 'usr_kai', 'GAME24', now - 80000000);
  insertServer.run('srv_music_vibes', 'Music Vibes', '🎵', 'linear-gradient(135deg,#6366F1,#EC4899)', 'linear-gradient(135deg,#1E1B4B,#8B5CF6)', 'Nightfall beats, playlists, and late-night listening rooms.', 'usr_zoe', 'MUSIC8', now - 76000000);
  insertServer.run('srv_chill_zone', 'Chill Zone', '🌴', 'linear-gradient(135deg,#F59E0B,#EF4444)', 'linear-gradient(135deg,#78350F,#F59E0B)', 'Kick back with disappearing snaps and casual chat.', 'usr_nova', 'CHILL1', now - 72000000);
  insertServer.run('srv_tech_talk', 'Tech Talk', '💻', 'linear-gradient(135deg,#0EA5E9,#8B5CF6)', 'linear-gradient(135deg,#0F172A,#0284C7)', 'Code, PC setups, gadgets, and dev talk.', 'usr_kai', 'TECH99', now - 68000000);

  const insertMember = db.prepare(`
    INSERT INTO server_members (server_id, user_id, role, role_color, joined_at) VALUES (?, ?, ?, ?, ?)
  `);
  const memberships = [
    ['srv_vyro_hq', 'usr_nova', 'owner', '#FACC15'],
    ['srv_vyro_hq', 'usr_kai', 'admin', '#A855F7'],
    ['srv_vyro_hq', 'usr_zoe', 'moderator', '#38BDF8'],
    ['srv_vyro_hq', 'usr_vyro_bot', 'bot', '#22C55E'],
    ['srv_gaming_squad', 'usr_kai', 'owner', '#A855F7'],
    ['srv_gaming_squad', 'usr_nova', 'member', '#E2E8F0'],
    ['srv_gaming_squad', 'usr_zoe', 'member', '#E2E8F0'],
    ['srv_music_vibes', 'usr_zoe', 'owner', '#FACC15'],
    ['srv_music_vibes', 'usr_nova', 'member', '#E2E8F0'],
    ['srv_chill_zone', 'usr_nova', 'owner', '#FACC15'],
    ['srv_chill_zone', 'usr_kai', 'member', '#E2E8F0'],
    ['srv_tech_talk', 'usr_kai', 'owner', '#38BDF8'],
    ['srv_tech_talk', 'usr_zoe', 'member', '#E2E8F0']
  ];
  for (const [sid, uidVal, role, color] of memberships) {
    insertMember.run(sid, uidVal, role, color, now - 50000000);
  }

  const insertChannel = db.prepare(`
    INSERT INTO channels (id, server_id, category, name, type, topic, default_ttl_sec, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const channels = [
    ['ch_hq_general', 'srv_vyro_hq', 'TEXT CHANNELS', 'general', 'text', 'Welcome to VYRO! Chat persistently or toggle Snap Timer.', 0, 1],
    ['ch_hq_intros', 'srv_vyro_hq', 'TEXT CHANNELS', 'introductions', 'text', 'Drop your @tag, vibe, and custom avatar.', 0, 2],
    ['ch_hq_flash', 'srv_vyro_hq', 'SNAP ROOMS', 'flash-snaps', 'ephemeral', 'Messages & snaps here vanish automatically!', 15, 3],
    ['ch_hq_vanish', 'srv_vyro_hq', 'SNAP ROOMS', 'disappear-zone', 'ephemeral', '30-second ephemeral hangout room.', 30, 4],
    ['ch_hq_lounge', 'srv_vyro_hq', 'VOICE & STAGE', 'Voice Chat', 'voice', 'Hang out live with the squad.', 0, 5],
    ['ch_hq_stage', 'srv_vyro_hq', 'VOICE & STAGE', 'Snap Stage', 'voice', 'Live hangouts & watch parties.', 0, 6],
    ['ch_game_chat', 'srv_gaming_squad', 'TEXT CHANNELS', 'lobby', 'text', 'Squad up and drop game invites.', 0, 1],
    ['ch_game_snaps', 'srv_gaming_squad', 'SNAP ROOMS', 'clutch-snaps', 'ephemeral', 'Quick highlight drops.', 20, 2],
    ['ch_game_vc', 'srv_gaming_squad', 'VOICE & STAGE', 'Squad VC', 'voice', 'Gaming voice chat.', 0, 3],
    ['ch_music_chat', 'srv_music_vibes', 'TEXT CHANNELS', 'now-playing', 'text', 'Share tracks and Nightfall vibes.', 0, 1],
    ['ch_music_vc', 'srv_music_vibes', 'VOICE & STAGE', 'Listening Room', 'voice', 'Chill audio lounge.', 0, 2],
    ['ch_chill_chat', 'srv_chill_zone', 'TEXT CHANNELS', 'lounge', 'text', 'Just chilling.', 0, 1],
    ['ch_tech_chat', 'srv_tech_talk', 'TEXT CHANNELS', 'builds-and-code', 'text', 'Share your setup and builds.', 0, 1]
  ];
  for (const c of channels) insertChannel.run(...c);

  const insertMsg = db.prepare(`
    INSERT INTO messages (
      id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
      reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const snapArt1 = makeDemoSnapSvgDataUrl({
    title: 'Welcome to VYRO!',
    subtitle: 'Communities × Snap Streaks ⚡',
    bg1: '#4C1D95',
    bg2: '#0F172A',
    accent: '#FACC15',
    badge: '⚡ VYRO SNAP'
  });

  const snapArt2 = makeDemoSnapSvgDataUrl({
    title: 'Streak Day 18 🔥',
    subtitle: 'Wanna hop in a game?',
    bg1: '#7E22CE',
    bg2: '#EA580C',
    accent: '#FFE600',
    badge: '🔥 STREAK'
  });

  insertMsg.run(
    uid('msg_'), 'channel', 'ch_hq_general', 'usr_vyro_bot', 'text',
    'Welcome to **VYRO** — where Discord communities & voice rooms collide with Snapchat Snaps, Streaks, and 24h Stories!',
    '', '{}', '', 0, 0, 0, 0, 1, '[]', JSON.stringify({ '🔥': ['usr_nova', 'usr_kai'], '⚡': ['usr_zoe'] }), now - 720000
  );
  insertMsg.run(
    uid('msg_'), 'channel', 'ch_hq_general', 'usr_nova', 'snap',
    'Tap to view Snap', snapArt1, JSON.stringify({ caption: 'Welcome to VYRO ⚡', timerSec: 8, filter: 'neon' }),
    '', 0, 8, 0, 0, 0, '[]', JSON.stringify({ '💛': ['usr_kai'] }), now - 540000
  );

  const [u1, u2] = ['usr_kai', 'usr_nova'].sort();
  const dmId = `dm_${u1}_${u2}`;
  insertMsg.run(uid('msg_'), 'dm', dmId, 'usr_kai', 'text', 'Yo bro! You on?', '', '{}', '', 0, 0, 0, 0, 0, '[]', '{}', now - 400000);
  insertMsg.run(uid('msg_'), 'dm', dmId, 'usr_nova', 'text', 'Yeah man, just chilling. You?', '', '{}', '', 0, 0, 0, 0, 0, '[]', '{}', now - 350000);
  insertMsg.run(uid('msg_'), 'dm', dmId, 'usr_kai', 'text', 'Same. Wanna hop in a game? 🎮', '', '{}', '', 0, 0, 0, 0, 0, '[]', '{}', now - 300000);
  insertMsg.run(
    uid('msg_'), 'dm', dmId, 'usr_kai', 'snap',
    'Streak Snap', snapArt2, JSON.stringify({ caption: 'Keep the 18-day streak alive 🔥', timerSec: 6, filter: 'sunset' }),
    '', 0, 6, 0, 0, 0, '[]', '{}', now - 240000
  );

  const insertStory = db.prepare(`
    INSERT INTO stories (id, author_id, media_data, caption, caption_y, bg_gradient, duration_sec, viewed_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStory.run(
    uid('sty_'), 'usr_nova',
    makeDemoSnapSvgDataUrl({ title: 'VYRO v1.0 Live', subtitle: 'Desktop .exe + Mobile PWA!', bg1: '#581C87', bg2: '#111827', accent: '#FACC15', badge: '✨ STORY' }),
    'Shipping VYRO tonight ⚡', 0.72, 'linear-gradient(135deg,#581C87,#111827)', 6, '[]', now - 1800000, now + 22 * 3600000
  );
  insertStory.run(
    uid('sty_'), 'usr_zoe',
    makeDemoSnapSvgDataUrl({ title: 'Nightfall Vibes', subtitle: 'Draw snaps in Studio 🎨', bg1: '#BE185D', bg2: '#312E81', accent: '#FDE047', badge: '🎨 CREATE' }),
    'Try Snap Studio filters!', 0.65, 'linear-gradient(135deg,#BE185D,#312E81)', 6, '[]', now - 900000, now + 23 * 3600000
  );
}

function onboardNewUser(db, userId) {
  const now = Date.now();
  const starterServers = ['srv_vyro_hq', 'srv_gaming_squad', 'srv_music_vibes', 'srv_chill_zone', 'srv_tech_talk'];
  for (const sid of starterServers) {
    db.prepare(`
      INSERT OR IGNORE INTO server_members (server_id, user_id, role, role_color, joined_at)
      VALUES (?, ?, 'member', '#E2E8F0', ?)
    `).run(sid, userId, now);
  }

  const friendsToAdd = [
    { otherId: 'usr_vyro_bot', streak: 1, welcomeText: 'Hey! Welcome to **VYRO** ⚡ You can chat in Communities, send disappearing Snaps, keep daily 🔥 streaks, and hop in Voice Chat!' },
    { otherId: 'usr_nova', streak: 1, welcomeText: 'Welcome to VYRO! Tap the camera icon below to drop your first Snap ⚡' }
  ];

  for (const item of friendsToAdd) {
    const [uA, uB] = [userId, item.otherId].sort();
    const frId = uid('fr_');
    const dmId = `dm_${uA}_${uB}`;
    db.prepare(`
      INSERT OR IGNORE INTO friendships (id, user_a, user_b, status, requester_id, streak_count, streak_last_day, last_snap_at, created_at)
      VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?)
    `).run(frId, uA, uB, item.otherId, item.streak, dayKey(now), now, now);

    db.prepare(`
      INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, last_message_at)
      VALUES (?, ?, ?, ?)
    `).run(dmId, uA, uB, now);

    db.prepare(`
      INSERT INTO messages (
        id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
        reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, created_at
      ) VALUES (?, 'dm', ?, ?, 'text', ?, '', '{}', '', 0, 0, 0, 1, 0, '[]', '{}', ?)
    `).run(uid('msg_'), dmId, item.otherId, item.welcomeText, now);
  }

  const [bA, bB] = [userId, 'usr_vyro_bot'].sort();
  const botDmId = `dm_${bA}_${bB}`;
  const starterSnap = makeDemoSnapSvgDataUrl({
    title: 'Your First VYRO Snap!',
    subtitle: 'Tap Replay or Save in Chat ⚡',
    bg1: '#7C3AED',
    bg2: '#090D16',
    accent: '#FFE600',
    badge: '👻 TAP ME'
  });
  db.prepare(`
    INSERT INTO messages (
      id, scope_type, scope_id, author_id, kind, content, media_data, snap_meta,
      reply_to_id, is_ephemeral, ttl_sec, expires_at, is_saved, is_pinned, opened_by, reactions, created_at
    ) VALUES (?, 'dm', ?, 'usr_vyro_bot', 'snap', 'Starter Snap', ?, ?, '', 0, 7, 0, 0, 0, '[]', '{}', ?)
  `).run(uid('msg_'), botDmId, starterSnap, JSON.stringify({ caption: 'Tap to preview a timed Snap!', timerSec: 7, filter: 'neon' }), now + 1);
}

module.exports = {
  initDatabase,
  onboardNewUser,
  uid,
  dayKey
};
