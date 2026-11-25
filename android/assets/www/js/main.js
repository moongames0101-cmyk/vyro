import { VyroWsClient, api, getToken, setToken } from './api.js';
import { mountAuthPortal } from './components/AuthPortal.js';
import { renderWorkspace } from './components/Workspace.js';
import { playChime, setState, state, subscribe, toast } from './state.js';

const rootEl = document.getElementById('root');

// Register PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
});

let wsClient = null;

async function loadMessages(scopeType, scopeId) {
  if (!scopeType || !scopeId) return;
  try {
    const res = await api(`/api/messages?scopeType=${encodeURIComponent(scopeType)}&scopeId=${encodeURIComponent(scopeId)}`);
    setState({ messages: res.messages || [] });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadAllData() {
  try {
    const [srvRes, frRes, stRes] = await Promise.all([
      api('/api/servers'),
      api('/api/friends'),
      api('/api/stories')
    ]);

    const servers = srvRes.servers || [];
    const friends = frRes.friends || [];

    const patch = {
      servers,
      voiceState: srvRes.voiceState || {},
      friends,
      incomingRequests: frRes.incoming || [],
      outgoingRequests: frRes.outgoing || [],
      storyGroups: stRes.storyGroups || []
    };

    if (!state.activeServerId && servers.length) {
      patch.activeServerId = servers[0].id;
      const firstCh = servers[0].channels.find((c) => c.type !== 'voice');
      patch.activeChannelId = firstCh?.id || null;
    }

    if (state.viewScope === 'home' && !state.activeDmId && friends.length) {
      patch.activeDmId = friends[0].dmId;
      patch.activeFriend = friends[0].user;
    }

    setState(patch);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function setupWs() {
  if (wsClient) wsClient.disconnect();
  wsClient = new VyroWsClient(
    (event, data) => {
      if (event === 'hello') {
        setState({ voiceState: data.voiceState || {} });
        return;
      }

      if (event === 'presence:update') {
        const servers = state.servers.map((s) => ({
          ...s,
          members: s.members.map((m) => (m.id === data.userId ? { ...m, ...(data.user || {}), presence: data.presence } : m))
        }));
        const friends = state.friends.map((f) =>
          f.user.id === data.userId ? { ...f, user: { ...f.user, ...(data.user || {}), presence: data.presence } } : f
        );
        setState({ servers, friends });
        return;
      }

      if (event === 'voice:state') {
        setState({ voiceState: data || {} });
        return;
      }

      if (event === 'message:new') {
        const msg = data.message;
        const currentScopeType = state.viewScope === 'server' ? 'channel' : 'dm';
        const currentScopeId = currentScopeType === 'channel' ? state.activeChannelId : state.activeDmId;

        if (msg.scopeType === currentScopeType && msg.scopeId === currentScopeId) {
          if (!state.messages.some((x) => x.id === msg.id)) {
            setState({ messages: [...state.messages, msg] });
          }
        }
        if (msg.authorId !== state.user?.id) {
          playChime(msg.kind === 'snap' ? 'snap' : 'msg');
          if (msg.kind === 'snap') {
            loadAllData();
          }
        }
        return;
      }

      if (event === 'message:update') {
        const msg = data.message;
        setState({
          messages: state.messages.map((m) => (m.id === msg.id ? msg : m))
        });
        return;
      }

      if (event === 'message:delete') {
        setState({
          messages: state.messages.filter((m) => m.id !== data.id)
        });
        return;
      }

      if (event === 'typing:start' || event === 'typing:stop') {
        const key = `${data.scopeType}:${data.scopeId}`;
        const next = { ...state.typingUsers };
        const map = { ...(next[key] || {}) };
        if (event === 'typing:start') map[data.userId] = data.displayName;
        else delete map[data.userId];
        next[key] = map;
        setState({ typingUsers: next });
        return;
      }

      if (event === 'story:new' || event === 'friend:request' || event === 'friend:accept' || event === 'server:update') {
        if (event === 'friend:request') {
          toast(`${data.from?.displayName || 'Someone'} sent you a friend request!`, 'snap');
        }
        loadAllData();
      }
    },
    (connected) => setState({ wsConnected: connected })
  );
  wsClient.connect();
}

async function enterApp(user) {
  setState({ user, route: 'app' });
  if (location.hash !== '#/app') location.hash = '#/app';
  setupWs();
  await loadAllData();
  api('/api/updates/check').then((upd) => setState({ updateInfo: upd })).catch(() => {});
  if (state.viewScope === 'server' && state.activeChannelId) {
    await loadMessages('channel', state.activeChannelId);
  } else if (state.activeDmId) {
    await loadMessages('dm', state.activeDmId);
  }
}

function render() {
  if (state.route === 'loading') return;
  if (state.route === 'auth') {
    mountAuthPortal(rootEl, enterApp);
    return;
  }
  renderWorkspace(rootEl, { wsClient, loadAllData, loadMessages });
}

subscribe(render);

function syncRouteFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  if (!state.user) {
    const tab = ['login', 'signup', 'reset', 'download'].includes(h) ? h : 'login';
    setState({ route: 'auth', authTab: tab });
  } else if (h === 'download') {
    setState({ route: 'auth', authTab: 'download' });
  } else {
    setState({ route: 'app' });
  }
}

window.addEventListener('hashchange', syncRouteFromHash);

if (window.vyroDesktop?.onUpdateStatus) {
  window.vyroDesktop.onUpdateStatus((info) => {
    setState({ desktopUpdateState: info });
    if (info.message) toast(info.message, info.kind || 'info');
  });
}

(async function boot() {
  const token = getToken();
  if (token) {
    try {
      const me = await api('/api/auth/me');
      await enterApp(me.user);
      return;
    } catch {
      setToken('');
    }
  }
  syncRouteFromHash();
})();
