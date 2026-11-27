import { api, getServerUrl, isApkMode, saveServerUrl, setToken } from '../api.js';
import { openAvatarCropperModal } from './AvatarCropper.js';
import {
  AVATAR_GRADIENTS,
  EYE_STYLES,
  HAIR_STYLES,
  ICONS,
  OUTFIT_COLORS,
  SKIN_TONES,
  renderAvatarHtml,
  renderBitmojiSvg
} from '../icons.js';
import { escapeHtml, setState, state, toast } from '../state.js';
import { renderQrSvg } from '../utils/qr.js';
import { renderPlusPanel } from './PlusPanel.js';
import { renderModPanel } from './ModPanel.js';
import { profileThemeClass, renderNameHtml } from '../plus.js';

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

export function openModal(innerHtml, onMount, wide = false) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card ${wide ? 'wide' : ''}" id="modal-card">
        ${innerHtml}
      </div>
    </div>
  `;
  root.querySelector('#modal-backdrop').onclick = (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  };
  onMount?.(root.querySelector('#modal-card'));
}

export function openCreateJoinServerModal(onRefresh) {
  openModal(
    `
    <div class="modal-head">
      <h3>Create or join a community</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div class="auth-tabs" style="margin-bottom:4px;">
      <button class="auth-tab active" data-tab="create">Create</button>
      <button class="auth-tab" data-tab="join">Join with a code</button>
    </div>
    <div id="srv-modal-body"></div>
    `,
    (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      const body = card.querySelector('#srv-modal-body');

      const renderCreate = () => {
        body.innerHTML = `
          <form id="create-srv-form" class="form-grid">
            <div class="form-row-2">
              <div class="field">
                <label>Name</label>
                <input class="input-control" id="srv-name" placeholder="e.g. Midnight Squad" required maxlength="40" />
              </div>
              <div class="field">
                <label>Icon</label>
                <input class="input-control" id="srv-emoji" value="⚡" maxlength="6" />
              </div>
            </div>
            <div class="field">
              <label>Colour</label>
              <div class="swatch-row">
                ${AVATAR_GRADIENTS.map((g, idx) => `<button type="button" class="swatch-btn ${idx === 0 ? 'active' : ''}" data-grad="${escapeHtml(g)}" style="background:${g};width:32px;height:32px;"></button>`).join('')}
              </div>
            </div>
            <div class="field">
              <label>Description</label>
              <input class="input-control" id="srv-desc" placeholder="Channels, flash snaps & voice hangouts" maxlength="160" />
            </div>
            <button type="submit" class="btn btn-primary">Create community</button>
          </form>
        `;
        let chosenGrad = AVATAR_GRADIENTS[0];
        body.querySelectorAll('[data-grad]').forEach((b) => {
          b.onclick = () => {
            body.querySelectorAll('[data-grad]').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            chosenGrad = b.dataset.grad;
          };
        });
        body.querySelector('#create-srv-form').onsubmit = async (e) => {
          e.preventDefault();
          try {
            const res = await api('/api/servers', {
              method: 'POST',
              body: {
                name: body.querySelector('#srv-name').value.trim(),
                iconEmoji: body.querySelector('#srv-emoji').value.trim() || '⚡',
                iconColor: chosenGrad,
                description: body.querySelector('#srv-desc').value.trim()
              }
            });
            closeModal();
            toast(`Created ${res.server.name}! Invite: ${res.server.inviteCode}`, 'success');
            await onRefresh();
            setState({
              viewScope: 'server',
              activeServerId: res.server.id,
              activeChannelId: res.server.channels[0]?.id || null
            });
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      };

      const renderJoin = () => {
        body.innerHTML = `
          <form id="join-srv-form" class="form-grid">
            <div class="field">
              <label>Invite code</label>
              <input class="input-control" id="join-code" placeholder="Enter server invite code" style="text-transform:uppercase;font-family:var(--font-mono);" required />
            </div>
            <p class="field-hint">Ask your friend or community owner for their 6-character invite code.</p>
            <button type="submit" class="btn btn-primary">Join</button>
          </form>
        `;
        body.querySelector('#join-srv-form').onsubmit = async (e) => {
          e.preventDefault();
          try {
            const res = await api('/api/servers/join', {
              method: 'POST',
              body: { inviteCode: body.querySelector('#join-code').value.trim() }
            });
            closeModal();
            toast(`Joined ${res.server.name}!`, 'success');
            await onRefresh();
            setState({
              viewScope: 'server',
              activeServerId: res.server.id,
              activeChannelId: res.server.channels[0]?.id || null
            });
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      };

      card.querySelectorAll('[data-tab]').forEach((t) => {
        t.onclick = () => {
          card.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
          t.classList.add('active');
          if (t.dataset.tab === 'join') renderJoin();
          else renderCreate();
        };
      });

      renderCreate();
    }
  );
}

export function openCreateChannelModal(serverId, onRefresh) {
  openModal(
    `
    <div class="modal-head">
      <h3>New channel</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <form id="ch-form" class="form-grid">
      <div class="field">
        <label>Type</label>
        <div class="chip-row">
          <button type="button" class="chip-option active" data-type="text"># Text Channel</button>
          <button type="button" class="chip-option" data-type="ephemeral">Disappearing chat</button>
          <button type="button" class="chip-option" data-type="voice">🔊 Voice Lounge</button>
        </div>
      </div>
      <div class="field">
        <label>Name</label>
        <input class="input-control" id="ch-name" placeholder="e.g. midnight-snaps" required maxlength="32" />
      </div>
      <div class="field hidden" id="ch-ttl-wrap">
        <label>Auto-Disappear Timer (seconds)</label>
        <input class="input-control" id="ch-ttl" type="number" min="5" max="300" value="15" />
      </div>
      <div class="field">
        <label>Topic (Optional)</label>
        <input class="input-control" id="ch-topic" placeholder="What happens in this room?" maxlength="140" />
      </div>
      <button type="submit" class="btn btn-primary">Create Channel</button>
    </form>
    `,
    (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      let type = 'text';
      const ttlWrap = card.querySelector('#ch-ttl-wrap');
      card.querySelectorAll('[data-type]').forEach((btn) => {
        btn.onclick = () => {
          card.querySelectorAll('[data-type]').forEach((x) => x.classList.remove('active'));
          btn.classList.add('active');
          type = btn.dataset.type;
          ttlWrap.classList.toggle('hidden', type !== 'ephemeral');
        };
      });
      card.querySelector('#ch-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const res = await api(`/api/servers/${serverId}/channels`, {
            method: 'POST',
            body: {
              type,
              name: card.querySelector('#ch-name').value.trim(),
              defaultTtlSec: Number(card.querySelector('#ch-ttl').value || 15),
              topic: card.querySelector('#ch-topic').value.trim()
            }
          });
          closeModal();
          toast(`Created #${res.channel.name}`, 'success');
          await onRefresh();
          setState({ activeChannelId: res.channel.id });
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  );
}

export function openAddFriendModal(onRefresh) {
  openModal(
    `
    <div class="modal-head">
      <h3>Add friends</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <form id="fr-add-form" style="display:flex;gap:8px;">
      <input class="input-control" id="fr-target" placeholder="Username or Name#0000" required />
      <button type="submit" class="btn btn-primary">Send friend request</button>
    </form>
    <div class="field">
      <label>People you might know</label>
      <input class="input-control" id="fr-search" placeholder="Search users..." />
    </div>
    <div id="fr-search-results" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;"></div>
    `,
    (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      const resultsEl = card.querySelector('#fr-search-results');

      const loadUsers = async (q = '') => {
        try {
          const res = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
          if (!res.users.length) {
            resultsEl.innerHTML = `<div class="field-hint">No matching users found.</div>`;
            return;
          }
          resultsEl.innerHTML = res.users
            .map(
              (u) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;background:var(--bg-elevated);">
              <div style="display:flex;align-items:center;gap:10px;">
                ${renderAvatarHtml(u, 34, true)}
                <div>
                  <div style="font-weight:700;font-size:13px;">${escapeHtml(u.displayName)} <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">#${escapeHtml(u.discriminator)}</span></div>
                  <div class="field-hint">👻 ${u.snapScore} • ${escapeHtml(u.statusText || 'On VYRO')}</div>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" data-add-id="${escapeHtml(u.id)}">+ Add</button>
            </div>
          `
            )
            .join('');
          resultsEl.querySelectorAll('[data-add-id]').forEach((b) => {
            b.onclick = async () => {
              try {
                const r = await api('/api/friends/request', { method: 'POST', body: { target: b.dataset.addId } });
                toast(r.message, 'success');
                await onRefresh();
              } catch (err) {
                toast(err.message, 'error');
              }
            };
          });
        } catch {}
      };

      loadUsers('');
      card.querySelector('#fr-search').oninput = (e) => loadUsers(e.target.value.trim());

      card.querySelector('#fr-add-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api('/api/friends/request', {
            method: 'POST',
            body: { target: card.querySelector('#fr-target').value.trim() }
          });
          toast(r.message, 'success');
          card.querySelector('#fr-target').value = '';
          await onRefresh();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  );
}

export async function openMobileQrModal() {
  openModal(
    `
    <div class="modal-head">
      <h3>Open VYRO on your phone</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div id="qr-modal-body" style="display:flex;flex-direction:column;gap:14px;">
      <div class="field-hint">Loading network addresses...</div>
    </div>
    `,
    async (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      const body = card.querySelector('#qr-modal-body');
      try {
        const net = await api('/api/network-info');
        const primaryUrl = net.lanUrls?.[0]?.url || location.origin;
        body.innerHTML = `
          <p style="font-size:13px;color:var(--text-secondary);">
            Open your phone camera (same Wi-Fi) and scan this QR code to jump right into VYRO on mobile — or install it to your Home Screen as a PWA!
          </p>
          <div class="qr-card">${renderQrSvg(primaryUrl, 196)}</div>
          <div style="display:flex;gap:8px;">
            <input class="input-control" id="qr-url-copy" value="${escapeHtml(primaryUrl)}" readonly style="font-family:var(--font-mono);font-size:12.5px;" />
            <button class="btn btn-secondary btn-sm" id="copy-lan-btn">Copy</button>
          </div>
          ${net.lanUrls?.length > 1 ? `<div class="field-hint">Other interfaces: ${net.lanUrls.map((u) => escapeHtml(u.url)).join(', ')}</div>` : ''}
          <div class="field-hint">
            Want to connect friends anywhere over the internet? Deploy VYRO to Render/Railway using the included <code>render.yaml</code> or <code>Dockerfile</code>, and enter that URL in Switch Server.
          </div>
        `;
        body.querySelector('#copy-lan-btn').onclick = () => {
          navigator.clipboard?.writeText(primaryUrl);
          toast('Mobile URL copied!', 'success');
        };
      } catch (err) {
        body.innerHTML = `<div class="auth-error-banner">${escapeHtml(err.message)}</div>`;
      }
    }
  );
}

export function openUserProfileModal(user, onOpenDm) {
  openModal(
    `
    <div class="modal-head">
      <h3>Profile</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div class="${profileThemeClass(user)}" style="display:flex;align-items:center;gap:14px;border-radius:16px;${profileThemeClass(user) ? 'padding:14px;' : ''}">
      ${renderAvatarHtml(user, 68, true)}
      <div>
        <div style="font-family:var(--font-display);font-size:22px;font-weight:700;">${renderNameHtml(user, { labels: true, badgeSize: 18 })}</div>
        <div style="font-family:var(--font-mono);font-size:12.5px;color:var(--text-muted);">@${escapeHtml(user.username)}#${escapeHtml(user.discriminator)}</div>
        <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
          <span class="badge-pill" style="background:rgba(250,204,21,0.16);color:var(--vyro-gold);">👻 Score ${user.snapScore || 0}</span>
          <span class="badge-pill" style="background:rgba(139,92,246,0.18);color:#DDD6FE;">● ${escapeHtml(user.presence || 'offline')}</span>
        </div>
      </div>
    </div>
    <div style="background:var(--bg-elevated);padding:12px;border-radius:12px;border:1px solid var(--border-subtle);">
      <div class="field-hint" style="margin-bottom:4px;">Status</div>
      <div style="font-size:13.5px;font-weight:600;">${escapeHtml(user.statusText || 'Chilling on VYRO')}</div>
      ${user.bio ? `<div class="field-hint" style="margin-top:10px;margin-bottom:4px;">Bio</div><div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(user.bio)}</div>` : ''}
    </div>
    ${
      user.id !== state.user?.id
        ? `<div style="display:flex;gap:10px;">
            <button class="btn btn-primary" id="prof-dm-btn" style="flex:1;">💬 Message / Send Snap</button>
          </div>`
        : ''
    }
    `,
    (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      const dmBtn = card.querySelector('#prof-dm-btn');
      if (dmBtn) {
        dmBtn.onclick = async () => {
          closeModal();
          await onOpenDm(user.id);
        };
      }
    }
  );
}

export function openSettingsAndUpdatesModal(onRefresh, onLogout, initialTab = 'profile') {
  const u = state.user;
  if (!u) return;
  const draftCfg = { ...(u.avatarConfig || { bg: AVATAR_GRADIENTS[0], skin: SKIN_TONES[1], hair: 'short', eyes: 'happy', outfit: OUTFIT_COLORS[0], accent: '#FACC15' }) };
  let avatarType = u.avatarType || 'svg';
  let avatarUrl = u.avatarUrl || '';

  openModal(
    `
    <div class="modal-head">
      <h3>${initialTab === 'updates' ? 'Updates' : initialTab === 'plus' ? 'VYRO+' : 'Settings'}</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div class="auth-tabs" style="margin-bottom:4px;grid-template-columns:repeat(${u.isAdmin ? 4 : 3},1fr);">
      <button class="auth-tab ${initialTab === 'profile' ? 'active' : ''}" data-stab="profile">Profile</button>
      <button class="auth-tab ${initialTab === 'plus' ? 'active' : ''}" data-stab="plus">VYRO+</button>
      <button class="auth-tab ${initialTab === 'updates' ? 'active' : ''}" data-stab="updates">Updates</button>
      ${u.isAdmin ? `<button class="auth-tab" data-stab="mod">Moderation</button>` : ''}
    </div>
    <div id="settings-body"></div>
    `,
    (card) => {
      card.querySelector('#m-close').onclick = closeModal;
      const body = card.querySelector('#settings-body');

      const renderProfile = () => {
        body.innerHTML = `
          <form id="prof-save-form" class="form-grid">
            <div class="form-row-2">
              <div class="field">
                <label>Display name</label>
                <input class="input-control" id="st-display" value="${escapeHtml(u.displayName)}" maxlength="32" />
              </div>
              <div class="field">
                <label>Presence</label>
                <select class="input-control" id="st-presence">
                  <option value="online" ${u.presence === 'online' ? 'selected' : ''}>🟢 Online</option>
                  <option value="idle" ${u.presence === 'idle' ? 'selected' : ''}>🟡 Idle</option>
                  <option value="dnd" ${u.presence === 'dnd' ? 'selected' : ''}>🔴 Do Not Disturb</option>
                  <option value="offline" ${u.presence === 'offline' ? 'selected' : ''}>⚫ Invisible</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label>Status</label>
              <input class="input-control" id="st-status" value="${escapeHtml(u.statusText)}" maxlength="80" />
            </div>
            <div class="field">
              <label>Bio</label>
              <input class="input-control" id="st-bio" value="${escapeHtml(u.bio)}" maxlength="180" />
            </div>
            ${
              !u.hasBirthday || !u.hasRecoveryPhrase
                ? `<div class="form-row-2">
                    ${!u.hasBirthday ? `<div class="field"><label>Date of birth (needed for VYRO Live)</label><input class="input-control" type="date" id="st-bday" max="${new Date().toISOString().slice(0, 10)}" /><span class="field-hint">You can only set this once.</span></div>` : ''}
                    ${!u.hasRecoveryPhrase ? `<div class="field"><label>Recovery phrase</label><input class="input-control" id="st-rec" minlength="4" placeholder="So you can reset your password" /><span class="field-hint">Write it down somewhere safe.</span></div>` : ''}
                  </div>`
                : ''
            }
            <div class="avatar-builder-box">
              <div class="avatar-preview-stage">
                <div id="st-av-preview" style="width:84px;height:84px;border-radius:50%;overflow:hidden;border:2px solid var(--vyro-gold);">
                  ${avatarType === 'image' && avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;object-position:center center;display:block;" />` : renderBitmojiSvg(draftCfg)}
                </div>
                <label class="btn btn-secondary btn-sm" style="cursor:pointer;font-size:11px;">
                  Photo
                  <input type="file" id="st-av-file" accept="image/*" class="hidden" />
                </label>
                ${avatarType === 'image' && avatarUrl ? `<button type="button" class="btn btn-secondary btn-sm" id="st-av-adjust" style="font-size:11px;">Adjust Fit</button>` : ''}
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div class="chip-row">
                  ${HAIR_STYLES.map((h) => `<button type="button" class="chip-option ${draftCfg.hair === h ? 'active' : ''}" data-hair="${h}">${h}</button>`).join('')}
                </div>
                <div class="chip-row">
                  ${EYE_STYLES.map((ey) => `<button type="button" class="chip-option ${draftCfg.eyes === ey ? 'active' : ''}" data-eyes="${ey}">${ey}</button>`).join('')}
                </div>
                <div class="swatch-row">
                  ${SKIN_TONES.map((s) => `<button type="button" class="swatch-btn ${draftCfg.skin === s ? 'active' : ''}" data-skin="${s}" style="background:${s};"></button>`).join('')}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:10px;justify-content:space-between;">
              <button type="button" class="btn btn-danger" id="st-logout">Log out</button>
              <button type="submit" class="btn btn-primary" style="flex:1;">Save changes</button>
            </div>
          </form>
        `;

        body.querySelectorAll('[data-hair]').forEach((b) => {
          b.onclick = () => {
            avatarType = 'svg';
            draftCfg.hair = b.dataset.hair;
            renderProfile();
          };
        });
        body.querySelectorAll('[data-eyes]').forEach((b) => {
          b.onclick = () => {
            avatarType = 'svg';
            draftCfg.eyes = b.dataset.eyes;
            renderProfile();
          };
        });
        body.querySelectorAll('[data-skin]').forEach((b) => {
          b.onclick = () => {
            avatarType = 'svg';
            draftCfg.skin = b.dataset.skin;
            renderProfile();
          };
        });
        body.querySelector('#st-av-file').onchange = (e) => {
          const inputEl = e.target;
          const f = inputEl.files?.[0];
          inputEl.value = '';
          if (!f) return;
          openAvatarCropperModal(f, {
            title: 'Frame Your Profile Pic',
            onConfirm: (dataUrl) => {
              avatarType = 'image';
              avatarUrl = dataUrl;
              renderProfile();
            },
            onError: () => toast('Could not load photo', 'error')
          });
        };
        const adjustBtn = body.querySelector('#st-av-adjust');
        if (adjustBtn && avatarUrl) {
          adjustBtn.onclick = () => {
            openAvatarCropperModal(avatarUrl, {
              title: 'Adjust Profile Pic Fit',
              onConfirm: (dataUrl) => {
                avatarType = 'image';
                avatarUrl = dataUrl;
                renderProfile();
              },
              onError: () => toast('Could not adjust photo', 'error')
            });
          };
        }
        body.querySelector('#st-logout').onclick = () => {
          closeModal();
          onLogout();
        };
        body.querySelector('#prof-save-form').onsubmit = async (e) => {
          e.preventDefault();
          try {
            const res = await api('/api/auth/me', {
              method: 'PATCH',
              body: {
                displayName: body.querySelector('#st-display').value.trim(),
                presence: body.querySelector('#st-presence').value,
                statusText: body.querySelector('#st-status').value.trim(),
                bio: body.querySelector('#st-bio').value.trim(),
                avatarType,
                avatarUrl,
                avatarConfig: draftCfg,
                ...(body.querySelector('#st-bday')?.value ? { birthday: body.querySelector('#st-bday').value } : {}),
                ...(body.querySelector('#st-rec')?.value.trim() ? { recoveryHint: body.querySelector('#st-rec').value.trim() } : {})
              }
            });
            setState({ user: res.user });
            closeModal();
            toast('Profile updated!', 'success');
            await onRefresh();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      };

      const renderUpdates = async () => {
        body.innerHTML = `<div class="field-hint">Checking for the latest VYRO release...</div>`;
        const upd = await api('/api/updates/check').catch(() => ({
          currentVersion: '1.2.0',
          latestVersion: '1.2.0',
          updateAvailable: false,
          githubOwner: 'moongames0101-cmyk',
          githubRepo: 'vyro',
          releasesPage: 'https://github.com/moongames0101-cmyk/vyro/releases'
        }));
        setState({ updateInfo: upd });

        const dState = state.desktopUpdateState;
        const isReady = dState?.stage === 'ready';
        const isDownloading = dState?.stage === 'downloading';
        const hasUpdate = Boolean(upd.updateAvailable || isReady || isDownloading);
        const setupAsset = (upd.exeAssets || []).find((a) => a.name.toLowerCase().includes('setup')) || upd.exeAssets?.[0];
        const portableAsset = (upd.exeAssets || []).find((a) => a.name.toLowerCase().includes('portable'));

        body.innerHTML = `
          <div class="form-grid">
            <div style="background:linear-gradient(135deg,rgba(139,92,246,0.16),rgba(250,204,21,0.1));padding:18px;border-radius:16px;border:1px solid rgba(168,85,247,0.35);display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;align-items:center;gap:12px;">
                <img src="/assets/icon-192.png" width="46" height="46" style="border-radius:12px;box-shadow:var(--shadow-glow);" />
                <div style="flex:1;">
                  <div style="font-family:var(--font-display);font-size:17px;font-weight:700;">VYRO ${escapeHtml(upd.currentVersion)}</div>
                  <div class="field-hint">
                    ${
                      isReady
                        ? `Version ${escapeHtml(dState.version || upd.latestVersion)} is downloaded. Restart to finish updating.`
                        : isDownloading
                        ? `⬇️ Downloading update... ${dState.percent || 0}%`
                        : upd.updateAvailable
                        ? `Version ${escapeHtml(upd.latestVersion)} is available.`
                        : '✓ You are on the latest version of VYRO.'
                    }
                  </div>
                </div>
                <span class="badge-pill" style="background:${hasUpdate ? 'rgba(250,204,21,0.2)' : 'rgba(34,197,94,0.18)'};color:${hasUpdate ? 'var(--vyro-gold)' : '#4ADE80'};">
                  ${hasUpdate ? `v${escapeHtml(dState?.version || upd.latestVersion)}` : 'Up to Date'}
                </span>
              </div>

              ${
                isDownloading
                  ? `<div class="xp-track" style="height:8px;"><div class="xp-fill" style="width:${dState.percent || 15}%;"></div></div>`
                  : ''
              }

              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${
                  isReady && window.vyroDesktop
                    ? `<button type="button" class="btn btn-primary" id="upd-install-now" style="flex:1;">Restart and update</button>`
                    : window.vyroDesktop
                    ? `<button type="button" class="btn btn-primary" id="upd-one-click" style="flex:1;">${upd.updateAvailable ? `⬇️ Download &amp; Install v${escapeHtml(upd.latestVersion)}` : '🔄 Check for Updates'}</button>`
                    : setupAsset
                    ? `<a class="btn btn-primary" href="${escapeHtml(setupAsset.downloadUrl)}" target="_blank" rel="noopener" style="flex:1;">${ICONS.download} ${upd.updateAvailable ? `Update to v${escapeHtml(upd.latestVersion)}` : 'Download Installer (.exe)'}</a>`
                    : `<button type="button" class="btn btn-primary" id="upd-recheck-web" style="flex:1;">🔄 Check for Updates</button>`
                }
                ${
                  portableAsset
                    ? `<a class="btn btn-secondary" href="${escapeHtml(portableAsset.downloadUrl)}" target="_blank" rel="noopener">${ICONS.download} Portable .exe</a>`
                    : ''
                }
              </div>

              ${
                upd.releaseNotes
                  ? `<div style="font-size:12px;color:var(--text-secondary);background:rgba(0,0,0,0.28);padding:10px 12px;border-radius:10px;max-height:110px;overflow-y:auto;white-space:pre-line;">${escapeHtml(upd.releaseNotes)}</div>`
                  : ''
              }

              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);">
                <span>Automatic updates via GitHub Releases</span>
                <a href="${escapeHtml(upd.releasesPage)}" target="_blank" rel="noopener" style="color:var(--vyro-gold);font-weight:700;">View Releases ↗</a>
              </div>
            </div>

            <details style="background:var(--bg-elevated);padding:10px 14px;border-radius:12px;border:1px solid var(--border-subtle);">
              <summary style="cursor:pointer;font-size:12.5px;font-weight:700;color:var(--text-secondary);">Advanced Connection Settings</summary>
              <div class="form-grid" style="margin-top:12px;">
                <div class="field">
                  <label>Server address (optional)</label>
                  <div style="display:flex;gap:8px;">
                    <input class="input-control" id="srv-url-input" value="${escapeHtml(getServerUrl())}" placeholder="${escapeHtml(isApkMode() ? '192.168.0.x:3847 or https://...' : `${location.origin} (local)`)}" />
                    <button type="button" class="btn btn-secondary btn-sm" id="srv-url-save">Apply</button>
                  </div>
                </div>
                <form id="gh-repo-form" class="form-grid">
                  <div class="form-row-2">
                    <div class="field">
                      <label>GitHub Owner</label>
                      <input class="input-control" id="gh-owner" value="${escapeHtml(upd.githubOwner || 'moongames0101-cmyk')}" />
                    </div>
                    <div class="field">
                      <label>Repository</label>
                      <input class="input-control" id="gh-repo" value="${escapeHtml(upd.githubRepo || 'vyro')}" />
                    </div>
                  </div>
                  <button type="submit" class="btn btn-secondary btn-sm">Save Custom Repo</button>
                </form>
              </div>
            </details>
          </div>
        `;

        body.querySelector('#upd-install-now')?.addEventListener('click', () => {
          window.vyroDesktop?.installUpdateNow();
        });

        body.querySelector('#upd-one-click')?.addEventListener('click', () => {
          window.vyroDesktop?.checkForUpdates();
          toast('Checking & downloading updates from GitHub...', 'info');
          setTimeout(() => renderUpdates(), 1200);
        });

        body.querySelector('#upd-recheck-web')?.addEventListener('click', () => renderUpdates());

        body.querySelector('#gh-repo-form').onsubmit = async (e) => {
          e.preventDefault();
          await api('/api/system/config', {
            method: 'PATCH',
            body: {
              githubOwner: body.querySelector('#gh-owner').value.trim(),
              githubRepo: body.querySelector('#gh-repo').value.trim()
            }
          });
          toast('Saved repository override!', 'success');
          renderUpdates();
        };

        body.querySelector('#srv-url-save').onclick = async () => {
          try {
            await saveServerUrl(body.querySelector('#srv-url-input').value);
            setToken('');
            location.reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        };
      };

      card.querySelectorAll('[data-stab]').forEach((t) => {
        t.onclick = () => {
          card.querySelectorAll('[data-stab]').forEach((x) => x.classList.remove('active'));
          t.classList.add('active');
          if (t.dataset.stab === 'updates') renderUpdates();
          else if (t.dataset.stab === 'plus') renderPlusPanel(body);
          else if (t.dataset.stab === 'mod') renderModPanel(body);
          else renderProfile();
        };
      });

      if (initialTab === 'updates') renderUpdates();
      else if (initialTab === 'plus') renderPlusPanel(body);
      else renderProfile();
    },
    true
  );
}
