import {
  api,
  discoverLanServers,
  getApkLocalIps,
  getSavedAccounts,
  getServerUrl,
  isApkMode,
  isApkUnconfigured,
  normalizeServerUrl,
  probeServerHealth,
  removeSavedAccount,
  saveRememberedAccount,
  saveServerUrl,
  setToken
} from '../api.js';
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
import { crownBadgeHtml } from '../plus.js';

let networkInfoCache = null;

const apkConnectUi = {
  expanded: false,
  scanning: false,
  error: '',
  discovered: []
};

const signupDraft = {
  step: 1,
  email: '',
  username: '',
  usernameAvailable: null,
  usernameMsg: '',
  password: '',
  confirmPassword: '',
  displayName: '',
  discriminator: String(Math.floor(1000 + Math.random() * 9000)),
  birthday: '',
  bio: '',
  statusText: '',
  recoveryHint: '',
  avatarType: 'svg',
  avatarUrl: '',
  avatarConfig: {
    bg: AVATAR_GRADIENTS[0],
    skin: SKIN_TONES[1],
    hair: 'short',
    eyes: 'happy',
    outfit: OUTFIT_COLORS[0],
    accent: '#FACC15',
    badge: '⚡'
  }
};

function calcPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}

function renderApkConnectHtml() {
  if (!isApkMode()) return '';
  const serverUrl = getServerUrl();
  const localIps = getApkLocalIps();
  const showPanel = !serverUrl || apkConnectUi.expanded;

  if (!showPanel) {
    return `
      <div class="apk-connect-panel connected">
        <div class="apk-connect-header">
          <span class="apk-connect-badge"><span class="apk-connect-dot"></span> Server: ${escapeHtml(serverUrl)}</span>
          <button type="button" class="btn btn-secondary btn-sm" id="apk-change-srv-btn">Switch</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="apk-connect-panel" id="apk-connect-panel">
      <div class="apk-connect-header">
        <span class="apk-connect-badge"><span class="apk-connect-dot"></span> ${serverUrl ? 'Switch VYRO Server' : 'Connect to Your VYRO Server'}</span>
        ${serverUrl ? '<button type="button" class="btn-ghost btn-sm" id="apk-hide-srv-btn">Done</button>' : ''}
      </div>
      <div class="field-hint" style="line-height:1.45;">
        Keep VYRO running on your PC (same Wi-Fi) and tap <strong>Scan Wi-Fi</strong>, or enter your PC / hosted VYRO server URL.
      </div>
      ${apkConnectUi.error ? `<div class="auth-error-banner" style="margin:0;">${escapeHtml(apkConnectUi.error)}</div>` : ''}
      ${
        apkConnectUi.discovered.length
          ? `<div class="apk-discovered-list">
              ${apkConnectUi.discovered
                .map(
                  (srv) => `<button type="button" class="apk-server-chip" data-pick-server="${escapeHtml(srv.url)}">⚡ ${escapeHtml(srv.host)}:${escapeHtml(srv.port)}${srv.version ? ` (v${escapeHtml(srv.version)})` : ''}</button>`
                )
                .join('')}
            </div>`
          : ''
      }
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input class="input-control" id="apk-server-input" style="flex:1;min-width:170px;padding:8px 10px;font-size:12.5px;" placeholder="192.168.0.x:3847 or https://..." value="${escapeHtml(serverUrl)}" />
        <button type="button" class="btn btn-primary btn-sm" id="apk-connect-btn">Connect</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" id="apk-scan-btn" ${apkConnectUi.scanning ? 'disabled' : ''}>
          ${apkConnectUi.scanning ? 'Scanning Wi-Fi...' : '🔍 Scan Wi-Fi for PC'}
        </button>
        ${localIps.length ? `<span class="field-hint">Wi-Fi IP: ${escapeHtml(localIps[0])}</span>` : ''}
      </div>
    </div>
  `;
}

function refreshApkConnectSlot(container, onSignedIn) {
  const slot = container?.querySelector('#apk-connect-slot');
  if (!slot) return;
  slot.innerHTML = renderApkConnectHtml();
  wireApkConnectHandlers(container, onSignedIn);
}

function wireApkConnectHandlers(container, onSignedIn) {
  if (!isApkMode()) return;
  const slot = container?.querySelector('#apk-connect-slot');
  if (!slot) return;

  slot.querySelector('#apk-change-srv-btn')?.addEventListener('click', () => {
    apkConnectUi.expanded = true;
    apkConnectUi.error = '';
    refreshApkConnectSlot(container, onSignedIn);
  });

  slot.querySelector('#apk-hide-srv-btn')?.addEventListener('click', () => {
    apkConnectUi.expanded = false;
    apkConnectUi.error = '';
    refreshApkConnectSlot(container, onSignedIn);
  });

  const connectToUrl = async (raw) => {
    const check = normalizeServerUrl(raw);
    if (!check.valid || !check.url) {
      apkConnectUi.error = 'Enter a valid server address (e.g. 192.168.0.10:3847 or https://your-vyro.onrender.com).';
      refreshApkConnectSlot(container, onSignedIn);
      return;
    }
    const btn = slot.querySelector('#apk-connect-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Connecting...';
    }
    const probe = await probeServerHealth(check.url, 3000);
    if (!probe.ok) {
      apkConnectUi.error = probe.error;
      refreshApkConnectSlot(container, onSignedIn);
      return;
    }
    await saveServerUrl(probe.url);
    apkConnectUi.expanded = false;
    apkConnectUi.error = '';
    toast(`Connected to VYRO at ${probe.url}`, 'success');
    refreshApkConnectSlot(container, onSignedIn);
  };

  slot.querySelector('#apk-connect-btn')?.addEventListener('click', () => {
    const val = slot.querySelector('#apk-server-input')?.value || '';
    connectToUrl(val);
  });

  slot.querySelectorAll('[data-pick-server]').forEach((chip) => {
    chip.addEventListener('click', () => connectToUrl(chip.dataset.pickServer));
  });

  slot.querySelector('#apk-scan-btn')?.addEventListener('click', async () => {
    apkConnectUi.scanning = true;
    apkConnectUi.error = '';
    refreshApkConnectSlot(container, onSignedIn);
    const res = await discoverLanServers();
    apkConnectUi.scanning = false;
    apkConnectUi.discovered = res.found || [];
    if (apkConnectUi.discovered.length === 1) {
      await saveServerUrl(apkConnectUi.discovered[0].url);
      apkConnectUi.expanded = false;
      toast(`Found & connected to ${apkConnectUi.discovered[0].url}`, 'success');
    } else if (apkConnectUi.discovered.length > 1) {
      apkConnectUi.error = '';
      toast(`Found ${apkConnectUi.discovered.length} VYRO servers — tap one to connect.`, 'info');
    } else {
      apkConnectUi.error = 'No VYRO server found on Wi-Fi. Open VYRO on your PC (same Wi-Fi) or enter your server URL above.';
    }
    refreshApkConnectSlot(container, onSignedIn);
  });
}

function handleServerConnectionError(err, showErr, rootContainer, onSignedIn) {
  const msg = err?.message || 'Could not reach VYRO server.';
  showErr(msg);
  if (isApkMode() && (err?.code === 'NO_SERVER_CONFIGURED' || err?.code === 'SERVER_UNREACHABLE' || err?.status === 404)) {
    apkConnectUi.expanded = true;
    apkConnectUi.error = msg;
    refreshApkConnectSlot(rootContainer, onSignedIn);
    const input = rootContainer?.querySelector('#apk-server-input');
    input?.focus();
    toast(msg, 'error');
    return true;
  }
  return false;
}

export async function mountAuthPortal(container, onSignedIn) {
  const tab = state.authTab || 'login';


  if (tab === 'download') {
    renderDownloadView(container);
    return;
  }

  container.innerHTML = `
    <div class="auth-page">
      <header class="auth-topbar">
        <div class="auth-brand" id="auth-logo-home">
          <img src="/assets/icon-192.png" alt="VYRO" />
          <div class="auth-brand-title">VYRO</div>
        </div>
        <div class="auth-nav-actions">
          <button class="btn btn-ghost btn-sm" id="nav-login-btn">Log in</button>
          <button class="btn btn-ghost btn-sm" id="nav-signup-btn">Sign up</button>
          <button class="btn btn-secondary btn-sm" id="nav-download-btn">${ICONS.download} Download</button>
          ${
            window.vyroDesktop
              ? `<div class="tb-win-group">
                  <button class="tb-win-btn" id="auth-win-min" title="Minimize">${ICONS.winMin}</button>
                  <button class="tb-win-btn" id="auth-win-max" title="Maximize / Restore">${ICONS.winMax}</button>
                  <button class="tb-win-btn close" id="auth-win-close" title="Close">${ICONS.winClose}</button>
                </div>`
              : ''
          }
        </div>
      </header>

      <main class="auth-shell">
        <section class="auth-showcase">
          <h1 class="auth-headline">Where your group chat actually lives.</h1>
          <p class="auth-lead">
            Message your friends, send snaps that disappear, hang out in voice and go live.
            Free to use, with no ads.
          </p>

          <div class="moments" aria-hidden="true">
            <div class="moment m-chat">
              <div class="m-avatar" style="background:#E58FB4;">L</div>
              <div>
                <div class="m-name">Lexi</div>
                <div class="m-bubble">who's on tonight?</div>
              </div>
            </div>
            <div class="moment m-mine"><div class="m-bubble mine">give me 10 mins, finishing my edit</div></div>
            <div class="moment m-streak"><span class="m-streak-num">47</span><span>day streak with Jay 🔥</span></div>
            <div class="moment m-snap"><span class="m-snap-square"></span><div><strong>Jay sent a snap</strong><span>tap to view</span></div></div>
            <div class="moment m-live"><span class="live-pill">LIVE</span><div><strong>Kai is live</strong><span>lofi and chill, 23 watching</span></div></div>
            <div class="moment m-plus"><span class="m-plus-name">Moon</span>${crownBadgeHtml(16)}<span class="plus-label">OG</span></div>
          </div>

          <p class="auth-footnote">
            On Windows, Android and the web. VYRO+ is £1.99 a month if you want extra looks.
            Going live is for 18s and over.
          </p>
        </section>

        <section class="auth-card">
          <div id="apk-connect-slot">${renderApkConnectHtml()}</div>
          <div class="auth-tabs">
            <button class="auth-tab ${tab === 'login' ? 'active' : ''}" data-auth-tab="login">Log in</button>
            <button class="auth-tab ${tab === 'signup' ? 'active' : ''}" data-auth-tab="signup">Create account</button>
          </div>
          <div id="auth-form-area"></div>

          ${
            !isApkMode()
              ? `<div class="server-node-footer">
                  <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted);gap:8px;flex-wrap:wrap;">
                    <span>Server: <strong style="color:var(--text-secondary);font-weight:500;">${escapeHtml(getServerUrl() || location.origin)}</strong></span>
                    <button type="button" class="btn-ghost btn-sm" id="toggle-server-node">Change</button>
                  </div>
                  <div id="server-node-editor" class="hidden" style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
                    <input class="input-control" id="custom-server-input" placeholder="192.168.0.x:3847 or https://... (blank = local)" value="${escapeHtml(getServerUrl())}" style="flex:1;min-width:160px;padding:8px 10px;font-size:12.5px;" />
                    <button type="button" class="btn btn-secondary btn-sm" id="save-server-btn">Connect</button>
                  </div>
                </div>`
              : ''
          }
        </section>
      </main>
    </div>
  `;

  container.querySelector('#auth-win-min')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.minimize(); });
  container.querySelector('#auth-win-max')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.maximize(); });
  container.querySelector('#auth-win-close')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.close(); });

  wireApkConnectHandlers(container, onSignedIn);

  container.querySelector('#auth-logo-home').onclick = () => {
    setState({ authTab: 'login' });
    location.hash = '#/login';
  };
  container.querySelector('#nav-login-btn').onclick = () => {
    setState({ authTab: 'login' });
    location.hash = '#/login';
  };
  container.querySelector('#nav-signup-btn').onclick = () => {
    setState({ authTab: 'signup' });
    location.hash = '#/signup';
  };
  container.querySelector('#nav-download-btn').onclick = () => {
    setState({ authTab: 'download' });
    location.hash = '#/download';
  };

  container.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.authTab;
      setState({ authTab: next });
      location.hash = `#/${next}`;
    };
  });

  const nodeEditor = container.querySelector('#server-node-editor');
  const toggleBtn = container.querySelector('#toggle-server-node');
  if (nodeEditor && toggleBtn) {
    toggleBtn.onclick = () => {
      nodeEditor.classList.toggle('hidden');
    };
  }
  const saveSrvBtn = container.querySelector('#save-server-btn');
  if (saveSrvBtn) {
    saveSrvBtn.onclick = async () => {
      const val = container.querySelector('#custom-server-input').value.trim();
      if (!val) {
        await saveServerUrl('');
        toast('Using local VYRO server', 'success');
        mountAuthPortal(container, onSignedIn);
        return;
      }
      const check = normalizeServerUrl(val);
      if (!check.valid || !check.url) {
        toast('Invalid server URL. Example: 192.168.0.10:3847 or https://vyro.onrender.com', 'error');
        return;
      }
      saveSrvBtn.disabled = true;
      saveSrvBtn.textContent = 'Checking...';
      const probe = await probeServerHealth(check.url, 3000);
      if (!probe.ok) {
        saveSrvBtn.disabled = false;
        saveSrvBtn.textContent = 'Connect';
        toast(probe.error, 'error');
        return;
      }
      await saveServerUrl(probe.url);
      toast(`Switched server to ${probe.url}`, 'success');
      mountAuthPortal(container, onSignedIn);
    };
  }

  const area = container.querySelector('#auth-form-area');
  if (tab === 'signup') renderSignupArea(area, container, onSignedIn);
  else if (tab === 'reset') renderResetArea(area, container, onSignedIn);
  else renderLoginArea(area, container, onSignedIn);
}

async function loadNearbyAccounts(area, root, onSignedIn) {
  const slot = area.querySelector('#nearby-accounts-slot');
  if (!slot) return;
  if (isApkUnconfigured()) return;
  try {
    const res = await api('/api/auth/nearby-accounts');
    const users = res.users || [];
    if (!users.length) return;

    const savedIds = new Set(getSavedAccounts().map((a) => a.id));
    const nearby = users.filter((u) => !savedIds.has(u.id));
    if (!nearby.length) return;

    slot.innerHTML = `
      <div class="nearby-accounts-box">
        <div class="nearby-accounts-title">👥 Accounts on This Server</div>
        <div class="nearby-accounts-hint">Tap an account to pre-fill your username, then enter your password.</div>
        <div class="demo-users-grid">
          ${nearby
            .map(
              (u) => `
            <button type="button" class="demo-user-btn nearby-acct-btn" data-nearby-name="${escapeHtml(u.username)}" data-nearby-disc="${escapeHtml(u.discriminator || '0000')}">
              ${renderAvatarHtml(u, 34, false)}
              <span>${escapeHtml(u.displayName || u.username)}</span>
              <span class="tag">#${escapeHtml(u.discriminator || '0000')}</span>
              ${u.presence === 'online' ? '<span class="nearby-online-dot"></span>' : ''}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    slot.querySelectorAll('.nearby-acct-btn').forEach((btn) => {
      btn.onclick = () => {
        const uname = btn.dataset.nearbyName;
        const disc = btn.dataset.nearbyDisc;
        const idInput = area.querySelector('#login-id');
        if (idInput) {
          idInput.value = `${uname}#${disc}`;
        }
        area.querySelector('#login-pw')?.focus();
        toast(`Selected ${uname}#${disc} — enter your password to log in.`, 'info');
      };
    });
  } catch {
    // Server unreachable or not configured — silently skip
  }
}

function renderSavedAccountsSection() {
  const saved = getSavedAccounts();
  if (!saved.length) return '';
  return `
    <div class="demo-accounts-box" style="margin-top:16px;">
      <div class="demo-accounts-title">Saved Accounts on This Device</div>
      <div class="demo-users-grid">
        ${saved
          .map(
            (u) => `
          <div style="position:relative;">
            <button type="button" class="demo-user-btn saved-acct-btn" data-saved-id="${escapeHtml(u.id)}" style="width:100%;">
              ${renderAvatarHtml(u, 34, false)}
              <span>${escapeHtml(u.displayName || u.username)}</span>
              <span class="tag">#${escapeHtml(u.discriminator || '0000')}</span>
            </button>
            <button type="button" data-remove-saved="${escapeHtml(u.id)}" title="Remove from device" style="position:absolute;top:4px;right:6px;font-size:11px;color:var(--text-muted);">✕</button>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderLoginArea(area, root, onSignedIn) {
  area.innerHTML = `
    <div class="auth-card-title">Welcome back</div>
    <div class="auth-card-sub">Log in with your username or email.</div>
    <div id="login-error" class="auth-error-banner hidden"></div>
    <form id="login-form" class="form-grid">
      <div class="field">
        <label>Username or email</label>
        <input class="input-control" id="login-id" placeholder="e.g. moon or you@example.com" autocomplete="username" required />
      </div>
      <div class="field">
        <label>
          <span>Password</span>
          <button type="button" id="goto-reset-btn" class="text-link">Forgot password?</button>
        </label>
        <div class="input-wrap">
          <input class="input-control input-with-btn" id="login-pw" type="password" placeholder="••••••••" autocomplete="current-password" required />
          <button type="button" class="input-eye-btn" id="toggle-login-pw">Show</button>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
        <input type="checkbox" id="login-remember" checked /> Keep me logged in
      </label>
      <button type="submit" class="btn btn-primary" id="login-submit-btn">Log in</button>
    </form>

    ${renderSavedAccountsSection()}

    <div id="nearby-accounts-slot"></div>
  `;

  loadNearbyAccounts(area, root, onSignedIn);

  area.querySelectorAll('.saved-acct-btn').forEach((btn) => {
    btn.onclick = async () => {
      const saved = getSavedAccounts().find((a) => a.id === btn.dataset.savedId);
      if (!saved) return;
      if (saved.token) {
        try {
          setToken(saved.token);
          const me = await api('/api/auth/me');
          saveRememberedAccount(me.user, saved.token);
          toast(`Welcome back, ${me.user.displayName}#${me.user.discriminator}!`, 'success');
          onSignedIn(me.user);
          return;
        } catch {
          setToken('');
        }
      }
      area.querySelector('#login-id').value = saved.email || `${saved.username}#${saved.discriminator}`;
      area.querySelector('#login-pw').focus();
      toast('Enter your password to sign back in.', 'info');
    };
  });

  area.querySelectorAll('[data-remove-saved]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      removeSavedAccount(btn.dataset.removeSaved);
      renderLoginArea(area, root, onSignedIn);
    };
  });

  const pwInput = area.querySelector('#login-pw');
  const eyeBtn = area.querySelector('#toggle-login-pw');
  eyeBtn.onclick = () => {
    const isPw = pwInput.type === 'password';
    pwInput.type = isPw ? 'text' : 'password';
    eyeBtn.textContent = isPw ? 'Hide' : 'Show';
  };

  area.querySelector('#goto-reset-btn').onclick = () => {
    setState({ authTab: 'reset' });
    renderResetArea(area, root, onSignedIn);
  };

  area.querySelector('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = area.querySelector('#login-error');
    const btn = area.querySelector('#login-submit-btn');
    errEl.classList.add('hidden');
    if (isApkUnconfigured()) {
      handleServerConnectionError(
        { code: 'NO_SERVER_CONFIGURED', message: 'Connect to a VYRO server above first (tap Scan Wi-Fi or enter your server URL).' },
        (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); },
        root,
        onSignedIn
      );
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: area.querySelector('#login-id').value.trim(),
          password: pwInput.value,
          remember: area.querySelector('#login-remember').checked
        }
      });
      setToken(res.token);
      if (area.querySelector('#login-remember').checked) {
        saveRememberedAccount(res.user, res.token);
      }
      toast(`Welcome back, ${res.user.displayName}!`, 'success');
      onSignedIn(res.user);
    } catch (err) {
      handleServerConnectionError(
        err,
        (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); },
        root,
        onSignedIn
      );
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  };
}

function renderResetArea(area, root, onSignedIn) {
  area.innerHTML = `
    <div class="auth-card-title">Reset your password</div>
    <div class="auth-card-sub">You'll need the recovery phrase you chose when you signed up.</div>
    <div id="reset-msg" class="auth-error-banner hidden"></div>
    <form id="reset-form" class="form-grid">
      <div class="field">
        <label>Username or email</label>
        <input class="input-control" id="reset-id" required placeholder="yourname or you@example.com" />
      </div>
      <div class="field">
        <label>Recovery phrase</label>
        <input class="input-control" id="reset-hint" required placeholder="Your recovery phrase" />
      </div>
      <div class="field">
        <label>New password</label>
        <input class="input-control" id="reset-pw" type="password" minlength="6" required placeholder="6+ characters" />
      </div>
      <div style="display:flex;gap:10px;">
        <button type="button" class="btn btn-secondary" id="back-to-login">Back</button>
        <button type="submit" class="btn btn-primary" style="flex:1;">Update Password</button>
      </div>
    </form>
  `;

  area.querySelector('#back-to-login').onclick = () => {
    setState({ authTab: 'login' });
    location.hash = '#/login';
  };

  area.querySelector('#reset-form').onsubmit = async (e) => {
    e.preventDefault();
    const msg = area.querySelector('#reset-msg');
    if (isApkUnconfigured()) {
      handleServerConnectionError(
        { code: 'NO_SERVER_CONFIGURED', message: 'Connect to a VYRO server above first (tap Scan Wi-Fi or enter your server URL).' },
        (m) => { msg.className = 'auth-error-banner'; msg.textContent = m; msg.classList.remove('hidden'); },
        root,
        onSignedIn
      );
      return;
    }
    try {
      const res = await api('/api/auth/reset-password', {
        method: 'POST',
        body: {
          identifier: area.querySelector('#reset-id').value.trim(),
          recoveryHint: area.querySelector('#reset-hint').value.trim(),
          newPassword: area.querySelector('#reset-pw').value
        }
      });
      msg.className = 'auth-success-banner';
      msg.textContent = res.message;
      msg.classList.remove('hidden');
      toast('Password updated! Log in now.', 'success');
    } catch (err) {
      msg.className = 'auth-error-banner';
      handleServerConnectionError(
        err,
        (m) => { msg.textContent = m; msg.classList.remove('hidden'); },
        root,
        onSignedIn
      );
    }
  };
}

function renderSignupArea(area, root, onSignedIn) {
  const s = signupDraft.step;
  const strength = calcPasswordStrength(signupDraft.password);
  const strengthLabels = ['Too short', 'Weak', 'Fair', 'Strong', 'Cyber-proof'];

  area.innerHTML = `
    <div class="auth-card-title">Create your account</div>
    <div class="auth-card-sub">Three quick steps and you're in.</div>

    <div class="signup-steps">
      <div class="signup-step-pill ${s === 1 ? 'active' : s > 1 ? 'done' : ''}">Account</div>
      <div class="signup-step-pill ${s === 2 ? 'active' : s > 2 ? 'done' : ''}">About you</div>
      <div class="signup-step-pill ${s === 3 ? 'active' : ''}">Avatar</div>
    </div>

    <div id="signup-error" class="auth-error-banner hidden"></div>
    <div id="signup-step-body"></div>
  `;

  const stepBody = area.querySelector('#signup-step-body');
  const errBox = area.querySelector('#signup-error');
  const showErr = (msg) => {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  };

  if (s === 1) {
    stepBody.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Email</label>
          <input class="input-control" id="su-email" type="email" value="${escapeHtml(signupDraft.email)}" placeholder="you@domain.com" required />
        </div>
        <div class="field">
          <label>
            <span>Username</span>
            <span id="su-uname-status" class="field-hint ${signupDraft.usernameAvailable === true ? 'ok' : signupDraft.usernameAvailable === false ? 'err' : ''}">${escapeHtml(signupDraft.usernameMsg)}</span>
          </label>
          <input class="input-control" id="su-username" value="${escapeHtml(signupDraft.username)}" placeholder="e.g. shadow_fox" maxlength="20" required />
        </div>
        <div class="field">
          <label>
            <span>Password</span>
            <span id="su-pw-label" class="field-hint">${strengthLabels[strength]}</span>
          </label>
          <div class="input-wrap">
            <input class="input-control input-with-btn" id="su-pw" type="password" value="${escapeHtml(signupDraft.password)}" placeholder="Min 6 characters" />
            <button type="button" class="input-eye-btn" id="su-eye">Show</button>
          </div>
          <div class="strength-bars" id="su-strength-bars">
            ${[1, 2, 3, 4].map((i) => `<div class="strength-bar ${strength >= i ? `s${strength}` : ''}"></div>`).join('')}
          </div>
        </div>
        <div class="field">
          <label>Confirm password</label>
          <input class="input-control" id="su-pw2" type="password" value="${escapeHtml(signupDraft.confirmPassword)}" placeholder="Repeat password" />
        </div>
        <button type="button" class="btn btn-primary" id="su-next-1">Next</button>
      </div>
    `;

    let debounceTimer = null;
    const unameInput = stepBody.querySelector('#su-username');
    const statusEl = stepBody.querySelector('#su-uname-status');
    unameInput.oninput = () => {
      const val = unameInput.value.trim();
      signupDraft.username = val;
      clearTimeout(debounceTimer);
      if (!val) {
        statusEl.textContent = '';
        return;
      }
      if (isApkUnconfigured()) {
        statusEl.textContent = 'Connect server above first';
        statusEl.className = 'field-hint err';
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const check = await api(`/api/auth/check-username?username=${encodeURIComponent(val)}`);
          signupDraft.usernameAvailable = check.available;
          signupDraft.usernameMsg = check.reason;
          statusEl.textContent = check.available ? '✓ Available' : check.reason;
          statusEl.className = `field-hint ${check.available ? 'ok' : 'err'}`;
        } catch (err) {
          if (err?.code === 'NO_SERVER_CONFIGURED' || err?.code === 'SERVER_UNREACHABLE') {
            statusEl.textContent = 'Server offline';
            statusEl.className = 'field-hint err';
          }
        }
      }, 240);
    };

    const emailInput = stepBody.querySelector('#su-email');
    emailInput.oninput = () => {
      signupDraft.email = emailInput.value.trim();
    };

    const pwEl = stepBody.querySelector('#su-pw');
    const pw2El = stepBody.querySelector('#su-pw2');
    pw2El.oninput = () => {
      signupDraft.confirmPassword = pw2El.value;
    };
    stepBody.querySelector('#su-eye').onclick = () => {
      const show = pwEl.type === 'password';
      pwEl.type = show ? 'text' : 'password';
      pw2El.type = show ? 'text' : 'password';
      stepBody.querySelector('#su-eye').textContent = show ? 'Hide' : 'Show';
    };

    pwEl.oninput = () => {
      signupDraft.password = pwEl.value;
      const st = calcPasswordStrength(pwEl.value);
      stepBody.querySelector('#su-pw-label').textContent = strengthLabels[st];
      stepBody.querySelector('#su-strength-bars').innerHTML = [1, 2, 3, 4]
        .map((i) => `<div class="strength-bar ${st >= i ? `s${st}` : ''}"></div>`)
        .join('');
    };

    stepBody.querySelector('#su-next-1').onclick = async () => {
      signupDraft.email = stepBody.querySelector('#su-email').value.trim();
      signupDraft.username = unameInput.value.trim();
      signupDraft.password = pwEl.value;
      signupDraft.confirmPassword = pw2El.value;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupDraft.email)) return showErr('Enter a valid email address.');
      if (signupDraft.username.length < 3) return showErr('Username must be at least 3 characters.');
      if (signupDraft.password.length < 6) return showErr('Password must be at least 6 characters.');
      if (signupDraft.password !== signupDraft.confirmPassword) return showErr('Passwords do not match.');

      if (isApkUnconfigured()) {
        handleServerConnectionError(
          { code: 'NO_SERVER_CONFIGURED', message: 'Connect to a VYRO server above first (tap Scan Wi-Fi or enter your server URL).' },
          showErr,
          root,
          onSignedIn
        );
        return;
      }

      try {
        const check = await api(`/api/auth/check-username?username=${encodeURIComponent(signupDraft.username)}`);
        if (!check.available) return showErr(check.reason);
      } catch (err) {
        if (err?.code === 'NO_SERVER_CONFIGURED' || err?.code === 'SERVER_UNREACHABLE' || err?.status === 404) {
          handleServerConnectionError(err, showErr, root, onSignedIn);
          return;
        }
      }

      if (!signupDraft.displayName) signupDraft.displayName = signupDraft.username;
      signupDraft.step = 2;
      renderSignupArea(area, root, onSignedIn);
    };
    return;
  }

  if (s === 2) {
    stepBody.innerHTML = `
      <div class="form-grid">
        <div class="form-row-2">
          <div class="field">
            <label>Display name</label>
            <input class="input-control" id="su-display" value="${escapeHtml(signupDraft.displayName)}" placeholder="How friends see you" maxlength="32" />
          </div>
          <div class="field">
            <label>
              <span>#Tag</span>
              <button type="button" id="su-rand-tag" style="font-size:11px;color:var(--vyro-gold);font-weight:700;">🎲 Random</button>
            </label>
            <input class="input-control" id="su-disc" value="${escapeHtml(signupDraft.discriminator)}" maxlength="4" style="font-family:var(--font-mono);" />
          </div>
        </div>
        <div class="form-row-2">
          <div class="field">
            <label>Date of birth</label>
            <input class="input-control" id="su-bday" type="date" required max="${new Date().toISOString().slice(0, 10)}" value="${escapeHtml(signupDraft.birthday)}" />
            <span class="field-hint">You need to be 13 or over. Going live is for 18 and over.</span>
          </div>
          <div class="field">
            <label>Recovery phrase</label>
            <input class="input-control" id="su-rec" required minlength="4" value="${escapeHtml(signupDraft.recoveryHint)}" placeholder="Secret phrase to reset your password" />
            <span class="field-hint">Write it down. You need it if you forget your password.</span>
          </div>
        </div>
        <div class="field">
          <label>Status</label>
          <input class="input-control" id="su-status" value="${escapeHtml(signupDraft.statusText)}" placeholder="e.g. Dropping snaps 📸" maxlength="80" />
        </div>
        <div class="field">
          <label>Bio (optional)</label>
          <input class="input-control" id="su-bio" value="${escapeHtml(signupDraft.bio)}" placeholder="A line about you" maxlength="180" />
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" class="btn btn-secondary" id="su-back-2">Back</button>
          <button type="button" class="btn btn-primary" id="su-next-2" style="flex:1;">Next</button>
        </div>
      </div>
    `;

    stepBody.querySelector('#su-rand-tag').onclick = () => {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      signupDraft.discriminator = code;
      stepBody.querySelector('#su-disc').value = code;
    };

    stepBody.querySelector('#su-back-2').onclick = () => {
      signupDraft.step = 1;
      renderSignupArea(area, root, onSignedIn);
    };

    stepBody.querySelector('#su-next-2').onclick = () => {
      signupDraft.displayName = stepBody.querySelector('#su-display').value.trim() || signupDraft.username;
      signupDraft.discriminator = stepBody.querySelector('#su-disc').value.replace(/\D/g, '').slice(0, 4).padStart(4, '0');
      signupDraft.birthday = stepBody.querySelector('#su-bday').value;
      signupDraft.recoveryHint = stepBody.querySelector('#su-rec').value.trim();
      signupDraft.statusText = stepBody.querySelector('#su-status').value.trim();
      signupDraft.bio = stepBody.querySelector('#su-bio').value.trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(signupDraft.birthday)) {
        return showErr('Enter your date of birth.');
      }
      {
        const [by, bm, bd] = signupDraft.birthday.split('-').map(Number);
        const now = new Date();
        let age = now.getFullYear() - by;
        if (now.getMonth() + 1 < bm || (now.getMonth() + 1 === bm && now.getDate() < bd)) age -= 1;
        if (age < 13) return showErr('You must be at least 13 years old to sign up.');
        if (age > 120) return showErr('Please enter your real date of birth.');
      }
      if (signupDraft.recoveryHint.length < 4) {
        return showErr('Choose a recovery phrase of at least 4 characters.');
      }
      signupDraft.step = 3;
      renderSignupArea(area, root, onSignedIn);
    };
    return;
  }

  // Step 3: Avatar Studio + Launch
  const cfg = signupDraft.avatarConfig;
  const renderPreview = () => {
    if (signupDraft.avatarType === 'image' && signupDraft.avatarUrl) {
      return `<img src="${escapeHtml(signupDraft.avatarUrl)}" style="width:92px;height:92px;border-radius:50%;object-fit:cover;object-position:center center;border:3px solid var(--vyro-gold);" />`;
    }
    return `<div style="width:92px;height:92px;border-radius:50%;overflow:hidden;border:3px solid var(--vyro-gold);background:${escapeHtml(cfg.bg)};">${renderBitmojiSvg(cfg)}</div>`;
  };

  stepBody.innerHTML = `
    <div class="form-grid">
      <div class="avatar-builder-box">
        <div class="avatar-preview-stage">
          <div id="su-av-preview">${renderPreview()}</div>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;font-size:11px;">
            Upload Photo
            <input type="file" id="su-av-file" accept="image/*" class="hidden" />
          </label>
          ${signupDraft.avatarType === 'image' && signupDraft.avatarUrl ? '<button type="button" class="btn btn-secondary btn-sm" id="su-av-adjust" style="font-size:11px;">Adjust Fit</button>' : ''}
          ${signupDraft.avatarType === 'image' ? '<button type="button" class="btn-ghost btn-sm" id="su-av-reset" style="font-size:11px;">Use Bitmoji SVG</button>' : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <div class="field-hint" style="margin-bottom:5px;">Skin / Glow</div>
            <div class="swatch-row">
              ${SKIN_TONES.map((t) => `<button type="button" class="swatch-btn ${cfg.skin === t ? 'active' : ''}" data-skin="${t}" style="background:${t};"></button>`).join('')}
            </div>
          </div>
          <div>
            <div class="field-hint" style="margin-bottom:5px;">Outfit Color</div>
            <div class="swatch-row">
              ${OUTFIT_COLORS.map((c) => `<button type="button" class="swatch-btn ${cfg.outfit === c ? 'active' : ''}" data-outfit="${c}" style="background:${c};"></button>`).join('')}
            </div>
          </div>
          <div>
            <div class="field-hint" style="margin-bottom:5px;">Hair / Hat</div>
            <div class="chip-row">
              ${HAIR_STYLES.map((h) => `<button type="button" class="chip-option ${cfg.hair === h ? 'active' : ''}" data-hair="${h}">${h}</button>`).join('')}
            </div>
          </div>
          <div>
            <div class="field-hint" style="margin-bottom:5px;">Vibe / Eyes</div>
            <div class="chip-row">
              ${EYE_STYLES.map((ey) => `<button type="button" class="chip-option ${cfg.eyes === ey ? 'active' : ''}" data-eyes="${ey}">${ey}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;">
        <button type="button" class="btn btn-secondary" id="su-back-3">Back</button>
        <button type="button" class="btn btn-primary" id="su-finish" style="flex:1;">Create account</button>
      </div>
    </div>
  `;

  const refreshStep3 = () => renderSignupArea(area, root, onSignedIn);

  stepBody.querySelectorAll('[data-skin]').forEach((b) => {
    b.onclick = () => {
      signupDraft.avatarType = 'svg';
      cfg.skin = b.dataset.skin;
      refreshStep3();
    };
  });
  stepBody.querySelectorAll('[data-outfit]').forEach((b) => {
    b.onclick = () => {
      signupDraft.avatarType = 'svg';
      cfg.outfit = b.dataset.outfit;
      refreshStep3();
    };
  });
  stepBody.querySelectorAll('[data-hair]').forEach((b) => {
    b.onclick = () => {
      signupDraft.avatarType = 'svg';
      cfg.hair = b.dataset.hair;
      refreshStep3();
    };
  });
  stepBody.querySelectorAll('[data-eyes]').forEach((b) => {
    b.onclick = () => {
      signupDraft.avatarType = 'svg';
      cfg.eyes = b.dataset.eyes;
      refreshStep3();
    };
  });

  const fileInput = stepBody.querySelector('#su-av-file');
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    openAvatarCropperModal(f, {
      title: 'Frame Your Profile Pic',
      onConfirm: (dataUrl) => {
        signupDraft.avatarType = 'image';
        signupDraft.avatarUrl = dataUrl;
        refreshStep3();
      },
      onError: () => toast('Could not load photo', 'error')
    });
  };

  const adjustBtn = stepBody.querySelector('#su-av-adjust');
  if (adjustBtn && signupDraft.avatarUrl) {
    adjustBtn.onclick = () => {
      openAvatarCropperModal(signupDraft.avatarUrl, {
        title: 'Adjust Profile Pic Fit',
        onConfirm: (dataUrl) => {
          signupDraft.avatarType = 'image';
          signupDraft.avatarUrl = dataUrl;
          refreshStep3();
        },
        onError: () => toast('Could not adjust photo', 'error')
      });
    };
  }

  const resetBtn = stepBody.querySelector('#su-av-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      signupDraft.avatarType = 'svg';
      signupDraft.avatarUrl = '';
      refreshStep3();
    };
  }

  stepBody.querySelector('#su-back-3').onclick = () => {
    signupDraft.step = 2;
    refreshStep3();
  };

  stepBody.querySelector('#su-finish').onclick = async () => {
    if (isApkUnconfigured()) {
      handleServerConnectionError(
        { code: 'NO_SERVER_CONFIGURED', message: 'Connect to a VYRO server above first (tap Scan Wi-Fi or enter your server URL).' },
        showErr,
        root,
        onSignedIn
      );
      return;
    }
    const btn = stepBody.querySelector('#su-finish');
    btn.disabled = true;
    btn.textContent = 'Creating your account…';
    try {
      const res = await api('/api/auth/signup', {
        method: 'POST',
        body: {
          email: signupDraft.email,
          username: signupDraft.username,
          password: signupDraft.password,
          displayName: signupDraft.displayName,
          discriminator: signupDraft.discriminator,
          birthday: signupDraft.birthday,
          bio: signupDraft.bio,
          statusText: signupDraft.statusText,
          recoveryHint: signupDraft.recoveryHint,
          avatarType: signupDraft.avatarType,
          avatarUrl: signupDraft.avatarUrl,
          avatarConfig: signupDraft.avatarConfig
        }
      });
      setToken(res.token);
      saveRememberedAccount(res.user, res.token);
      toast(`Account created & saved! Welcome, ${res.user.displayName}#${res.user.discriminator}!`, 'success');
      signupDraft.step = 1;
      onSignedIn(res.user);
    } catch (err) {
      handleServerConnectionError(err, showErr, root, onSignedIn);
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  };
}

async function renderDownloadView(container) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-aurora-bg"></div>
      <header class="auth-topbar">
        <div class="auth-brand" id="dl-back-home">
          <img src="/assets/icon-192.png" alt="VYRO" />
          <div>
            <div class="auth-brand-title">VYRO</div>
            <div class="auth-brand-sub">Desktop &amp; Mobile Releases</div>
          </div>
        </div>
        <div class="auth-nav-actions">
          <button class="btn btn-secondary btn-sm" id="dl-login-btn">Log In</button>
          <button class="btn btn-primary btn-sm" id="dl-signup-btn">Sign up</button>
          ${
            window.vyroDesktop
              ? `<div class="tb-win-group">
                  <button class="tb-win-btn" id="dl-win-min" title="Minimize">${ICONS.winMin}</button>
                  <button class="tb-win-btn" id="dl-win-max" title="Maximize / Restore">${ICONS.winMax}</button>
                  <button class="tb-win-btn close" id="dl-win-close" title="Close">${ICONS.winClose}</button>
                </div>`
              : ''
          }
        </div>
      </header>
      <div class="download-page-wrap">
        <h1 class="auth-headline">Get VYRO on your computer and phone.</h1>
        <p class="auth-lead" style="margin-top:8px;">
          Download the Windows app or the Android app. On iPhone, scan the QR code to use VYRO in your browser.
        </p>

        <div class="download-cards" id="dl-cards-root">
          <div class="download-card">
            <h3>Windows</h3>
            <p style="color:var(--text-secondary);font-size:13.5px;">Checking for the latest version…</p>
          </div>
          <div class="download-card">
            <h3>Phone</h3>
            <p style="color:var(--text-secondary);font-size:13.5px;">Getting your QR code ready…</p>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#dl-win-min')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.minimize(); });
  container.querySelector('#dl-win-max')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.maximize(); });
  container.querySelector('#dl-win-close')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.close(); });

  container.querySelector('#dl-back-home').onclick = () => {
    setState({ authTab: 'login' });
    location.hash = '#/login';
  };
  container.querySelector('#dl-login-btn').onclick = () => {
    setState({ authTab: 'login' });
    location.hash = '#/login';
  };
  container.querySelector('#dl-signup-btn').onclick = () => {
    setState({ authTab: 'signup' });
    location.hash = '#/signup';
  };

  try {
    let net;
    let upd;
    if (isApkUnconfigured()) {
      net = {
        version: '1.2.0',
        lanUrls: [],
        githubOwner: 'moongames0101-cmyk',
        githubRepo: 'vyro',
        localExes: [],
        localApks: []
      };
      try {
        const ghRes = await fetch('https://api.github.com/repos/moongames0101-cmyk/vyro/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' }
        });
        const rel = ghRes.ok ? await ghRes.json() : null;
        upd = {
          releasesPage: rel?.html_url || 'https://github.com/moongames0101-cmyk/vyro/releases',
          exeAssets: (rel?.assets || [])
            .filter((a) => a.name.toLowerCase().endsWith('.exe'))
            .map((a) => ({ name: a.name, downloadUrl: a.browser_download_url })),
          apkAssets: (rel?.assets || [])
            .filter((a) => a.name.toLowerCase().endsWith('.apk'))
            .map((a) => ({ name: a.name, downloadUrl: a.browser_download_url })),
          message: 'Connect to your PC VYRO server or download latest releases from GitHub.'
        };
      } catch {
        upd = {
          releasesPage: 'https://github.com/moongames0101-cmyk/vyro/releases',
          exeAssets: [],
          apkAssets: [],
          message: 'Ready for GitHub Releases distribution.'
        };
      }
    } else {
      [net, upd] = await Promise.all([api('/api/network-info'), api('/api/updates/check')]);
    }
    networkInfoCache = { net, upd };
    const cards = container.querySelector('#dl-cards-root');
    const mobileUrl = net.lanUrls?.[0]?.url || location.origin;
    const formatExeLabel = (name) =>
      name.toLowerCase().includes('portable') ? 'No-install version' : 'Download for Windows';
    const localExeSet = new Set(net.localExes || []);
    const localExeButtons = (net.localExes || [])
      .map((exe) => `<a class="btn ${exe.toLowerCase().includes('portable') ? 'btn-secondary' : 'btn-primary'}" href="/downloads/${encodeURIComponent(exe)}" download title="${escapeHtml(exe)}">${ICONS.download} ${formatExeLabel(exe)}</a>`)
      .join('');
    const ghExeButtons = (upd.exeAssets || [])
      .filter((a) => !localExeSet.has(a.name))
      .map((a) => `<a class="btn ${a.name.toLowerCase().includes('portable') ? 'btn-secondary' : 'btn-primary'}" href="${escapeHtml(a.downloadUrl)}" target="_blank" rel="noopener" title="${escapeHtml(a.name)}">${ICONS.download} ${formatExeLabel(a.name)}</a>`)
      .join('');

    const localApkSet = new Set(net.localApks || []);
    const localApkButtons = (net.localApks || [])
      .map((apk) => `<a class="btn btn-primary" href="/downloads/${encodeURIComponent(apk)}" download title="${escapeHtml(apk)}">${ICONS.download} Download for Android</a>`)
      .join('');
    const ghApkButtons = (upd.apkAssets || [])
      .filter((a) => !localApkSet.has(a.name))
      .map((a) => `<a class="btn btn-primary" href="${escapeHtml(a.downloadUrl)}" target="_blank" rel="noopener" title="${escapeHtml(a.name)}">${ICONS.download} Android APK (GitHub)</a>`)
      .join('');

    cards.innerHTML = `
      <div class="download-card">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="/assets/icon-192.png" width="44" height="44" style="border-radius:12px;" />
          <div>
            <h3>Windows</h3>
            <span class="field-hint">Version ${escapeHtml(net.version)}. Updates itself.</span>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">
          The full app, with notifications and a tray icon. New versions install themselves.
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${localExeButtons}
          ${ghExeButtons}
          <a class="btn btn-secondary" href="${escapeHtml(upd.releasesPage)}" target="_blank" rel="noopener">
            All versions on GitHub
          </a>
        </div>
        <div class="field-hint">${escapeHtml(upd.message || 'Ready for GitHub Releases distribution.')}</div>
      </div>

      <div class="download-card">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="/assets/icon-192.png" width="44" height="44" style="border-radius:12px;" />
          <div>
            <h3>Android</h3>
            <span class="field-hint">Works on Android 5 and newer.</span>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">
          Download the app file and open it on your phone. If asked, allow your browser to install apps.
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${localApkButtons || (!isApkMode() && !ghApkButtons ? `<a class="btn btn-primary" href="/downloads/VYRO.apk" download>${ICONS.download} Download for Android</a>` : '')}
          ${ghApkButtons}
          <a class="btn btn-secondary" href="https://github.com/${escapeHtml(net.githubOwner)}/${escapeHtml(net.githubRepo)}/releases" target="_blank" rel="noopener">
            All versions on GitHub
          </a>
        </div>
      </div>

      <div class="download-card">
        <div>
          <h3>iPhone and other phones</h3>
          <span class="field-hint">Scan this with your phone's camera.</span>
        </div>
        <div class="qr-card">${renderQrSvg(mobileUrl, 176)}</div>
        <div style="font-size:13px;text-align:center;color:var(--mauve);word-break:break-all;">
          ${escapeHtml(mobileUrl)}
        </div>
        ${state.deferredInstallPrompt ? `<button class="btn btn-primary" id="pwa-install-btn">Install VYRO on this device</button>` : ''}
        <p class="field-hint">
          On iPhone, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </p>
      </div>
    `;

    const installBtn = cards.querySelector('#pwa-install-btn');
    if (installBtn && state.deferredInstallPrompt) {
      installBtn.onclick = async () => {
        state.deferredInstallPrompt.prompt();
        await state.deferredInstallPrompt.userChoice;
        setState({ deferredInstallPrompt: null });
      };
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}
