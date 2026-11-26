const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonBody, sendJson, isLocalRequest } = require('../auth');

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return { appName: 'VYRO', version: '1.0.2', port: 3847, githubOwner: 'moongames0101-cmyk', githubRepo: 'vyro' };
  }
}

function getLanAddresses(port) {
  const ifaces = os.networkInterfaces();
  const urls = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        const virtual = /vethernet|virtualbox|vmware|wsl|hyper-v|docker|loopback|tailscale|zerotier/i.test(name);
        const privateLan = addr.address.startsWith('192.168.') || addr.address.startsWith('10.');
        const score = (virtual ? 0 : 10) + (privateLan ? 5 : 0);
        urls.push({ interface: name, ip: addr.address, url: `http://${addr.address}:${port}`, score });
      }
    }
  }
  urls.sort((a, b) => b.score - a.score);
  return urls.map(({ interface: iface, ip, url }) => ({ interface: iface, ip, url }));
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function handleSystemRoutes({ req, res, pathname, port, configPath, rootDir }) {
  if (pathname === '/api/health' && req.method === 'GET') {
    const cfg = loadConfig(configPath);
    return sendJson(res, 200, { ok: true, appName: cfg.appName || 'VYRO', version: cfg.version || '1.0.0', uptimeSec: Math.floor(process.uptime()) });
  }

  if (pathname === '/api/network-info' && req.method === 'GET') {
    const cfg = loadConfig(configPath);
    const lanUrls = getLanAddresses(port);
    const distDir = path.join(rootDir, 'dist');
    const ver = cfg.version || '1.1.0';
    let localExes = [];
    let localApks = [];
    try {
      if (fs.existsSync(distDir)) {
        const allExes = fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.exe'));
        const currentExes = allExes.filter((f) => f.includes(ver));
        localExes = currentExes.length ? currentExes : allExes.slice(-2);

        const allApks = fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.apk'));
        const currentApks = allApks.filter((f) => f.includes(ver));
        localApks = currentApks.length ? currentApks : allApks.filter((f) => f === 'VYRO.apk').slice(0, 1);
      }
    } catch {}

    return sendJson(res, 200, {
      appName: cfg.appName || 'VYRO',
      version: cfg.version || '1.0.0',
      port,
      localUrl: `http://localhost:${port}`,
      lanUrls,
      githubOwner: cfg.githubOwner,
      githubRepo: cfg.githubRepo,
      githubReleasesUrl: `https://github.com/${cfg.githubOwner}/${cfg.githubRepo}/releases`,
      localExes,
      localApks
    });
  }

  if (pathname === '/api/system/config' && req.method === 'PATCH') {
    // Changing where updates come from must only be possible on the computer running the server.
    // Otherwise anyone could point everyone's update button at their own (malicious) download.
    if (!isLocalRequest(req)) {
      return sendJson(res, 403, { error: 'Update settings can only be changed on the computer running VYRO.' });
    }
    const body = await readJsonBody(req);
    const cfg = loadConfig(configPath);
    const safeName = (v) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(v).trim());
    if (body.githubOwner && safeName(body.githubOwner)) cfg.githubOwner = String(body.githubOwner).trim();
    if (body.githubRepo && safeName(body.githubRepo)) cfg.githubRepo = String(body.githubRepo).trim();
    try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8'); } catch {}
    return sendJson(res, 200, { config: cfg });
  }

  if (pathname === '/api/updates/check' && req.method === 'GET') {
    const cfg = loadConfig(configPath);
    const currentVersion = cfg.version || '1.0.1';
    const owner = !cfg.githubOwner || cfg.githubOwner === 'YOUR_GITHUB_USERNAME' ? 'moongames0101-cmyk' : cfg.githubOwner;
    const repo = cfg.githubRepo || 'vyro';
    const releasesPage = `https://github.com/${owner}/${repo}/releases`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VYRO-Desktop-Updater' },
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!apiRes.ok) {
        return sendJson(res, 200, {
          configured: true,
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          githubOwner: owner,
          githubRepo: repo,
          releasesPage,
          message: `No published release found yet (${apiRes.status}). Tag v1.0.0 on GitHub to publish!`
        });
      }

      const rel = await apiRes.json();
      const latestVersion = String(rel.tag_name || currentVersion).replace(/^v/i, '');
      const exeAssets = (rel.assets || [])
        .filter((a) => a.name.toLowerCase().endsWith('.exe'))
        .map((a) => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url }));
      const apkAssets = (rel.assets || [])
        .filter((a) => a.name.toLowerCase().endsWith('.apk'))
        .map((a) => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url }));

      return sendJson(res, 200, {
        configured: true,
        currentVersion,
        latestVersion,
        updateAvailable: compareSemver(latestVersion, currentVersion) > 0,
        githubOwner: owner,
        githubRepo: repo,
        releaseName: rel.name || `v${latestVersion}`,
        releaseNotes: rel.body || '',
        publishedAt: rel.published_at || '',
        releasesPage: rel.html_url || releasesPage,
        exeAssets,
        apkAssets
      });
    } catch {
      return sendJson(res, 200, {
        configured: true,
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        githubOwner: owner,
        githubRepo: repo,
        releasesPage,
        offline: true,
        message: 'Could not reach GitHub right now (offline or sandboxed).'
      });
    }
  }

  return false;
}

module.exports = { handleSystemRoutes };
