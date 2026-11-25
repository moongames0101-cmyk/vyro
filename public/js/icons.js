import { escapeHtml } from './state.js';

export const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#8B5CF6,#FACC15)',
  'linear-gradient(135deg,#7C3AED,#EC4899)',
  'linear-gradient(135deg,#0EA5E9,#8B5CF6)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#06B6D4)',
  'linear-gradient(135deg,#EC4899,#FACC15)'
];

export const SKIN_TONES = ['#FDE2C8', '#F5C9A6', '#D99B72', '#A86E44', '#6E4124', '#FFE600'];
export const HAIR_STYLES = ['short', 'bob', 'curly', 'spiky', 'beanie', 'bolt'];
export const EYE_STYLES = ['happy', 'wink', 'shades', 'star', 'chill'];
export const OUTFIT_COLORS = ['#6D28D9', '#0369A1', '#B45309', '#BE185D', '#047857', '#1E1B4B'];

export function renderBitmojiSvg(cfg = {}) {
  const c = {
    bg: cfg.bg || AVATAR_GRADIENTS[0],
    skin: cfg.skin || '#F5C9A6',
    hair: cfg.hair || 'short',
    eyes: cfg.eyes || 'happy',
    outfit: cfg.outfit || '#6D28D9',
    accent: cfg.accent || '#FACC15',
    badge: cfg.badge || ''
  };

  let hairPath = '';
  if (c.hair === 'short') {
    hairPath = `<path d="M24 44 C24 21, 76 21, 76 44 C70 34, 30 34, 24 44 Z" fill="#1E1B2E"/>`;
  } else if (c.hair === 'bob') {
    hairPath = `<path d="M20 62 C20 18, 80 18, 80 62 L73 68 C73 36, 27 36, 27 68 Z" fill="#1E1B2E"/>`;
  } else if (c.hair === 'curly') {
    hairPath = `<g fill="#1E1B2E"><circle cx="30" cy="30" r="10"/><circle cx="44" cy="24" r="11"/><circle cx="58" cy="24" r="11"/><circle cx="70" cy="31" r="10"/><circle cx="24" cy="42" r="8"/><circle cx="76" cy="42" r="8"/></g>`;
  } else if (c.hair === 'spiky') {
    hairPath = `<path d="M24 42 L26 23 L38 30 L50 15 L62 30 L74 22 L76 42 C66 34, 34 34, 24 42 Z" fill="#1E1B2E"/>`;
  } else if (c.hair === 'beanie') {
    hairPath = `<path d="M24 41 C26 18, 74 18, 76 41 Z" fill="${c.accent}"/><rect x="22" y="36" width="56" height="9" rx="4.5" fill="#181826"/>`;
  } else if (c.hair === 'bolt') {
    hairPath = `<path d="M52 14 L38 36 L50 36 L44 54 L63 31 L50 31 Z" fill="#0F172A" opacity="0.22"/>`;
  }

  let eyesSvg = '';
  if (c.eyes === 'shades') {
    eyesSvg = `
      <rect x="30" y="45" width="17" height="10" rx="3" fill="#090910"/>
      <rect x="53" y="45" width="17" height="10" rx="3" fill="#090910"/>
      <line x1="47" y1="49" x2="53" y2="49" stroke="#090910" stroke-width="2.5"/>
      <line x1="33" y1="48" x2="39" y2="48" stroke="#FACC15" stroke-width="1.5"/>
    `;
  } else if (c.eyes === 'wink') {
    eyesSvg = `
      <circle cx="39" cy="50" r="3.4" fill="#0F172A"/>
      <path d="M55 50 Q61 46 66 50" stroke="#0F172A" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    `;
  } else if (c.eyes === 'star') {
    eyesSvg = `
      <text x="39" y="54" text-anchor="middle" font-size="11" fill="#8B5CF6">★</text>
      <text x="61" y="54" text-anchor="middle" font-size="11" fill="#8B5CF6">★</text>
    `;
  } else if (c.eyes === 'chill') {
    eyesSvg = `
      <line x1="34" y1="49" x2="43" y2="49" stroke="#0F172A" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="57" y1="49" x2="66" y2="49" stroke="#0F172A" stroke-width="2.6" stroke-linecap="round"/>
    `;
  } else {
    eyesSvg = `
      <circle cx="39" cy="49" r="3.3" fill="#0F172A"/>
      <circle cx="61" cy="49" r="3.3" fill="#0F172A"/>
      <circle cx="40.2" cy="47.8" r="1" fill="#fff"/>
      <circle cx="62.2" cy="47.8" r="1" fill="#fff"/>
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="avBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#FACC15" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" fill="#131629"/>
    <rect width="100" height="100" fill="url(#avBg)"/>
    <path d="M18 100 C18 74, 82 74, 82 100 Z" fill="${escapeHtml(c.outfit)}"/>
    <circle cx="50" cy="50" r="24" fill="${escapeHtml(c.skin)}"/>
    ${hairPath}
    ${eyesSvg}
    <path d="M41 61 Q50 67 59 61" stroke="#0F172A" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`;
}

export function renderAvatarHtml(user, size = 38, showPresence = false) {
  if (!user) return '';
  const bg = user.avatarConfig?.bg || 'linear-gradient(135deg,#8B5CF6,#FACC15)';
  const inner =
    user.avatarType === 'image' && user.avatarUrl
      ? `<img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName || user.username)}" />`
      : renderBitmojiSvg(user.avatarConfig || {});
  const dot = showPresence
    ? `<span class="presence-dot ${escapeHtml(user.presence || 'offline')}"></span>`
    : '';
  return `<div class="vyro-avatar" style="width:${size}px;height:${size}px;">
    <div class="vyro-avatar-inner" style="background:${escapeHtml(bg)};">${inner}</div>
    ${dot}
  </div>`;
}

export const ICONS = {
  hash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
  zap: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  volume: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  camera: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  mic: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  headphones: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  users: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  qr: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  send: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  home: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  compass: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  message: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  globe: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  refresh: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  bell: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  phone: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  video: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  userPlus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  music: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  sparkles: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/></svg>`,
  winMin: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  winMax: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  winClose: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
};
