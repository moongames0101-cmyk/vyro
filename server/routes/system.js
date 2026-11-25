const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonBody, sendJson } = require('../auth');

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
      if (addr.family === 'IPv4' && !addr.internal) {
        urls.push({ interface: name, ip: addr.address, url: `http://${addr.address}:${port}` });
      }
    }
  }
  return urls;
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
    let localExes = [];
    try {
      if (fs.existsSync(distDir)) localExes = fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.exe'));
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
      localExes
    });
  }

  if (pathname === '/api/system/config' && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const cfg = loadConfig(configPath);
    if (body.githubOwner) cfg.githubOwner = String(body.githubOwner).trim().slice(0, 80);
    if (body.githubRepo) cfg.githubRepo = String(body.githubRepo).trim().slice(0, 80);
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
        exeAssets
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
