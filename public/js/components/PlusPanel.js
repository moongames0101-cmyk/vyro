// The VYRO+ tab in Settings: what you get, subscribe, customise, and cancel any time.
import { api, isApkMode } from '../api.js';
import { renderAvatarHtml } from '../icons.js';
import {
  BORDERS,
  LABELS,
  NAME_COLORS,
  NAME_EFFECTS,
  NAME_FONTS,
  OPTION_NAMES,
  PLUS_PRICE,
  THEMES,
  crownBadgeHtml,
  renderNameHtml
} from '../plus.js';
import { escapeHtml, setState, state, toast } from '../state.js';

const PERKS = [
  ['👑', 'VYRO+ crown badge', 'A glowing purple-and-gold crown next to your name, on your profile and in chats.'],
  ['🎨', 'Premium profile', 'Exclusive profile themes, animated backgrounds, custom borders and premium fonts.'],
  ['✨', 'Stickers & reactions', 'Animated premium reactions, message effects and VYRO+ sticker packs.'],
  ['🌈', 'Name styling', 'Special name colours, animated name effects and exclusive profile labels.']
];

function openExternal(url) {
  if (window.vyroDesktop?.openExternal) return window.vyroDesktop.openExternal(url);
  if (window.VyroNative?.openUrl) return window.VyroNative.openUrl(url);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}

function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function chipRow(key, list, current) {
  return `<div class="chip-row">${list
    .map((v) => `<button type="button" class="chip-option ${v === current ? 'active' : ''}" data-plus-key="${key}" data-plus-val="${escapeHtml(v)}">${escapeHtml(OPTION_NAMES[v] || v)}</button>`)
    .join('')}</div>`;
}

export async function renderPlusPanel(body) {
  body.innerHTML = `<div class="field-hint">Loading VYRO+...</div>`;
  let st;
  try {
    st = await api('/api/plus/status');
  } catch (err) {
    body.innerHTML = `<div class="auth-error-banner">${escapeHtml(err.message)}</div>`;
    return;
  }
  const draft = { ...st.style };
  const u = state.user;
  const inApk = isApkMode();
  const nativeBilling = Boolean(window.VyroBilling && typeof window.VyroBilling.subscribe === 'function');

  const previewUser = () => ({
    ...u,
    plus: { active: true, ...draft }
  });

  const subscribeHtml = () => {
    if (st.active) return '';
    if (inApk) {
      if (st.billing.google && nativeBilling) {
        return `<button class="btn btn-primary plus-cta" id="plus-buy-google">Subscribe with Google Play • ${PLUS_PRICE}</button>`;
      }
      if (st.billing.card && st.billing.cardInApk) {
        return `<button class="btn btn-primary plus-cta" id="plus-buy-card">Subscribe • ${PLUS_PRICE}</button>`;
      }
      return `<button class="btn btn-primary plus-cta" disabled>Coming soon to the app</button>
        <div class="field-hint">VYRO+ opens in the app once it's on the Galaxy Store and Google Play.</div>`;
    }
    if (st.billing.card) {
      return `<button class="btn btn-primary plus-cta" id="plus-buy-card">Subscribe • ${PLUS_PRICE}</button>
        <div class="field-hint">Secure checkout by Stripe. VYRO never sees your card details.</div>`;
    }
    return `<button class="btn btn-primary plus-cta" disabled>Coming soon</button>
      <div class="field-hint">Payments switch on when VYRO+ launches.</div>`;
  };

  const statusHtml = () => {
    if (!st.active) return `<div class="plus-status">${PLUS_PRICE} • Cancel any time • No ads, ever</div>`;
    if (st.source === 'gift') return `<div class="plus-status on">Gifted VYRO+ until ${fmtDate(st.plusUntil)}</div>`;
    if (st.cancelAtPeriodEnd || !st.renews) return `<div class="plus-status on">Active until ${fmtDate(st.plusUntil)} • won't renew</div>`;
    return `<div class="plus-status on">Active • renews ${fmtDate(st.plusUntil)}</div>`;
  };

  const manageHtml = () => {
    if (!st.active && st.store !== 'stripe' && st.store !== 'google') return '';
    if (st.source === 'gift') return '';
    const btn =
      st.store === 'google'
        ? `<button type="button" class="btn btn-secondary btn-sm" id="plus-manage-google">Manage or cancel in Google Play</button>`
        : st.manage.card
          ? `<button type="button" class="btn btn-secondary btn-sm" id="plus-manage-card">Manage or cancel</button>`
          : '';
    return btn
      ? `<div class="plus-manage">${btn}<span class="field-hint">Cancel in two taps. You keep VYRO+ until the end of the month you paid for.</span></div>`
      : '';
  };

  const customiseHtml = () => `
    <div class="plus-customise ${st.active ? '' : 'locked'}">
      <div class="plus-sub-title">${st.active ? 'Customise your look' : 'Preview what you get'}</div>
      <div class="plus-preview ${draft.theme !== 'none' ? `plus-theme plus-theme-${escapeHtml(draft.theme)}` : ''}" id="plus-preview">
        ${renderAvatarHtml(previewUser(), 64)}
        <div style="min-width:0;">
          <div class="plus-preview-name">${renderNameHtml(previewUser(), { labels: true, badgeSize: 17 })}</div>
          <div class="field-hint">@${escapeHtml(u.username)}</div>
        </div>
      </div>
      <div class="field"><label>Name colour</label>${chipRow('nameColor', NAME_COLORS, draft.nameColor)}</div>
      <div class="field"><label>Name effect</label>${chipRow('nameEffect', NAME_EFFECTS, draft.nameEffect)}</div>
      <div class="field"><label>Font</label>${chipRow('nameFont', NAME_FONTS, draft.nameFont)}</div>
      <div class="field"><label>Profile theme</label>${chipRow('theme', THEMES, draft.theme)}</div>
      <div class="field"><label>Avatar border</label>${chipRow('border', BORDERS, draft.border)}</div>
      <div class="field"><label>Profile labels (up to 3)</label><div class="chip-row">${LABELS.map(
        (l) => `<button type="button" class="chip-option ${draft.labels.includes(l) ? 'active' : ''}" data-plus-label="${escapeHtml(l)}">${escapeHtml(l)}</button>`
      ).join('')}</div></div>
      <label class="plus-toggle"><input type="checkbox" id="plus-show-badge" ${draft.showBadge ? 'checked' : ''}/> Show my crown badge</label>
      ${st.active ? `<button type="button" class="btn btn-primary" id="plus-save">Save my look</button>` : ''}
    </div>`;

  const paint = () => {
    body.innerHTML = `<div class="plus-panel">
      <div class="plus-hero">
        <div class="plus-hero-badge">${crownBadgeHtml(44)}</div>
        <div>
          <div class="plus-hero-title">VYRO<span>+</span></div>
          ${statusHtml()}
        </div>
      </div>
      <div class="plus-perks">
        ${PERKS.map(([icon, title, text]) => `<div class="plus-perk"><span class="plus-perk-icon">${icon}</span><div><strong>${title}</strong><span>${text}</span></div></div>`).join('')}
      </div>
      ${subscribeHtml()}
      ${manageHtml()}
      ${customiseHtml()}
    </div>`;
    wire();
  };

  const wire = () => {
    body.querySelectorAll('[data-plus-key]').forEach((b) => {
      b.onclick = () => {
        draft[b.dataset.plusKey] = b.dataset.plusVal;
        paint();
      };
    });
    body.querySelectorAll('[data-plus-label]').forEach((b) => {
      b.onclick = () => {
        const l = b.dataset.plusLabel;
        if (draft.labels.includes(l)) draft.labels = draft.labels.filter((x) => x !== l);
        else if (draft.labels.length < 3) draft.labels = [...draft.labels, l];
        else toast('You can pick up to 3 labels.', 'info');
        paint();
      };
    });
    const badge = body.querySelector('#plus-show-badge');
    if (badge) {
      badge.onchange = () => {
        draft.showBadge = badge.checked;
        paint();
      };
    }
    body.querySelector('#plus-save')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/plus/style', { method: 'PATCH', body: draft });
        setState({ user: res.user });
        toast('Your VYRO+ look is saved 👑', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    body.querySelector('#plus-buy-card')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        const res = await api('/api/plus/checkout', { method: 'POST' });
        openExternal(res.url);
      } catch (err) {
        toast(err.message, 'error');
      }
      e.currentTarget.disabled = false;
    });
    body.querySelector('#plus-buy-google')?.addEventListener('click', () => {
      // Native Play Billing flow; the app calls window.onVyroPurchase(token) when it finishes.
      window.onVyroPurchase = async (purchaseToken) => {
        try {
          const res = await api('/api/plus/verify', { method: 'POST', body: { store: 'google', purchaseToken } });
          setState({ user: res.user });
          toast('Welcome to VYRO+ 👑', 'success');
          renderPlusPanel(body);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      window.VyroBilling.subscribe(st.googleProductId, st.accountRef);
    });
    body.querySelector('#plus-manage-google')?.addEventListener('click', () => openExternal(st.manage.google));
    body.querySelector('#plus-manage-card')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/plus/portal', { method: 'POST' });
        openExternal(res.url);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };

  paint();
}
