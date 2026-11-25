const STORAGE_TOKEN = 'vyro_token';
const STORAGE_SERVER = 'vyro_server_url';
const STORAGE_SAVED_ACCOUNTS = 'vyro_saved_accounts';

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

export function getServerUrl() {
  return (localStorage.getItem(STORAGE_SERVER) || '').replace(/\/+$/, '');
}

export function setServerUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!clean) localStorage.removeItem(STORAGE_SERVER);
  else localStorage.setItem(STORAGE_SERVER, clean);
}

export function getToken() {
  return localStorage.getItem(STORAGE_TOKEN) || '';
}

export function setToken(token) {
  if (!token) localStorage.removeItem(STORAGE_TOKEN);
  else localStorage.setItem(STORAGE_TOKEN, token);
}

export async function api(path, options = {}) {
  const base = getServerUrl();
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
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
    this.closedManually = false;

    const base = getServerUrl();
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
