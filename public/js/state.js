export const state = {
  route: 'loading', // 'auth' | 'app' | 'download'
  authTab: 'login', // 'login' | 'signup' | 'reset' | 'download'
  user: null,
  wsConnected: false,
  viewScope: 'home', // 'home' | 'server'
  activeServerId: null,
  activeChannelId: null,
  activeDmId: null,
  activeFriend: null,
  servers: [],
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  storyGroups: [],
  messages: [],
  voiceState: {},
  myVoiceChannelId: null,
  voiceMuted: false,
  voiceDeafened: false,
  voiceCamera: false,
  typingUsers: {}, // `${scopeType}:${scopeId}` -> { userId: displayName }
  replyTo: null,
  showMembersPane: true,
  mobileTab: 'chat', // 'chats' | 'servers' | 'chat' | 'stories' | 'profile'
  updateInfo: null,
  deferredInstallPrompt: null
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function toast(message, kind = 'info', durationMs = 3400) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const icon = kind === 'success' ? '✅' : kind === 'error' ? '⚠️' : kind === 'snap' ? '⚡' : '💬';
  el.innerHTML = `<span>${icon}</span><div style="flex:1;font-size:13px;font-weight:600;">${escapeHtml(message)}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(16px)';
    el.style.transition = 'all 0.18s ease';
    setTimeout(() => el.remove(), 200);
  }, durationMs);
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatInlineMarkdown(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.09);padding:1px 5px;border-radius:4px;font-family:var(--font-mono);font-size:12.5px;">$1</code>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--vyro-gold);text-decoration:underline;">$1</a>');
  return safe.replace(/\n/g, '<br/>');
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Gentle WebAudio chimes for messages, snaps, and voice join/leave
let audioCtx = null;
export function playChime(type = 'msg') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';

    if (type === 'snap') {
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(940, now + 0.11);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (type === 'voice') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.08);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else {
      osc.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.start(now);
      osc.stop(now + 0.09);
    }
  } catch {}
}
