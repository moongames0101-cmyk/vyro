import { api, getServerUrl, setServerUrl, setToken } from '../api.js';
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
      <h3>Create or Join a VYRO Server</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div class="auth-tabs" style="margin-bottom:4px;">
      <button class="auth-tab active" data-tab="create">Create Server</button>
      <button class="auth-tab" data-tab="join">Join via Invite</button>
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
                <label>Server Name</label>
                <input class="input-control" id="srv-name" placeholder="e.g. Midnight Squad" required maxlength="40" />
              </div>
              <div class="field">
                <label>Icon Emoji</label>
                <input class="input-control" id="srv-emoji" value="⚡" maxlength="6" />
              </div>
            </div>
            <div class="field">
              <label>Theme Gradient</label>
              <div class="swatch-row">
                ${AVATAR_GRADIENTS.map((g, idx) => `<button type="button" class="swatch-btn ${idx === 0 ? 'active' : ''}" data-grad="${escapeHtml(g)}" style="background:${g};width:32px;height:32px;"></button>`).join('')}
              </div>
            </div>
            <div class="field">
              <label>Description</label>
              <input class="input-control" id="srv-desc" placeholder="Channels, flash snaps & voice hangouts" maxlength="160" />
            </div>
            <button type="submit" class="btn btn-primary">Create Server ⚡</button>
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
              <label>Invite Code</label>
              <input class="input-control" id="join-code" placeholder="e.g. VYROHQ or OWLS24" style="text-transform:uppercase;font-family:var(--font-mono);" required />
            </div>
            <p class="field-hint">Public demo servers: <strong>VYROHQ</strong> and <strong>OWLS24</strong></p>
            <button type="submit" class="btn btn-primary">Join Server 🚀</button>
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
      <h3>Create Channel</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <form id="ch-form" class="form-grid">
      <div class="field">
        <label>Channel Type</label>
        <div class="chip-row">
          <button type="button" class="chip-option active" data-type="text"># Text Channel</button>
          <button type="button" class="chip-option" data-type="ephemeral">⚡ Ephemeral Snap Room</button>
          <button type="button" class="chip-option" data-type="voice">🔊 Voice Lounge</button>
        </div>
      </div>
      <div class="field">
        <label>Channel Name</label>
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
      <h3>Add Friends &amp; Start Streaks 🔥</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <form id="fr-add-form" style="display:flex;gap:8px;">
      <input class="input-control" id="fr-target" placeholder="Username or Name#0000 (e.g. Kai#8812)" required />
      <button type="submit" class="btn btn-primary">Send Request</button>
    </form>
    <div class="field">
      <label>Discover People on VYRO</label>
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
      <h3>📱 Connect Mobile &amp; Share VYRO</h3>
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
      <h3>VYRO Profile</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div style="display:flex;align-items:center;gap:14px;">
      ${renderAvatarHtml(user, 68, true)}
      <div>
        <div style="font-size:20px;font-weight:900;">${escapeHtml(user.displayName)}</div>
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

export function openSettingsAndUpdatesModal(onRefresh, onLogout) {
  const u = state.user;
  if (!u) return;
  const draftCfg = { ...(u.avatarConfig || { bg: AVATAR_GRADIENTS[0], skin: SKIN_TONES[1], hair: 'short', eyes: 'happy', outfit: OUTFIT_COLORS[0], accent: '#FACC15' }) };
  let avatarType = u.avatarType || 'svg';
  let avatarUrl = u.avatarUrl || '';

  openModal(
    `
    <div class="modal-head">
      <h3>Settings, Avatar &amp; GitHub Updates</h3>
      <button class="btn-ghost btn-sm" id="m-close">✕</button>
    </div>
    <div class="auth-tabs" style="margin-bottom:4px;">
      <button class="auth-tab active" data-stab="profile">Profile &amp; Avatar</button>
      <button class="auth-tab" data-stab="updates">GitHub Updates &amp; Server</button>
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
                <label>Display Name</label>
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
              <label>Custom Status</label>
              <input class="input-control" id="st-status" value="${escapeHtml(u.statusText)}" maxlength="80" />
            </div>
            <div class="field">
              <label>Bio</label>
              <input class="input-control" id="st-bio" value="${escapeHtml(u.bio)}" maxlength="180" />
            </div>
            <div class="avatar-builder-box">
              <div class="avatar-preview-stage">
                <div id="st-av-preview" style="width:84px;height:84px;border-radius:50%;overflow:hidden;border:2px solid var(--vyro-gold);">
                  ${avatarType === 'image' && avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;" />` : renderBitmojiSvg(draftCfg)}
                </div>
                <label class="btn btn-secondary btn-sm" style="cursor:pointer;font-size:11px;">
                  Photo
                  <input type="file" id="st-av-file" accept="image/*" class="hidden" />
                </label>
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
              <button type="button" class="btn btn-danger" id="st-logout">Log Out</button>
              <button type="submit" class="btn btn-primary" style="flex:1;">Save Profile</button>
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
          const f = e.target.files?.[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            avatarType = 'image';
            avatarUrl = r.result;
            renderProfile();
          };
          r.readAsDataURL(f);
        };
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
                avatarConfig: draftCfg
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
        body.innerHTML = `<div class="field-hint">Checking GitHub Releases...</div>`;
        const upd = await api('/api/updates/check').catch(() => ({ currentVersion: '1.0.0', githubOwner: 'YOUR_GITHUB_USERNAME', githubRepo: 'vyro' }));
        body.innerHTML = `
          <div class="form-grid">
            <div style="background:var(--bg-elevated);padding:14px;border-radius:12px;border:1px solid var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>VYRO Desktop / Web</strong>
                <span class="badge-pill" style="background:rgba(139,92,246,0.2);color:#DDD6FE;">v${escapeHtml(upd.currentVersion)}</span>
              </div>
              <div class="field-hint" style="margin-top:6px;">${escapeHtml(upd.message || (upd.updateAvailable ? `New version v${upd.latestVersion} available!` : 'You are running the latest version.'))}</div>
              ${
                upd.exeAssets?.length
                  ? `<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
                      ${upd.exeAssets.map((a) => `<a class="btn btn-primary btn-sm" href="${escapeHtml(a.downloadUrl)}" target="_blank">${ICONS.download} Download ${escapeHtml(a.name)}</a>`).join('')}
                    </div>`
                  : ''
              }
              ${
                window.vyroDesktop
                  ? `<button type="button" class="btn btn-secondary btn-sm" id="electron-check-upd" style="margin-top:10px;">🔄 Check Desktop Auto-Updater</button>`
                  : ''
              }
            </div>

            <form id="gh-repo-form" class="form-grid">
              <div class="form-row-2">
                <div class="field">
                  <label>GitHub Username / Org</label>
                  <input class="input-control" id="gh-owner" value="${escapeHtml(upd.githubOwner || '')}" />
                </div>
                <div class="field">
                  <label>GitHub Repo Name</label>
                  <input class="input-control" id="gh-repo" value="${escapeHtml(upd.githubRepo || 'vyro')}" />
                </div>
              </div>
              <button type="submit" class="btn btn-secondary btn-sm">Save GitHub Repo Link</button>
            </form>

            <div class="field">
              <label>Connected Server URL (PC &amp; Mobile Sync)</label>
              <div style="display:flex;gap:8px;">
                <input class="input-control" id="srv-url-input" value="${escapeHtml(getServerUrl())}" placeholder="${escapeHtml(location.origin)} (default)" />
                <button type="button" class="btn btn-secondary btn-sm" id="srv-url-save">Apply</button>
              </div>
            </div>
          </div>
        `;

        const elecBtn = body.querySelector('#electron-check-upd');
        if (elecBtn) {
          elecBtn.onclick = () => {
            window.vyroDesktop.checkForUpdates();
            toast('Checking GitHub Releases via desktop updater...', 'info');
          };
        }

        body.querySelector('#gh-repo-form').onsubmit = async (e) => {
          e.preventDefault();
          await api('/api/system/config', {
            method: 'PATCH',
            body: {
              githubOwner: body.querySelector('#gh-owner').value.trim(),
              githubRepo: body.querySelector('#gh-repo').value.trim()
            }
          });
          toast('GitHub repository saved!', 'success');
          renderUpdates();
        };

        body.querySelector('#srv-url-save').onclick = () => {
          setServerUrl(body.querySelector('#srv-url-input').value);
          setToken('');
          location.reload();
        };
      };

      card.querySelectorAll('[data-stab]').forEach((t) => {
        t.onclick = () => {
          card.querySelectorAll('[data-stab]').forEach((x) => x.classList.remove('active'));
          t.classList.add('active');
          if (t.dataset.stab === 'updates') renderUpdates();
          else renderProfile();
        };
      });

      renderProfile();
    },
    true
  );
}
