const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const { extractToken, verifyToken, sendJson } = require('./auth');
const { initDatabase } = require('./db');
const { createWsHub } = require('./ws');
const { handleAuthRoutes } = require('./routes/auth');
const { handleSocialRoutes } = require('./routes/social');
const { handleServerRoutes } = require('./routes/servers');
const { handleMessageRoutes } = require('./routes/messages');
const { handleStoryRoutes } = require('./routes/stories');
const { handleSystemRoutes } = require('./routes/system');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.exe': 'application/octet-stream',
  '.apk': 'application/vnd.android.package-archive'
};

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=3600'
  });
  fs.createReadStream(filePath).pipe(res);
}

function createVyroServer(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const publicDir = path.join(rootDir, 'public');
  const assetsDir = path.join(rootDir, 'assets');
  const distDir = path.join(rootDir, 'dist');
  const dataDir = options.dataDir || process.env.VYRO_DATA_DIR || path.join(rootDir, 'data');
  const configPath = options.configPath || path.join(rootDir, 'vyro.config.json');

  let defaultPort = 3847;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (cfg.port) defaultPort = Number(cfg.port);
  } catch {}
  const port = options.port !== undefined ? Number(options.port) : Number(process.env.PORT || defaultPort);
  const host = options.host || process.env.HOST || '0.0.0.0';

  const db = initDatabase(dataDir);
  const wsHub = createWsHub({ db, dataDir });

  const cleanupInterval = setInterval(() => {
    try {
      const now = Date.now();
      const expiredMsgs = db
        .prepare('SELECT id, scope_type, scope_id FROM messages WHERE expires_at > 0 AND expires_at <= ? AND is_saved = 0')
        .all(now);
      if (expiredMsgs.length > 0) {
        db.prepare('DELETE FROM messages WHERE expires_at > 0 AND expires_at <= ? AND is_saved = 0').run(now);
        for (const m of expiredMsgs) {
          wsHub.broadcastAll('message:delete', { id: m.id, scopeType: m.scope_type, scopeId: m.scope_id });
        }
      }
      db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now);
    } catch {}
  }, 5000);
  cleanupInterval.unref();

  const server = http.createServer(async (req, res) => {
    const methodOverride = req.headers['x-http-method-override'];
    if (req.method === 'POST' && typeof methodOverride === 'string' && /^(PATCH|PUT|DELETE)$/i.test(methodOverride.trim())) {
      req.method = methodOverride.trim().toUpperCase();
    }
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-HTTP-Method-Override');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    try {
      if (pathname.startsWith('/api/')) {
        const token = extractToken(req, urlObj);
        const claims = verifyToken(token, dataDir);
        const authUser = claims && claims.userId
          ? db.prepare('SELECT * FROM users WHERE id = ?').get(claims.userId)
          : null;

        const ctx = {
          req,
          res,
          pathname,
          urlObj,
          db,
          dataDir,
          authUser,
          wsHub,
          port: server.address() ? server.address().port : port,
          configPath,
          rootDir
        };

        if (await handleSystemRoutes(ctx)) return;
        if (await handleAuthRoutes(ctx)) return;
        if (await handleSocialRoutes(ctx)) return;
        if (await handleServerRoutes(ctx)) return;
        if (await handleMessageRoutes(ctx)) return;
        if (await handleStoryRoutes(ctx)) return;

        return sendJson(res, 404, { error: 'API endpoint not found.' });
      }

      if (pathname.startsWith('/assets/')) {
        const rel = pathname.slice('/assets/'.length).replace(/\.\./g, '');
        const filePath = path.join(assetsDir, rel);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return serveStaticFile(res, filePath);
        }
      }

      if (pathname.startsWith('/downloads/')) {
        const rel = pathname.slice('/downloads/'.length).replace(/\.\./g, '');
        const filePath = path.join(distDir, rel);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
          return serveStaticFile(res, filePath);
        }
      }

      const cleanPath = pathname === '/' ? '/index.html' : pathname.replace(/\.\./g, '');
      const candidate = path.join(publicDir, cleanPath);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return serveStaticFile(res, candidate);
      }

      return serveStaticFile(res, path.join(publicDir, 'index.html'));
    } catch (err) {
      const code = err.statusCode || 500;
      if (!res.headersSent) sendJson(res, code, { error: err.message || 'Internal server error' });
    }
  });

  server.on('upgrade', (req, socket) => wsHub.handleUpgrade(req, socket));

  return {
    server,
    db,
    wsHub,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve({ port: addr.port, host: addr.address, dataDir });
        });
      });
    },
    stop() {
      clearInterval(cleanupInterval);
      return new Promise((resolve) => {
        server.close(() => {
          try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
          try { db.close(); } catch {}
          resolve();
        });
      });
    }
  };
}

if (require.main === module) {
  const app = createVyroServer();
  app.start().then(({ port }) => {
    console.log(`\n⚡ VYRO Server listening on http://localhost:${port}`);
    console.log(`📱 Mobile LAN ready on port ${port} — open VYRO and tap "Mobile QR"\n`);
  }).catch((err) => {
    console.error('Failed to start VYRO server:', err);
    process.exit(1);
  });
}

module.exports = { createVyroServer };
