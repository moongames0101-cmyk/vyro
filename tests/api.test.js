const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createVyroServer } = require('../server');

let app;
let baseUrl;
let tempDataDir;

test.before(async () => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-test-'));
  app = createVyroServer({ port: 0, host: '127.0.0.1', dataDir: tempDataDir });
  const info = await app.start();
  baseUrl = `http://127.0.0.1:${info.port}`;
});

test.after(async () => {
  await app.stop();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
});

async function reqJson(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('health, network-info, and static assets serve cleanly', async () => {
  const health = await reqJson('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.appName, 'VYRO');

  const netInfo = await reqJson('/api/network-info');
  assert.equal(netInfo.status, 200);
  assert.ok(netInfo.data.version);

  const icoRes = await fetch(`${baseUrl}/assets/icon.ico`);
  assert.equal(icoRes.status, 200);
});

test('signup, login, username check, and password reset', async () => {
  const avail1 = await reqJson('/api/auth/check-username?username=callum_test');
  assert.equal(avail1.data.available, true);

  const su = await reqJson('/api/auth/signup', {
    method: 'POST',
    body: {
      email: 'callum@test.dev',
      username: 'callum_test',
      password: 'secret123',
      displayName: 'Callum',
      birthday: '2002-04-10',
      recoveryHint: 'cosmic-fox'
    }
  });
  assert.equal(su.status, 201);
  assert.ok(su.data.token);
  assert.equal(su.data.user.username, 'callum_test');

  const avail2 = await reqJson('/api/auth/check-username?username=callum_test');
  assert.equal(avail2.data.available, false);

  const badLogin = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'callum_test', password: 'wrong' }
  });
  assert.equal(badLogin.status, 401);

  const reset = await reqJson('/api/auth/reset-password', {
    method: 'POST',
    body: { identifier: 'callum_test', recoveryHint: 'cosmic-fox', newPassword: 'newsecret456' }
  });
  assert.equal(reset.status, 200);

  const okLogin = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'callum@test.dev', password: 'newsecret456' }
  });
  assert.equal(okLogin.status, 200);
  assert.equal(okLogin.data.user.displayName, 'Callum');

  // Verify account persists across full server stop & reopen on same dataDir
  await app.stop();
  app = createVyroServer({ port: 0, host: '127.0.0.1', dataDir: tempDataDir });
  const restartedInfo = await app.start();
  baseUrl = `http://127.0.0.1:${restartedInfo.port}`;

  const afterRestart = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'callum_test', password: 'newsecret456' }
  });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.data.user.displayName, 'Callum');
});

test('servers, channels, snaps, replay limit, screenshot alert, and stories', async () => {
  const suA = await reqJson('/api/auth/signup', {
    method: 'POST',
    body: { email: 'user_a@test.dev', username: 'user_a', password: 'password123', displayName: 'UserA', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
  });
  const suB = await reqJson('/api/auth/signup', {
    method: 'POST',
    body: { email: 'user_b@test.dev', username: 'user_b', password: 'password123', displayName: 'UserB', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
  });
  assert.equal(suA.status, 201);
  assert.equal(suB.status, 201);
  const tokenA = suA.data.token;
  const tokenB = suB.data.token;

  // Create server + channel
  const srv = await reqJson('/api/servers', {
    method: 'POST',
    token: tokenA,
    body: { name: 'Alpha Testing Club', iconEmoji: '🚀' }
  });
  assert.equal(srv.status, 201);
  const code = srv.data.server.inviteCode;

  const join = await reqJson('/api/servers/join', {
    method: 'POST',
    token: tokenB,
    body: { inviteCode: code }
  });
  assert.equal(join.status, 200);

  const ch = await reqJson(`/api/servers/${srv.data.server.id}/channels`, {
    method: 'POST',
    token: tokenA,
    body: { name: 'snaps-room', type: 'ephemeral', defaultTtlSec: 20 }
  });
  assert.equal(ch.status, 201);

  // Send Snap from A -> B in channel
  const snapRes = await reqJson('/api/messages', {
    method: 'POST',
    token: tokenA,
    body: {
      scopeType: 'channel',
      scopeId: ch.data.channel.id,
      kind: 'snap',
      content: 'Test Snap',
      mediaData: 'data:image/png;base64,iVBORw0KGgo=',
      ttlSec: 5
    }
  });
  assert.equal(snapRes.status, 201);
  const snapId = snapRes.data.message.id;

  // B opens snap, replays once, then second replay fails
  const openRes = await reqJson(`/api/messages/${snapId}/open-snap`, { method: 'POST', token: tokenB });
  assert.equal(openRes.status, 200);
  assert.ok(openRes.data.mediaData);

  const rep1 = await reqJson(`/api/messages/${snapId}/replay-snap`, { method: 'POST', token: tokenB });
  assert.equal(rep1.status, 200);

  const rep2 = await reqJson(`/api/messages/${snapId}/replay-snap`, { method: 'POST', token: tokenB });
  assert.equal(rep2.status, 400);

  // Screenshot alert creates system message
  const ss = await reqJson(`/api/messages/${snapId}/screenshot`, { method: 'POST', token: tokenB });
  assert.equal(ss.status, 200);

  const msgs = await reqJson(`/api/messages?scopeType=channel&scopeId=${ch.data.channel.id}`, { token: tokenA });
  assert.ok(msgs.data.messages.some((m) => m.kind === 'system' && m.content.includes('screenshot')));

  // Stories
  const story = await reqJson('/api/stories', {
    method: 'POST',
    token: tokenA,
    body: { mediaData: 'data:image/png;base64,iVBORw0KGgo=', caption: 'Testing Story' }
  });
  assert.equal(story.status, 201);

  // Stories are friends-only: B can't see A's story until they're friends
  const before = await reqJson('/api/stories', { token: tokenB });
  assert.ok(!before.data.storyGroups.some((g) => g.author.id === suA.data.user.id));

  const fr = await reqJson('/api/friends/request', { method: 'POST', token: tokenA, body: { target: 'user_b' } });
  assert.equal(fr.status, 201);
  const pending = await reqJson('/api/friends', { token: tokenB });
  const reqId = pending.data.incoming[0].friendshipId;
  const acc = await reqJson('/api/friends/respond', { method: 'POST', token: tokenB, body: { friendshipId: reqId, action: 'accept' } });
  assert.equal(acc.status, 200);

  const storiesList = await reqJson('/api/stories', { token: tokenB });
  assert.ok(storiesList.data.storyGroups.some((g) => g.author.id === suA.data.user.id));
});

test('RFC 6455 WebSocket handshake and real-time message delivery', async () => {
  const loginA = await reqJson('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'user_a@test.dev', password: 'password123' }
  });
  const token = loginA.data.token;
  const port = Number(new URL(baseUrl).port);

  await new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection(port, '127.0.0.1', () => {
      socket.write(
        `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('WebSocket hello timeout'));
    }, 3000);

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const str = buf.toString('utf8');
        const idx = str.indexOf('\r\n\r\n');
        if (idx >= 0) {
          assert.ok(str.includes('101 Switching Protocols'));
          handshakeDone = true;
          buf = buf.subarray(idx + 4);
        }
      }
      if (handshakeDone && buf.length >= 2) {
        const len = buf[1] & 0x7f;
        const offset = len === 126 ? 4 : 2;
        const actualLen = len === 126 ? buf.readUInt16BE(2) : len;
        if (buf.length >= offset + actualLen) {
          const text = buf.subarray(offset, offset + actualLen).toString('utf8');
          const parsed = JSON.parse(text);
          if (parsed.event === 'hello') {
            clearTimeout(timer);
            socket.destroy();
            resolve();
          }
        }
      }
    });
    socket.on('error', reject);
  });
});

test('server PNA CORS preflight and X-HTTP-Method-Override PATCH support', async () => {
  const preflight = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:17483',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Private-Network': 'true'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:17483');
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

  const su = await reqJson('/api/auth/signup', {
    method: 'POST',
    body: { email: 'override@test.dev', username: 'override_user', password: 'password123', displayName: 'Override', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
  });
  assert.equal(su.status, 201);

  const patchOverride = await fetch(`${baseUrl}/api/auth/me`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${su.data.token}`,
      'X-HTTP-Method-Override': 'PATCH'
    },
    body: JSON.stringify({ statusText: 'Proxied PATCH OK' })
  });
  assert.equal(patchOverride.status, 200);
  const patched = await patchOverride.json();
  assert.equal(patched.user.statusText, 'Proxied PATCH OK');
});

test('client api.js normalizes server URLs and handles APK proxy signup without 404', async () => {
  let savedNativeServer = '';
  const mockProxyServer = http.createServer(async (req, res) => {
    if (req.url === '/_apk/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ isApk: true, serverUrl: savedNativeServer, localIps: ['192.168.0.42'] }));
      return;
    }
    if (req.url === '/_apk/server-url' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      savedNativeServer = parsed.url || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, serverUrl: savedNativeServer }));
      return;
    }
    if (req.url.startsWith('/api/')) {
      const target = req.headers['x-vyro-target'] || savedNativeServer;
      if (!target) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No VYRO server connected yet.', code: 'NO_SERVER_CONFIGURED' }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const upstream = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
        },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      });
      const upBuf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      res.end(upBuf);
      return;
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => mockProxyServer.listen(0, '127.0.0.1', resolve));
  const proxyAddr = mockProxyServer.address();
  const proxyOrigin = `http://127.0.0.1:${proxyAddr.port}`;

  const prevWindow = globalThis.window;
  const prevLocation = globalThis.location;
  const prevLocalStorage = globalThis.localStorage;
  const prevFetch = globalThis.fetch;
  const store = new Map();

  try {
    globalThis.window = {};
    globalThis.location = { hostname: '127.0.0.1', origin: proxyOrigin, protocol: 'http:', host: `127.0.0.1:${proxyAddr.port}` };
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    globalThis.fetch = (input, init) => {
      const urlStr = typeof input === 'string' && input.startsWith('/') ? `${proxyOrigin}${input}` : input;
      return prevFetch(urlStr, init);
    };

    const clientApi = await import('../public/js/api.js');
    assert.deepEqual(clientApi.normalizeServerUrl('192.168.0.119:3847'), { valid: true, url: 'http://192.168.0.119:3847' });
    assert.deepEqual(clientApi.normalizeServerUrl('192.168.0.119'), { valid: true, url: 'http://192.168.0.119:3847' });
    assert.deepEqual(clientApi.normalizeServerUrl('vyro-chat.onrender.com/#/login'), { valid: true, url: 'https://vyro-chat.onrender.com' });
    assert.deepEqual(clientApi.normalizeServerUrl('invalid host'), { valid: false, url: '' });

    const env = await clientApi.initApkEnvironment();
    assert.equal(env.isApk, true);
    assert.equal(clientApi.isApkUnconfigured(), true);

    await assert.rejects(
      () => clientApi.api('/api/auth/signup', { method: 'POST', body: {} }),
      (err) => err.code === 'NO_SERVER_CONFIGURED' && err.status === 503
    );

    const probe = await clientApi.probeServerHealth(baseUrl, 2000);
    assert.equal(probe.ok, true);

    await clientApi.saveServerUrl(probe.url);
    assert.equal(savedNativeServer, baseUrl);
    assert.equal(clientApi.isApkUnconfigured(), false);

    const su = await clientApi.api('/api/auth/signup', {
      method: 'POST',
      body: { email: 'apk_mobile@test.dev', username: 'apk_mobile', password: 'password123', displayName: 'APK User', birthday: '2000-01-01', recoveryHint: 'test-phrase' }
    });
    assert.equal(su.user.username, 'apk_mobile');
    assert.ok(su.token);
  } finally {
    globalThis.window = prevWindow;
    globalThis.location = prevLocation;
    globalThis.localStorage = prevLocalStorage;
    globalThis.fetch = prevFetch;
    await new Promise((resolve) => mockProxyServer.close(resolve));
  }
});
