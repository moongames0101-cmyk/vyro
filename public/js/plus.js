// VYRO+ look: crown badge, name styles, avatar borders, premium reactions, stickers and effects.
// Every value is checked against these lists before it becomes a CSS class, so nothing user-typed reaches the page.
import { escapeHtml } from './state.js';

export const PLUS_PRICE = '£1.99/month';
export const NAME_COLORS = ['gold', 'violet', 'sunset', 'ocean', 'candy', 'mint'];
export const NAME_EFFECTS = ['none', 'shine', 'glow', 'wave'];
export const NAME_FONTS = ['default', 'script', 'serif', 'block'];
export const THEMES = ['none', 'aurora', 'sunset', 'ocean', 'candy', 'midnight'];
export const BORDERS = ['none', 'neon', 'gold', 'glow', 'rainbow'];
export const LABELS = ['OG', 'VIP', 'CREATOR', 'GAMER', 'ARTIST', 'MUSIC', 'NIGHT OWL', 'EARLY USER'];
export const PLUS_REACTIONS = ['👑', '💎', '✨', '🚀', '🌈', '💜'];
export const PLUS_EFFECTS = ['glow', 'sparkle', 'confetti'];
export const STICKERS = {
  crown: { emoji: '👑', text: 'Royalty' },
  fire: { emoji: '🔥', text: 'On fire' },
  gg: { emoji: '🎮', text: 'GG' },
  love: { emoji: '💜', text: 'Love this' },
  lol: { emoji: '😂', text: 'LOL' },
  hype: { emoji: '🚀', text: "Let's go" },
  night: { emoji: '🌙', text: 'Night owl' },
  wave: { emoji: '👋', text: 'Hey!' }
};

const COLOR_NAMES = { gold: 'Gold', violet: 'Violet', sunset: 'Sunset', ocean: 'Ocean', candy: 'Candy', mint: 'Mint' };
export const OPTION_NAMES = {
  ...COLOR_NAMES,
  none: 'None',
  shine: 'Shine',
  glow: 'Glow',
  wave: 'Wave',
  default: 'Default',
  script: 'Script',
  serif: 'Serif',
  block: 'Block',
  aurora: 'Aurora',
  midnight: 'Midnight',
  neon: 'Neon',
  rainbow: 'Rainbow'
};

const pick = (v, list, d) => (list.includes(v) ? v : d);

export function plusOf(user) {
  const p = user && user.plus;
  if (!p || !p.active) return null;
  return {
    showBadge: p.showBadge !== false,
    nameColor: pick(p.nameColor, NAME_COLORS, 'gold'),
    nameEffect: pick(p.nameEffect, NAME_EFFECTS, 'shine'),
    nameFont: pick(p.nameFont, NAME_FONTS, 'default'),
    theme: pick(p.theme, THEMES, 'aurora'),
    border: pick(p.border, BORDERS, 'neon'),
    labels: Array.isArray(p.labels) ? p.labels.filter((l) => LABELS.includes(l)).slice(0, 3) : []
  };
}

export function isPlus(user) {
  return Boolean(plusOf(user));
}

// Purple-and-gold crown shown beside VYRO+ members' names.
export function crownBadgeHtml(size = 15) {
  return `<span class="plus-crown" title="VYRO+ member" aria-label="VYRO+ member"><svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11.5" fill="#6D28D9"/>
    <path d="M5.2 16.4 4.4 8.6l4.3 3.3L12 6.2l3.3 5.7 4.3-3.3-.8 7.8z" fill="#FACC15" stroke="#FEF3C7" stroke-width=".6" stroke-linejoin="round"/>
    <rect x="5.4" y="16.9" width="13.2" height="2.2" rx="1" fill="#F59E0B"/>
  </svg></span>`;
}

// A display name, styled for VYRO+ members. `opts.labels` adds their profile labels.
export function renderNameHtml(user, opts = {}) {
  const name = escapeHtml((user && (user.displayName || user.username)) || 'User');
  const p = plusOf(user);
  if (!p) return `<span class="vname">${name}</span>`;
  const cls = ['vname', 'vname-plus', `vname-c-${p.nameColor}`, `vname-fx-${p.nameEffect}`, `vname-f-${p.nameFont}`];
  const labels = opts.labels && p.labels.length
    ? p.labels.map((l) => `<span class="plus-label">${escapeHtml(l)}</span>`).join('')
    : '';
  return `<span class="${cls.join(' ')}" data-text="${name}">${name}</span>${p.showBadge && opts.badge !== false ? crownBadgeHtml(opts.badgeSize || 15) : ''}${labels}`;
}

export function avatarBorderClass(user) {
  const p = plusOf(user);
  return p && p.border !== 'none' ? ` plus-border plus-border-${p.border}` : '';
}

export function profileThemeClass(user) {
  const p = plusOf(user);
  return p && p.theme !== 'none' ? `plus-theme plus-theme-${p.theme}` : '';
}

export function stickerHtml(id) {
  const s = STICKERS[id];
  if (!s) return '';
  return `<div class="vsticker vsticker-${escapeHtml(id)}"><span class="vsticker-emoji">${s.emoji}</span><span class="vsticker-text">${escapeHtml(s.text)}</span></div>`;
}

// One-off confetti burst for messages sent with the confetti effect.
export function burstConfetti(anchorEl) {
  if (!anchorEl || typeof document === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.style.left = `${rect.left + rect.width / 2}px`;
  layer.style.top = `${rect.top + rect.height / 2}px`;
  const colors = ['#FACC15', '#8B5CF6', '#EC4899', '#22D3EE', '#34D399'];
  for (let i = 0; i < 26; i++) {
    const bit = document.createElement('i');
    const angle = (Math.PI * 2 * i) / 26;
    const dist = 50 + Math.random() * 70;
    bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 30}px`);
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 80}ms`;
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}
