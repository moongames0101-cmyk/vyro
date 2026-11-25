const STORAGE_TOKEN = 'vyro_token';
const STORAGE_SERVER = 'vyro_server_url';
const STORAGE_SAVED_ACCOUNTS = 'vyro_saved_accounts';

let apkMode = false;
let apkLocalIps = [];

export function getSavedAccounts() {
  try {
    const raw = localStorage.getItem(STORAGE_SAVED_ACCOUNTS);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveRememberedAccount(user, token) {
  if (!user || !user.id) return;
  try {
    const list = getSavedAccounts().filter((a) => a.id !== user.id);
    list.unshift({
      id: user.id,
      email: user.email,
      username: user.username,
      discriminator: user.discriminator,
      displayName: user.displayName,
      avatarType: user.avatarType,
      avatarConfig: user.avatarConfig,
      avatarUrl: user.avatarUrl,
      token: token || '',
      savedAt: Date.now()
    });
    localStorage.setItem(STORAGE_SAVED_ACCOUNTS, JSON.stringify(list.slice(0, 8)));
  } catch {}
}

export function removeSavedAccount(userId) {
  try {
    const list = getSavedAccounts().filter((a) => a.id !== userId);
    localStorage.setItem(STORAGE_SAVED_ACCOUNTS, JSON.stringify(list));
  } catch {}
}

export function isPrivateOrLocalHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h) || /^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\.\d+\.\d+$/);
  if (m172) {
    const second = Number(m172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

export function normalizeServerUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { valid: true, url: '' };
  if (/\s/.test(trimmed)) return { valid: false, url: '' };

  let candidate = trimmed;
  const hadScheme = /^https?:\/\//i.test(candidate);
  if (!hadScheme) {
    const hostPart = candidate.split('/')[0];
    const hostOnly = hostPart.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const proto = isPrivateOrLocalHost(hostOnly) || /^\d+\.\d+\.\d+\.\d+$/.test(hostOnly) ? 'http://' : 'https://';
    candidate = `${proto}${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      return { valid: false, url: '' };
    }
    const bareIpWithoutPort =
      !parsed.port &&
      !/:(\d+)$/.test(candidate.split('/')[2] || '') &&
      (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) || parsed.hostname === 'localhost');
    const origin = bareIpWithoutPort ? `${parsed.protocol}//${parsed.hostname}:3847` : parsed.origin;
    return { valid: true, url: origin.replace(/\/+$/, '') };
  } catch {
    return { valid: false, url: '' };
  }
}

export function getServerUrl() {
  const stored = (localStorage.getItem(STORAGE_SERVER) || '').trim();
  if (!stored) return '';
  const { valid, url } = normalizeServerUrl(stored);
  return valid ? url : stored.replace(/\/+$/, '');
}

async function syncServerUrlToApk(clean) {
  if (!apkMode) return;
  try {
    await fetch('/_apk/server-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: clean })
    });
  } catch {}
}

export function setServerUrl(url) {
  const { valid, url: clean } = normalizeServerUrl(url);
  const next = valid ? clean : '';
  if (!next) localStorage.removeItem(STORAGE_SERVER);
  else localStorage.setItem(STORAGE_SERVER, next);
  syncServerUrlToApk(next);
  return next;
}

export async function saveServerUrl(url) {
  const { valid, url: clean } = normalizeServerUrl(url);
  if (!valid) {
    throw new Error('Invalid server URL. Example: 192.168.0.10:3847 or https://vyro.onrender.com');
  }
  if (!clean) localStorage.removeItem(STORAGE_SERVER);
  else localStorage.setItem(STORAGE_SERVER, clean);
  await syncServerUrlToApk(clean);
  return clean;
}

export function isApkMode() {
  return apkMode;
}

export function isApkUnconfigured() {
  return apkMode && !getServerUrl();
}

export function getApkLocalIps() {
  return apkLocalIps.slice();
}

export async function initApkEnvironment() {
  if (window.vyroDesktop) {
    apkMode = false;
    return { isApk: false };
  }
  if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
    apkMode = false;
    return { isApk: false };
  }
  try {
    const res = await fetch('/_apk/status', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) {
      apkMode = false;
      return { isApk: false };
    }
    const data = await res.json();
    if (data && data.isApk === true) {
      apkMode = true;
      apkLocalIps = Array.isArray(data.localIps) ? data.localIps : [];
      const localStored = getServerUrl();
      const nativeStored = data.serverUrl ? normalizeServerUrl(data.serverUrl).url : '';
      if (!localStored && nativeStored) {
        localStorage.setItem(STORAGE_SERVER, nativeStored);
      } else if (localStored && !nativeStored) {
        await syncServerUrlToApk(localStored);
      }
      return { isApk: true, serverUrl: getServerUrl(), localIps: apkLocalIps };
    }
  } catch {}
  apkMode = false;
  return { isApk: false };
}

export async function probeServerHealth(candidateUrl, timeoutMs = 2500) {
  const { valid, url } = normalizeServerUrl(candidateUrl);
  if (!valid || !url) {
    return { ok: false, error: 'Enter a valid VYRO server address first.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchUrl = apkMode ? '/api/health' : `${url}/api/health`;
    const headers = apkMode ? { 'X-Vyro-Target': url } : {};
    const res = await fetch(fetchUrl, { method: 'GET', headers, signal: controller.signal, cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.appName === 'VYRO') {
      return { ok: true, url, version: data.version || '', appName: data.appName };
    }
    return {
      ok: false,
      error: (data && data.error) || `Server responded (${res.status}), but it does not appear to be a VYRO server.`
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError'
        ? `Timed out connecting to ${url}. Make sure your phone and PC are on the same Wi-Fi.`
        : `Could not reach VYRO server at ${url}.`
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverLanServers() {
  if (!apkMode) return { found: [], localIps: [] };
  try {
    const res = await fetch('/_apk/discover', { cache: 'no-store' });
    if (!res.ok) return { found: [], localIps: apkLocalIps };
    const data = await res.json();
    if (Array.isArray(data.localIps)) apkLocalIps = data.localIps;
    return {
      found: Array.isArray(data.found) ? data.found : [],
      localIps: apkLocalIps
    };
  } catch {
    return { found: [], localIps: apkLocalIps };
  }
}

export function getToken() {
  return localStorage.getItem(STORAGE_TOKEN) || '';
}

export function setToken(token) {
  if (!token) localStorage.removeItem(STORAGE_TOKEN);
  else localStorage.setItem(STORAGE_TOKEN, token);
}

export async function api(path, options = {}) {
  const base = options.targetUrl ? normalizeServerUrl(options.targetUrl).url : getServerUrl();
  if (apkMode && !base) {
    const err = new Error('No VYRO server connected yet. Tap Scan Wi-Fi or enter your VYRO server URL first.');
    err.code = 'NO_SERVER_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apkMode && base) {
    headers['X-Vyro-Target'] = base;
  }

  const targetUrl = apkMode ? path : `${base}${path}`;
  let res;
  try {
    res = await fetch(targetUrl, {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
  } catch (networkErr) {
    const err = new Error(
      base
        ? `Could not reach VYRO server (${base}). Check Wi-Fi or server status.`
        : 'Network connection failed. Check your server connection.'
    );
    err.code = 'SERVER_UNREACHABLE';
    err.cause = networkErr;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data.error;
    if (!msg) {
      msg = res.status === 404
        ? 'VYRO API endpoint not found on this server (404). Verify the Server URL points to a running VYRO server.'
        : `Request failed (${res.status})`;
    }
    const err = new Error(msg);
    err.status = res.status;
    err.code = data.code || '';
    throw err;
  }
  return data;
}

export class VyroWsClient {
  constructor(onEvent, onStatus) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ws = null;
    this.closedManually = false;
    this.reconnectMs = 1000;
    this.pingTimer = null;
  }

  connect() {
    const token = getToken();
    if (!token) return;
    const base = getServerUrl();
    if (apkMode && !base) return;
    this.closedManually = false;

    let wsUrl;
    if (base) {
      wsUrl = base.replace(/^http/i, 'ws') + `/ws?token=${encodeURIComponent(token)}`;
    } else {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectMs = 1000;
      this.onStatus?.(true);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        this.send('ping', {});
      }, 25000);
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this.onEvent?.(msg.event, msg.data);
      } catch {}
    };

    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.onStatus?.(false);
      if (!this.closedManually && getToken()) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  scheduleReconnect() {
    setTimeout(() => {
      if (!this.closedManually && getToken()) this.connect();
    }, this.reconnectMs);
    this.reconnectMs = Math.min(8000, this.reconnectMs * 1.5);
  }

  send(event, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  disconnect() {
    this.closedManually = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
