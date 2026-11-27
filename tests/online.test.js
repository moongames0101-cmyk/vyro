// The online server: apps default to it, and deploy/start.sh starts it with backups.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createVyroServer } = require('../server');

const rootDir = path.resolve(__dirname, '..');
const ONLINE = 'https://vyro-chat.onrender.com';

// api.js with config.js pointing at an online server, loaded fresh each time.
const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-client-'));
fs.copyFileSync(path.join(rootDir, 'public/js/api.js'), path.join(clientDir, 'api.js'));
fs.writeFileSync(path.join(clientDir, 'config.js'), `export const DEFAULT_SERVER_URL = '${ONLINE}';\n`);
fs.writeFileSync(path.join(clientDir, 'package.json'), '{"type":"module"}\n');
let loads = 0;

async function loadClient({ desktop, hostname = 'localhost', store = new Map(), fetchImpl } = {}) {
  globalThis.window = desktop ? { vyroDesktop: { isDesktop: true } } : {};
  globalThis.location = { hostname, origin: `http://${hostname}:3847`, protocol: 'http:', host: `${hostname}:3847` };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  if (fetchImpl) globalThis.fetch = fetchImpl;
  loads += 1;
  return import(`${pathToFileURL(path.join(clientDir, 'api.js')).href}?load=${loads}`);
}

const saved = { window: globalThis.window, location: globalThis.location, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
test.afterEach(() => Object.assign(globalThis, saved));
test.after(() => fs.rmSync(clientDir, { recursive: true, force: true }));

test('the Windows app uses the online server unless someone picks another', async () => {
  const store = new Map();
  const client = await loadClient({ desktop: true, store });
  await client.initApkEnvironment();
  assert.equal(client.getServerUrl(), ONLINE);
  assert.equal(client.isUsingDefaultServer(), true);

  await client.saveServerUrl('192.168.0.20:3847');
  assert.equal(client.getServerUrl(), 'http://192.168.0.20:3847');
  assert.equal(client.isUsingDefaultServer(), false);

  // Picking the online server again saves nothing, so the app keeps following the default.
  await client.saveServerUrl('vyro-chat.onrender.com');
  assert.equal(store.get('vyro_server_url'), undefined);
  assert.equal(client.getServerUrl(), ONLINE);
});

test('a saved home Wi-Fi server is dropped once, then a choice made afterwards is kept', async () => {
  const store = new Map([['vyro_server_url', 'http://192.168.0.20:3847']]);
  let client = await loadClient({ desktop: true, store });
  await client.initApkEnvironment();
  assert.equal(client.getServerUrl(), ONLINE);

  await client.saveServerUrl('192.168.0.20:3847');
  client = await loadClient({ desktop: true, store });
  await client.initApkEnvironment();
  assert.equal(client.getServerUrl(), 'http://192.168.0.20:3847');
});

test('a saved online server of your own is never dropped', async () => {
  const store = new Map([['vyro_server_url', 'https://my-own-vyro.example.com']]);
  const client = await loadClient({ desktop: true, store });
  await client.initApkEnvironment();
  assert.equal(client.getServerUrl(), 'https://my-own-vyro.example.com');
});

test('the website keeps talking to the server it was opened from', async () => {
  const client = await loadClient({ desktop: false, hostname: 'vyro-chat.onrender.com' });
  await client.initApkEnvironment();
  assert.equal(client.getServerUrl(), '');
  assert.equal(client.isUsingDefaultServer(), false);
});

test('the app keeps asking a sleeping server until it answers', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    assert.equal(url, `${ONLINE}/api/health`);
    calls += 1;
    if (calls < 2) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ ok: true, appName: 'VYRO', version: '1.2.0' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const client = await loadClient({ desktop: true, fetchImpl });
  await client.initApkEnvironment();
  assert.equal(await client.wakeServer(() => {}, 20000), true);
  assert.equal(calls, 2);
});

test('an online server gives its public address for phones, not its Wi-Fi ones', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-online-'));
  const prev = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = `${ONLINE}/`;
  const app = createVyroServer({ port: 0, host: '127.0.0.1', dataDir });
  try {
    const { port } = await app.start();
    const net = await (await fetch(`http://127.0.0.1:${port}/api/network-info`)).json();
    assert.equal(net.publicUrl, ONLINE);
    assert.deepEqual(net.lanUrls, []);
  } finally {
    if (prev === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = prev;
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// deploy/start.sh, with stand-ins for node and litestream that print what they were given.
// It only ever runs on Linux (Render), so the Windows release build skips these.
const needsShell = { skip: process.platform === 'win32' && 'start.sh runs on Linux only' };

function runStartScript(env) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyro-bin-'));
  const dataDir = path.join(binDir, 'data');
  for (const name of ['node', 'litestream']) {
    fs.writeFileSync(
      path.join(binDir, name),
      `#!/bin/sh\necho "RAN ${name} $*"\necho "ENDPOINT=$BACKUP_ENDPOINT REGION=$BACKUP_REGION DATA=$VYRO_DATA_DIR"\n`,
      { mode: 0o755 }
    );
  }
  try {
    return execFileSync('sh', [path.join(rootDir, 'deploy/start.sh')], {
      env: { PATH: `${binDir}:/usr/bin:/bin`, VYRO_DATA_DIR: dataDir, ...env },
      encoding: 'utf8'
    }).replaceAll(dataDir, '<data>');
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
}

test('start.sh runs VYRO under Litestream when the Backblaze settings are there', needsShell, () => {
  const out = runStartScript({
    VYRO_SECRET: 'x',
    BACKUP_BUCKET: 'vyro-backup',
    BACKUP_ENDPOINT: 's3.eu-central-003.backblazeb2.com',
    BACKUP_KEY_ID: 'key-id',
    BACKUP_APP_KEY: 'app-key'
  });
  assert.match(out, /RAN litestream replicate -config deploy\/litestream\.yml -restore-if-db-not-exists -exec node server\/index\.js/);
  assert.match(out, /ENDPOINT=https:\/\/s3\.eu-central-003\.backblazeb2\.com REGION=eu-central-003 DATA=<data>/);
  assert.doesNotMatch(out, /WARNING/);
});

test('start.sh still starts VYRO without backups, and says what will be lost', needsShell, () => {
  const out = runStartScript({ BACKUP_BUCKET: 'vyro-backup' });
  assert.match(out, /RAN node server\/index\.js/);
  assert.doesNotMatch(out, /RAN litestream/);
  assert.match(out, /WARNING: backups are off/);
  assert.match(out, /WARNING: VYRO_SECRET is not set/);
});

test('the backup settings in litestream.yml match what start.sh and render.yaml provide', () => {
  const yml = fs.readFileSync(path.join(rootDir, 'deploy/litestream.yml'), 'utf8');
  const render = fs.readFileSync(path.join(rootDir, 'render.yaml'), 'utf8');
  for (const key of ['BACKUP_BUCKET', 'BACKUP_ENDPOINT', 'BACKUP_KEY_ID', 'BACKUP_APP_KEY']) {
    assert.ok(yml.includes(`\${${key}}`), `litestream.yml uses ${key}`);
    assert.ok(render.includes(`key: ${key}`), `render.yaml asks for ${key}`);
  }
  assert.ok(yml.includes('path: ${VYRO_DATA_DIR}/vyro.db'));
  assert.match(render, /key: VYRO_SECRET\s+generateValue: true/);
  assert.doesNotMatch(render, /disk:/, 'Render free services cannot have a disk');
});
