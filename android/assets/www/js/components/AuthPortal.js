import { api, getSavedAccounts, getServerUrl, removeSavedAccount, saveRememberedAccount, setServerUrl, setToken } from '../api.js';
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

let networkInfoCache = null;

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
  birthday: '2003-04-15',
  bio: '',
  statusText: 'Vibing on VYRO ⚡',
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
          <div>
            <div class="auth-brand-title">VYRO</div>
          </div>
        </div>
        <div class="auth-nav-actions">
          <button class="btn btn-ghost btn-sm" id="nav-login-btn">Log In</button>
          <button class="btn btn-secondary btn-sm" id="nav-signup-btn">Sign Up</button>
          <button class="btn btn-primary btn-sm" id="nav-download-btn">${ICONS.download} Get .exe &amp; .apk</button>
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
          <div class="auth-eyebrow">⚡ Discord Servers × Snapchat Streaks</div>
          <h1 class="auth-headline">
            Your Squads, <span class="grad">Snaps &amp; Voice Lounges</span> in One Place.
          </h1>
          <p class="auth-lead">
            Build servers with persistent channels and live voice lounges, drop timed Snaps with filters, keep daily 🔥 streaks alive, and share 24h Stories across PC and Mobile.
          </p>

          <div class="showcase-preview">
            <div class="preview-stories-row">
              <div class="preview-story-pill">
                <div class="preview-story-ring">⚡</div>
                <span>24h Stories • Live</span>
              </div>
              <div class="preview-story-pill">
                <div class="preview-story-ring">📸</div>
                <span>Timed Flash Snaps</span>
              </div>
              <div class="preview-story-pill">
                <div class="preview-story-ring">🔥</div>
                <span>Squad Streaks</span>
              </div>
            </div>
            <div class="preview-cards-grid">
              <div class="preview-mini-card">
                <h4># Real-Time Servers</h4>
                <p>Text channels, ⚡ Flash Snap rooms, and 🔊 Voice stages with instant updates.</p>
              </div>
              <div class="preview-mini-card">
                <h4>👻 Timed Snaps &amp; Stories</h4>
                <p>Draw on canvas or live camera, set 5s–10s timers, Replay once, or Save in Chat.</p>
              </div>
            </div>
          </div>

          <div class="platform-badges">
            <span class="platform-chip">🪟 Windows .exe App</span>
            <span class="platform-chip">🤖 Android .apk App</span>
            <span class="platform-chip">📱 Mobile PWA &amp; QR Sync</span>
            <span class="platform-chip">🐙 GitHub Releases Auto-Update</span>
          </div>
        </section>

        <section class="auth-card">
          <div class="auth-tabs">
            <button class="auth-tab ${tab === 'login' ? 'active' : ''}" data-auth-tab="login">Log In</button>
            <button class="auth-tab ${tab === 'signup' ? 'active' : ''}" data-auth-tab="signup">Create Account</button>
          </div>
          <div id="auth-form-area"></div>

          <div class="server-node-footer">
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted);">
              <span>🌐 Server: <strong style="color:var(--text-secondary);">${escapeHtml(getServerUrl() || location.origin)}</strong></span>
              <button type="button" class="btn-ghost btn-sm" id="toggle-server-node">Switch Server</button>
            </div>
            <div id="server-node-editor" class="hidden" style="display:flex;gap:8px;margin-top:4px;">
              <input class="input-control" id="custom-server-input" placeholder="https://your-vyro-server.com (blank = local)" value="${escapeHtml(getServerUrl())}" style="padding:8px 10px;font-size:12.5px;" />
              <button type="button" class="btn btn-secondary btn-sm" id="save-server-btn">Connect</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;

  container.querySelector('#auth-win-min')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.minimize(); });
  container.querySelector('#auth-win-max')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.maximize(); });
  container.querySelector('#auth-win-close')?.addEventListener('click', (e) => { e.stopPropagation(); window.vyroDesktop?.close(); });

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
  container.querySelector('#toggle-server-node').onclick = () => {
    nodeEditor.classList.toggle('hidden');
  };
  container.querySelector('#save-server-btn').onclick = () => {
    const val = container.querySelector('#custom-server-input').value;
    setServerUrl(val);
    toast(val ? `Switched server to ${val}` : 'Using local VYRO server', 'success');
    mountAuthPortal(container, onSignedIn);
  };

  const area = container.querySelector('#auth-form-area');
  if (tab === 'signup') renderSignupArea(area, container, onSignedIn);
  else if (tab === 'reset') renderResetArea(area);
  else renderLoginArea(area, container, onSignedIn);
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
    <div class="auth-card-title">Welcome back to VYRO</div>
    <div class="auth-card-sub">Log in with your email, username, or Discord-style #tag.</div>
    <div id="login-error" class="auth-error-banner hidden"></div>
    <form id="login-form" class="form-grid">
      <div class="field">
        <label>Email or Username#Tag</label>
        <input class="input-control" id="login-id" placeholder="your_username or you@example.com" autocomplete="username" required />
      </div>
      <div class="field">
        <label>
          <span>Password</span>
          <button type="button" id="goto-reset-btn" style="font-size:12px;color:var(--vyro-gold);font-weight:700;">Forgot password?</button>
        </label>
        <div class="input-wrap">
          <input class="input-control input-with-btn" id="login-pw" type="password" placeholder="••••••••" autocomplete="current-password" required />
          <button type="button" class="input-eye-btn" id="toggle-login-pw">Show</button>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);cursor:pointer;">
        <input type="checkbox" id="login-remember" checked /> Keep me logged in on this device
      </label>
      <button type="submit" class="btn btn-primary" id="login-submit-btn">Log In to VYRO ⚡</button>
    </form>

    ${renderSavedAccountsSection()}
  `;

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
    renderResetArea(area);
  };

  area.querySelector('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const errEl = area.querySelector('#login-error');
    const btn = area.querySelector('#login-submit-btn');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
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
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Log In to VYRO ⚡';
    }
  };
}

function renderResetArea(area) {
  area.innerHTML = `
    <div class="auth-card-title">Reset Password</div>
    <div class="auth-card-sub">Recover access using your username/email and recovery phrase.</div>
    <div id="reset-msg" class="auth-error-banner hidden"></div>
    <form id="reset-form" class="form-grid">
      <div class="field">
        <label>Username or Email</label>
        <input class="input-control" id="reset-id" required placeholder="yourname or you@example.com" />
      </div>
      <div class="field">
        <label>Recovery Phrase (set at sign up, blank if none)</label>
        <input class="input-control" id="reset-hint" placeholder="Optional recovery phrase" />
      </div>
      <div class="field">
        <label>New Password</label>
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
      msg.textContent = err.message;
      msg.classList.remove('hidden');
    }
  };
}

function renderSignupArea(area, root, onSignedIn) {
  const s = signupDraft.step;
  const strength = calcPasswordStrength(signupDraft.password);
  const strengthLabels = ['Too short', 'Weak', 'Fair', 'Strong', 'Cyber-proof'];

  area.innerHTML = `
    <div class="auth-card-title">Join VYRO</div>
    <div class="auth-card-sub">Create your Discord + Snapchat hybrid identity in 3 quick steps.</div>

    <div class="signup-steps">
      <div class="signup-step-pill ${s === 1 ? 'active' : s > 1 ? 'done' : ''}">1. Account</div>
      <div class="signup-step-pill ${s === 2 ? 'active' : s > 2 ? 'done' : ''}">2. Identity</div>
      <div class="signup-step-pill ${s === 3 ? 'active' : ''}">3. Avatar</div>
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
          <label>Email Address</label>
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
          <label>Confirm Password</label>
          <input class="input-control" id="su-pw2" type="password" value="${escapeHtml(signupDraft.confirmPassword)}" placeholder="Repeat password" />
        </div>
        <button type="button" class="btn btn-primary" id="su-next-1">Continue to Identity →</button>
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
      debounceTimer = setTimeout(async () => {
        try {
          const check = await api(`/api/auth/check-username?username=${encodeURIComponent(val)}`);
          signupDraft.usernameAvailable = check.available;
          signupDraft.usernameMsg = check.reason;
          statusEl.textContent = check.available ? '✓ Available' : check.reason;
          statusEl.className = `field-hint ${check.available ? 'ok' : 'err'}`;
        } catch {}
      }, 240);
    };

    const pwEl = stepBody.querySelector('#su-pw');
    const pw2El = stepBody.querySelector('#su-pw2');
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

      try {
        const check = await api(`/api/auth/check-username?username=${encodeURIComponent(signupDraft.username)}`);
        if (!check.available) return showErr(check.reason);
      } catch {}

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
            <label>Display Name</label>
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
            <label>Birthday (13+)</label>
            <input class="input-control" id="su-bday" type="date" value="${escapeHtml(signupDraft.birthday)}" />
          </div>
          <div class="field">
            <label>Recovery Phrase (Optional)</label>
            <input class="input-control" id="su-rec" value="${escapeHtml(signupDraft.recoveryHint)}" placeholder="Secret word for reset" />
          </div>
        </div>
        <div class="field">
          <label>Custom Status</label>
          <input class="input-control" id="su-status" value="${escapeHtml(signupDraft.statusText)}" placeholder="e.g. Dropping snaps 📸" maxlength="80" />
        </div>
        <div class="field">
          <label>Bio (Optional)</label>
          <input class="input-control" id="su-bio" value="${escapeHtml(signupDraft.bio)}" placeholder="Tell your servers about you..." maxlength="180" />
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" class="btn btn-secondary" id="su-back-2">← Back</button>
          <button type="button" class="btn btn-primary" id="su-next-2" style="flex:1;">Customize Avatar →</button>
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

      if (signupDraft.birthday) {
        const ageMs = Date.now() - new Date(signupDraft.birthday).getTime();
        if (ageMs < 13 * 365.25 * 24 * 3600 * 1000) {
          return showErr('You must be at least 13 years old to sign up.');
        }
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
        <button type="button" class="btn btn-secondary" id="su-back-3">← Back</button>
        <button type="button" class="btn btn-primary" id="su-finish" style="flex:1;">Create VYRO Account ⚡</button>
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
    const btn = stepBody.querySelector('#su-finish');
    btn.disabled = true;
    btn.textContent = 'Launching VYRO...';
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
      showErr(err.message);
      btn.disabled = false;
      btn.textContent = 'Create VYRO Account ⚡';
    }
  };
}

async function renderDownloadView(container) {
  container.innerHTML = `
    <div class="auth-page">
      <header class="auth-topbar">
        <div class="auth-brand" id="dl-back-home">
          <img src="/assets/icon-192.png" alt="VYRO" />
          <div class="auth-brand-title">VYRO</div>
        </div>
        <div class="auth-nav-actions">
          <button class="btn btn-secondary btn-sm" id="dl-login-btn">Log In</button>
          <button class="btn btn-primary btn-sm" id="dl-signup-btn">Sign Up</button>
        </div>
      </header>
      <div class="download-page-wrap">
        <div class="auth-eyebrow">⚡ PC Desktop .exe + Mobile App + GitHub Auto-Updates</div>
        <h1 class="auth-headline" style="margin-top:14px;">Get <span class="grad">VYRO</span> Everywhere</h1>
        <p class="auth-lead" style="margin-top:8px;">
          Download the standalone Windows <strong>.exe</strong> directly from GitHub Releases (with automatic updates), or scan the QR code to launch VYRO on iOS &amp; Android mobile.
        </p>

        <div class="download-cards" id="dl-cards-root">
          <div class="download-card">
            <h3>🪟 Windows Desktop (.exe)</h3>
            <p style="color:var(--text-secondary);font-size:13.5px;">Checking GitHub Releases &amp; local build artifacts...</p>
          </div>
          <div class="download-card">
            <h3>📱 Mobile (iOS &amp; Android)</h3>
            <p style="color:var(--text-secondary);font-size:13.5px;">Preparing mobile QR code &amp; PWA installer...</p>
          </div>
        </div>
      </div>
    </div>
  `;

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
    const [net, upd] = await Promise.all([api('/api/network-info'), api('/api/updates/check')]);
    networkInfoCache = { net, upd };
    const cards = container.querySelector('#dl-cards-root');
    const mobileUrl = net.lanUrls?.[0]?.url || location.origin;
    const localExeButtons = (net.localExes || [])
      .map((exe) => `<a class="btn btn-primary" href="/downloads/${encodeURIComponent(exe)}" download>${ICONS.download} Download ${escapeHtml(exe)}</a>`)
      .join('');
    const ghExeButtons = (upd.exeAssets || [])
      .map((a) => `<a class="btn btn-primary" href="${escapeHtml(a.downloadUrl)}" target="_blank" rel="noopener">${ICONS.download} ${escapeHtml(a.name)}</a>`)
      .join('');

    const localApkButtons = (net.localApks || [])
      .map((apk) => `<a class="btn btn-primary" href="/downloads/${encodeURIComponent(apk)}" download>${ICONS.download} Download ${escapeHtml(apk)} (Android)</a>`)
      .join('');
    const ghApkButtons = (upd.apkAssets || [])
      .map((a) => `<a class="btn btn-primary" href="${escapeHtml(a.downloadUrl)}" target="_blank" rel="noopener">${ICONS.download} Download ${escapeHtml(a.name)} (Android APK)</a>`)
      .join('');

    cards.innerHTML = `
      <div class="download-card">
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="/assets/icon-192.png" width="44" height="44" style="border-radius:12px;" />
          <div>
            <h3 style="font-size:18px;">Windows Desktop (.exe)</h3>
            <span class="field-hint">Version v${escapeHtml(net.version)} • Auto-updates via GitHub Releases</span>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">
          Includes custom VYRO taskbar icon, native notifications, system tray, built-in server host, and automatic GitHub Release updates.
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${localExeButtons}
          ${ghExeButtons}
          <a class="btn btn-secondary" href="${escapeHtml(upd.releasesPage)}" target="_blank" rel="noopener">
            🐙 Open GitHub Releases (${escapeHtml(net.githubOwner)}/${escapeHtml(net.githubRepo)})
          </a>
        </div>
        <div class="field-hint">${escapeHtml(upd.message || 'Ready for GitHub Releases distribution.')}</div>
      </div>

      <div class="download-card">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:32px;">🤖</div>
          <div>
            <h3 style="font-size:18px;">Android Mobile (.apk)</h3>
            <span class="field-hint">Standalone App • Supports Android 5.0 through Android 16+</span>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">
          Direct download Android APK package. Install directly on any Android phone with native camera, microphone, snaps, and live server sync!
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${localApkButtons || `<a class="btn btn-primary" href="/downloads/VYRO.apk" download>${ICONS.download} Download VYRO.apk</a>`}
          ${ghApkButtons}
          <a class="btn btn-secondary" href="https://github.com/${escapeHtml(net.githubOwner)}/${escapeHtml(net.githubRepo)}/releases" target="_blank" rel="noopener">
            🤖 View Android APK on GitHub Releases
          </a>
        </div>
      </div>

      <div class="download-card">
        <div>
          <h3 style="font-size:18px;">📱 Mobile Web &amp; QR Sync</h3>
          <span class="field-hint">Scan with your phone camera on Wi-Fi, or install on iPhone/iPad!</span>
        </div>
        <div class="qr-card">${renderQrSvg(mobileUrl, 176)}</div>
        <div style="font-family:var(--font-mono);font-size:12px;text-align:center;color:var(--vyro-gold);word-break:break-all;">
          ${escapeHtml(mobileUrl)}
        </div>
        ${state.deferredInstallPrompt ? `<button class="btn btn-primary" id="pwa-install-btn">📲 Install VYRO App on This Device</button>` : ''}
        <p class="field-hint">
          iPhone Safari: Tap <strong>Share → Add to Home Screen</strong>.<br/>
          Android: Download the <strong>.apk</strong> above or install in Chrome.
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
