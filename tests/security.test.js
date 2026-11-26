// Safety, privacy, VYRO+ and VYRO Live checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.VYRO_ADMINS = 'sec_admin';
const { createVyroServer } = require('../server');
const { verifyStripeSignature } = require('../server/routes/plus');

let app;
let baseUrl;
let tempDataDir;
const tokens = {};
const ids = {};

test.before(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-sec-'));
  app = createVyroServer({ port: 0, host: '127.0.0.1', dataDir: tempDataDir });
  const info = await app.start();
  baseUrl = `http://127.0.0.1:${info.port}`;
});

test.after(async () => {
  await app.stop();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

async function reqJson(pathname, { method = 'GET', token, body, headers: extra = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function passFaceScan(username, estimate = 27) {
  return reqJson('/api/live/age-check', {
    method: 'POST',
    token: tokens[username],
    body: { kind: 'golive', estimate, samples: 12, liveness: true }
  });
}

function yearsAgo(n) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

async function signup(username, birthday, extra = {}) {
  const r = await reqJson('/api/auth/signup', {
    method: 'POST',
    body: {
      email: `${username}@test.dev`,
      username,
      password: 'secret123',
      displayName: username,
      birthday,
      recoveryHint: 'blue-lantern',
      ...extra
    }
  });
  if (r.status === 201) {
    tokens[username] = r.data.token;
    ids[username] = r.data.user.id;
  }
  return r;
}

test('sign up needs a real 13+ birthday and a recovery phrase', async () => {
  assert.equal((await signup('sec_noage', '')).status, 400);
  assert.equal((await signup('sec_kid', yearsAgo(12))).status, 400);
  assert.equal((await signup('sec_norec', yearsAgo(20), { recoveryHint: '' })).status, 400);

  assert.equal((await signup('sec_admin', yearsAgo(30))).status, 201);
  assert.equal((await signup('sec_adult', yearsAgo(25))).status, 201);
  assert.equal((await signup('sec_teen', yearsAgo(15))).status, 201);
});

test('other people never see your email or birthday', async () => {
  const search = await reqJson('/api/users/search?q=sec_adult', { token: tokens.sec_teen });
  assert.equal(search.status, 200);
  const found = search.data.users.find((u) => u.username === 'sec_adult');
  assert.ok(found);
  assert.equal(found.email, undefined);
  assert.equal(found.birthday, undefined);

  const me = await reqJson('/api/auth/me', { token: tokens.sec_adult });
  assert.equal(me.data.user.email, 'sec_adult@test.dev');
  assert.equal(me.data.user.isAdult, true);

  const nearby = await reqJson('/api/auth/nearby-accounts');
  assert.deepEqual(nearby.data.users, []);
});

test('teens are not suggested to adults they do not know', async () => {
  const suggested = await reqJson('/api/users/search', { token: tokens.sec_adult });
  assert.equal(suggested.status, 200);
  assert.ok(!suggested.data.users.some((u) => u.username === 'sec_teen'));
});

test('password reset needs the recovery phrase', async () => {
  const noPhrase = await reqJson('/api/auth/reset-password', {
    method: 'POST',
    body: { identifier: 'sec_teen', newPassword: 'another123' }
  });
  assert.equal(noPhrase.status, 400);
  const wrong = await reqJson('/api/auth/reset-password', {
    method: 'POST',
    body: { identifier: 'sec_teen', recoveryHint: 'nope', newPassword: 'another123' }
  });
  assert.equal(wrong.status, 403);
  const right = await reqJson('/api/auth/reset-password', {
    method: 'POST',
    body: { identifier: 'sec_teen', recoveryHint: 'Blue-Lantern', newPassword: 'another123' }
  });
  assert.equal(right.status, 200);
});

test('you can only message people who accepted your friend request', async () => {
  const blocked = await reqJson('/api/dms/open', { method: 'POST', token: tokens.sec_adult, body: { userId: ids.sec_admin } });
  assert.equal(blocked.status, 403);

  const reqRes = await reqJson('/api/friends/request', { method: 'POST', token: tokens.sec_adult, body: { target: 'sec_admin' } });
  assert.ok([200, 201].includes(reqRes.status));
  const fr = await reqJson('/api/friends', { token: tokens.sec_admin });
  const incoming = fr.data.incoming.find((r) => r.user.username === 'sec_adult');
  const acc = await reqJson('/api/friends/respond', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { friendshipId: incoming.friendshipId, action: 'accept' }
  });
  assert.equal(acc.status, 200);
  const open = await reqJson('/api/dms/open', { method: 'POST', token: tokens.sec_adult, body: { userId: ids.sec_admin } });
  assert.equal(open.status, 200);
});

test('update settings cannot be changed through a proxy', async () => {
  const r = await reqJson('/api/system/config', {
    method: 'PATCH',
    headers: { 'X-Forwarded-For': '203.0.113.9' },
    body: { githubOwner: 'attacker', githubRepo: 'evil' }
  });
  assert.equal(r.status, 403);
});

test('VYRO+ is never granted without a real payment', async () => {
  const status = await reqJson('/api/plus/status', { token: tokens.sec_adult });
  assert.equal(status.status, 200);
  assert.equal(status.data.active, false);
  assert.equal(status.data.priceLabel, '£1.99/month');

  const style = await reqJson('/api/plus/style', { method: 'PATCH', token: tokens.sec_adult, body: { nameColor: 'violet' } });
  assert.equal(style.status, 403);

  const samsung = await reqJson('/api/plus/verify', { method: 'POST', token: tokens.sec_adult, body: { store: 'samsung', purchaseToken: 'x' } });
  assert.equal(samsung.status, 501);
  const google = await reqJson('/api/plus/verify', { method: 'POST', token: tokens.sec_adult, body: { store: 'google', purchaseToken: 'fake' } });
  assert.equal(google.status, 501);
  const checkout = await reqJson('/api/plus/checkout', { method: 'POST', token: tokens.sec_adult });
  assert.equal(checkout.status, 501);

  const notAdmin = await reqJson('/api/admin/plus/gift', { method: 'POST', token: tokens.sec_adult, body: { username: 'sec_adult', days: 30 } });
  assert.equal(notAdmin.status, 403);
});

test('VYRO+ members can style their name, but only with allowed values', async () => {
  const gift = await reqJson('/api/admin/plus/gift', { method: 'POST', token: tokens.sec_admin, body: { username: 'sec_adult', days: 30 } });
  assert.equal(gift.status, 200);
  const status = await reqJson('/api/plus/status', { token: tokens.sec_adult });
  assert.equal(status.data.active, true);

  const style = await reqJson('/api/plus/style', {
    method: 'PATCH',
    token: tokens.sec_adult,
    body: { nameColor: '<img src=x onerror=alert(1)>', nameEffect: 'glow', labels: ['VIP', 'HACKER', 'OG', 'GAMER', 'MUSIC'] }
  });
  assert.equal(style.status, 200);
  assert.equal(style.data.style.nameColor, 'gold');
  assert.equal(style.data.style.nameEffect, 'glow');
  assert.deepEqual(style.data.style.labels, ['VIP', 'OG', 'GAMER']);

  const seen = await reqJson('/api/users/search?q=sec_adult', { token: tokens.sec_teen });
  const u = seen.data.users.find((x) => x.username === 'sec_adult');
  assert.equal(u.plus.active, true);
  assert.equal(u.plus.nameEffect, 'glow');
});

test('Stripe webhooks must carry a valid signature', () => {
  const secret = 'whsec_test';
  const body = '{"type":"ping"}';
  const t = Math.floor(Date.now() / 1000);
  const good = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${good}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${t - 3600},v1=${good}`, secret), false);
  assert.equal(verifyStripeSignature(body, '', secret), false);
});

test('VYRO Live: 18+ hosts only, and banned accounts stay banned', async () => {
  const teen = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_teen, body: { title: 'hi' } });
  assert.equal(teen.status, 403);
  assert.equal(teen.data.code, 'under_18');

  const noScan = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_adult, body: { title: 'x' } });
  assert.equal(noScan.status, 403);
  assert.equal(noScan.data.code, 'face_check_required');
  assert.equal((await passFaceScan('sec_adult')).data.passed, true);
  const start = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_adult, body: { title: 'Late night chat', audience: 'adults' } });
  assert.equal(start.status, 200);
  const liveId = start.data.live.id;

  const teenList = await reqJson('/api/live', { token: tokens.sec_teen });
  assert.ok(!teenList.data.lives.some((l) => l.id === liveId), 'an 18+ live must be hidden from under-18s');
  const adminList = await reqJson('/api/live', { token: tokens.sec_admin });
  assert.ok(adminList.data.lives.some((l) => l.id === liveId));

  const report = await reqJson('/api/reports', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { targetUserId: ids.sec_adult, kind: 'underage_live', contextId: liveId, reason: 'Said they are 15' }
  });
  assert.equal(report.status, 200);

  assert.equal((await reqJson('/api/admin/reports', { token: tokens.sec_adult })).status, 403);
  const reports = await reqJson('/api/admin/reports', { token: tokens.sec_admin });
  const rep = reports.data.reports.find((r) => r.id === report.data.id);
  assert.ok(rep);
  const resolve = await reqJson(`/api/admin/reports/${rep.id}/resolve`, {
    method: 'POST',
    token: tokens.sec_admin,
    body: { action: 'live_ban' }
  });
  assert.equal(resolve.status, 200);

  const after = await reqJson('/api/live', { token: tokens.sec_admin });
  assert.ok(!after.data.lives.some((l) => l.id === liveId), 'a banned host\'s live is ended');
  const again = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_adult, body: {} });
  assert.equal(again.status, 403);
  assert.equal(again.data.code, 'banned');
  const me = await reqJson('/api/auth/me', { token: tokens.sec_adult });
  assert.equal(me.data.user.liveBanned, true);
});

test('under-18s cannot join an 18+ live over the socket', async (t) => {
  if (typeof WebSocket !== 'function') return t.skip('no WebSocket in this Node');
  await passFaceScan('sec_admin');
  const start = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_admin, body: { audience: 'adults' } });
  assert.equal(start.status, 200);
  const liveId = start.data.live.id;
  const wsUrl = baseUrl.replace('http', 'ws') + `/ws?token=${encodeURIComponent(tokens.sec_teen)}`;
  const ws = new WebSocket(wsUrl);
  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no reply')), 3000);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.event === 'hello') ws.send(JSON.stringify({ event: 'live:join', data: { liveId } }));
      if (msg.event === 'live:denied' || msg.event === 'live:viewer-join') {
        clearTimeout(timer);
        resolve(msg.event);
      }
    };
    ws.onerror = () => reject(new Error('socket error'));
  });
  ws.close();
  assert.equal(reply, 'live:denied');
  await reqJson(`/api/live/${liveId}/end`, { method: 'POST', token: tokens.sec_admin });
});

test('logins are rate limited', async () => {
  let last;
  for (let i = 0; i < 12; i++) {
    last = await reqJson('/api/auth/login', { method: 'POST', body: { identifier: 'sec_teen', password: `wrong${i}` } });
  }
  assert.equal(last.status, 429);
});

test('premium stickers and effects need VYRO+, and people cannot fake system messages', async () => {
  const fr = await reqJson('/api/friends', { token: tokens.sec_admin });
  const dmId = fr.data.friends.find((f) => f.user.username === 'sec_adult').dmId;

  const teenless = await reqJson('/api/messages', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { scopeType: 'dm', scopeId: dmId, kind: 'sticker', content: 'crown' }
  });
  assert.equal(teenless.status, 403, 'non-members cannot send premium stickers');

  const effect = await reqJson('/api/messages', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { scopeType: 'dm', scopeId: dmId, kind: 'text', content: 'hi', effect: 'confetti' }
  });
  assert.equal(effect.status, 403);

  const sticker = await reqJson('/api/messages', {
    method: 'POST',
    token: tokens.sec_adult,
    body: { scopeType: 'dm', scopeId: dmId, kind: 'sticker', content: 'crown' }
  });
  assert.ok([200, 201].includes(sticker.status));

  const fake = await reqJson('/api/messages', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { scopeType: 'dm', scopeId: dmId, kind: 'system', content: 'VYRO: your account is suspended' }
  });
  assert.ok([200, 201].includes(fake.status));
  assert.equal(fake.data.message.kind, 'text');

  const tracker = await reqJson('/api/messages', {
    method: 'POST',
    token: tokens.sec_admin,
    body: { scopeType: 'dm', scopeId: dmId, kind: 'snap', mediaData: 'https://tracker.example/pixel.png' }
  });
  assert.equal(tracker.status, 400, 'snaps must be real uploaded pictures, not outside links');
});

test('face age scan: photos and young faces do not pass, and very young faces go to the Mod tab', async () => {
  assert.equal((await signup('sec_young', yearsAgo(22))).status, 201);
  const scan = (body) => reqJson('/api/live/age-check', { method: 'POST', token: tokens.sec_young, body: { kind: 'golive', ...body } });

  const photo = await scan({ estimate: 30, samples: 12, liveness: false });
  assert.equal(photo.data.passed, false, 'no head turn = maybe a photo');
  assert.equal(photo.data.reason, 'no_liveness');

  const young = await scan({ estimate: 17.6, samples: 12, liveness: true });
  assert.equal(young.data.passed, false, 'an estimate under 18 does not pass');
  assert.equal(young.data.reason, 'too_young');
  assert.equal(young.data.minAge, 18);

  const kid = await scan({ estimate: 14, samples: 12, liveness: true });
  assert.equal(kid.data.passed, false);
  const reports = await reqJson('/api/admin/reports', { token: tokens.sec_admin });
  const flag = reports.data.reports.find((r) => r.kind === 'age_check' && r.target && r.target.username === 'sec_young');
  assert.ok(flag, 'a very young estimate is flagged for moderators');
  assert.match(flag.reason, /about 17\.6/);

  const blocked = await reqJson('/api/live/start', { method: 'POST', token: tokens.sec_young, body: {} });
  assert.equal(blocked.data.code, 'face_check_required');

  const bad = await scan({ estimate: 'lots', samples: 12, liveness: true });
  assert.equal(bad.status, 400);

  // 6 tries a day
  await scan({ estimate: 20, samples: 12, liveness: true });
  await scan({ estimate: 20, samples: 12, liveness: true });
  await scan({ estimate: 20, samples: 12, liveness: true });
  const limited = await scan({ estimate: 30, samples: 12, liveness: true });
  assert.equal(limited.status, 429);
});

test('face scan tracker needs a real head turn and enough looks', async () => {
  const { ScanTracker } = await import('../public/js/ageCheck.js');
  const t = new ScanTracker();
  const frame = (yaw, age = 25) => ({ faces: 1, age, yaw, size: 0.3 });
  for (let i = 0; i < 8; i++) t.push(frame(0.5));
  assert.equal(t.step, 'turn');
  for (let i = 0; i < 20; i++) t.push(frame(0.47)); // a tilted photo never gets past the turn step
  assert.equal(t.step, 'turn');
  t.push(frame(0.25));
  t.push(frame(0.22));
  t.push(frame(0.78));
  t.push(frame(0.8));
  assert.equal(t.step, 'lookBack');
  assert.equal(t.push({ faces: 2, age: 30, yaw: 0.5, size: 0.3 }), 'many');
  assert.equal(t.push(frame(0.5, 25)), 'ok');
  assert.equal(t.push({ faces: 1, age: 40, yaw: 0.5, size: 0.9 }), 'moved', 'someone else leaning in is ignored');
  for (let i = 0; i < 3; i++) t.push(frame(0.5, 25));
  assert.equal(t.step, 'done');
  const r = t.result();
  assert.equal(r.liveness, true);
  assert.equal(r.samples, 12);
  assert.equal(r.estimate, 25);
});
