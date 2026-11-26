import { api, setToken } from '../api.js';
import { ICONS, renderAvatarHtml } from '../icons.js';
import { escapeHtml, formatInlineMarkdown, formatTime, playChime, setState, state, toast } from '../state.js';
import {
  openAddFriendModal,
  openCreateChannelModal,
  openCreateJoinServerModal,
  openMobileQrModal,
  openSettingsAndUpdatesModal,
  openUserProfileModal
} from './Modals.js';
import { openSnapStudioModal } from './SnapStudio.js';
import { openLiveHub } from './Live.js';
import { PLUS_EFFECTS, PLUS_REACTIONS, STICKERS, burstConfetti, isPlus, renderNameHtml, stickerHtml } from '../plus.js';
import { openSnapViewer, openStoryViewer } from './Viewers.js';

let typingTimeout = null;
let mediaRecorder = null;
let audioChunks = [];
let draftMessageText = '';
let searchQuery = '';
let heroCollapsed = false;
let emojiTrayOpen = false;
let voiceCamStream = null;
let voiceCamBlur = false;
let voiceJoinStartedAt = null;
let voiceTimerHandle = null;
let composerEffect = '';
const burstSeen = new Set();

const QUICK_EMOJIS = ['🔥', '⚡', '😂', '❤️', '🙌', '👀', '💀', '🎉', '✨', '🫡'];

const MUSIC_TRACKS = [
  { title: 'Nightfall', artist: 'VYRO Synth', freq: 220 },
  { title: 'Cyber Halo', artist: 'VYRO Prism', freq: 261.6 },
  { title: 'Golden Streak', artist: 'VYRO Chill', freq: 196 },
  { title: 'Obsidian Drift', artist: 'VYRO Lo-Fi', freq: 246.9 }
];
let musicPlaying = false;
let musicTrackIdx = 0;
let musicTimer = null;
let musicCtx = null;

function stopVoiceCameraStream() {
  if (voiceCamStream) {
    voiceCamStream.getTracks().forEach((t) => t.stop());
    voiceCamStream = null;
  }
}

function getTimeGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatCallDuration(startedAt) {
  if (!startedAt) return '00:00';
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function toggleMusicPlayer(onUpdate) {
  musicPlaying = !musicPlaying;
  if (!musicPlaying) {
    clearInterval(musicTimer);
    musicTimer = null;
    onUpdate?.();
    return;
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!musicCtx && AudioCtx) musicCtx = new AudioCtx();
    const playChord = () => {
      if (!musicPlaying || !musicCtx) return;
      const base = MUSIC_TRACKS[musicTrackIdx].freq;
      const ratios = [1, 1.2, 1.5, 1.8];
      const f = base * ratios[Math.floor(Math.random() * ratios.length)];
      for (const mult of [1, 1.5]) {
        const osc = musicCtx.createOscillator();
        const gain = musicCtx.createGain();
        osc.type = mult === 1 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(f * mult, musicCtx.currentTime);
        gain.gain.setValueAtTime(0.001, musicCtx.currentTime);
        gain.gain.linearRampToValueAtTime(mult === 1 ? 0.032 : 0.015, musicCtx.currentTime + 0.14);
        gain.gain.exponentialRampToValueAtTime(0.0008, musicCtx.currentTime + 0.92);
        osc.connect(gain);
        gain.connect(musicCtx.destination);
        osc.start();
        osc.stop(musicCtx.currentTime + 0.96);
      }
    };
    playChord();
    musicTimer = setInterval(playChord, 900);
  } catch {}
  onUpdate?.();
}

function renderAuroraBackdropHtml() {
  return `
    <div class="aurora-canvas" aria-hidden="true">
      <svg class="aurora-waves-svg" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="auroraRibbon1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8B5CF6" stop-opacity="0.55" />
            <stop offset="48%" stop-color="#EC4899" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#FACC15" stop-opacity="0.45" />
          </linearGradient>
          <linearGradient id="auroraRibbon2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FACC15" stop-opacity="0.35" />
            <stop offset="50%" stop-color="#A855F7" stop-opacity="0.38" />
            <stop offset="100%" stop-color="#38BDF8" stop-opacity="0.16" />
          </linearGradient>
        </defs>
        <path d="M-80 260 C 260 60, 480 420, 860 220 C 1140 70, 1320 260, 1520 140" fill="none" stroke="url(#auroraRibbon1)" stroke-width="2.2" />
        <path d="M-80 680 C 240 500, 560 820, 920 600 C 1180 440, 1340 620, 1520 500" fill="none" stroke="url(#auroraRibbon2)" stroke-width="2.2" />
        <path d="M-40 460 C 320 260, 620 580, 1020 380 C 1260 260, 1380 420, 1520 340" fill="none" stroke="url(#auroraRibbon1)" stroke-width="1" stroke-opacity="0.45" />
      </svg>
    </div>
  `;
}

function renderBannerArtworkSvg() {
  return `
    <svg class="hero-scenic-svg" viewBox="0 0 640 160" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="vyroMoonGlow" cx="72%" cy="32%" r="48%">
          <stop offset="0%" stop-color="#FEF08A" stop-opacity="0.88" />
          <stop offset="42%" stop-color="#D946EF" stop-opacity="0.52" />
          <stop offset="100%" stop-color="#8B5CF6" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="vyroPeak1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4C1D95" stop-opacity="0.78" />
          <stop offset="100%" stop-color="#090A14" stop-opacity="0.96" />
        </linearGradient>
        <linearGradient id="vyroPeak2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#1E1B4B" stop-opacity="0.92" />
          <stop offset="65%" stop-color="#581C87" stop-opacity="0.85" />
          <stop offset="100%" stop-color="#B45309" stop-opacity="0.72" />
        </linearGradient>
      </defs>
      <circle cx="465" cy="52" r="78" fill="url(#vyroMoonGlow)" />
      <circle cx="465" cy="52" r="28" fill="#FDE047" fill-opacity="0.22" stroke="#FDE047" stroke-opacity="0.45" stroke-width="1" />
      <path d="M120 160 L260 66 L360 112 L485 38 L640 120 L640 160 Z" fill="url(#vyroPeak1)" />
      <path d="M180 160 L320 92 L430 132 L545 72 L640 124 L640 160 Z" fill="url(#vyroPeak2)" />
    </svg>
  `;
}

export function renderWorkspace(container, { wsClient, loadAllData, loadMessages }) {
  const user = state.user;
  if (!user) return;

  const prevInput = container.querySelector('#msg-input');
  const prevSearch = container.querySelector('#global-vyro-search');
  const prevTtl = container.querySelector('#msg-ttl-select')?.value;
  const wasInputFocused = Boolean(prevInput && document.activeElement === prevInput);
  const wasSearchFocused = Boolean(prevSearch && document.activeElement === prevSearch);
  const selStart = wasInputFocused ? prevInput.selectionStart : null;
  const selEnd = wasInputFocused ? prevInput.selectionEnd : null;
  if (prevInput) draftMessageText = prevInput.value;

  const activeServer = state.servers.find((s) => s.id === state.activeServerId) || state.servers[0] || null;
  const activeChannel =
    activeServer?.channels.find((c) => c.id === state.activeChannelId) ||
    activeServer?.channels.find((c) => c.type !== 'voice') ||
    null;

  const activeFriendEntry = state.friends.find((f) => f.dmId === state.activeDmId) || null;
  const currentScopeType = state.viewScope === 'server' && activeChannel ? 'channel' : state.activeDmId ? 'dm' : null;
  const currentScopeId = currentScopeType === 'channel' ? activeChannel.id : state.activeDmId;

  const unreadSnapsTotal = state.friends.reduce((acc, f) => acc + (f.unopenedSnapCount || 0), 0) + state.incomingRequests.length;
  const activeStreaksTotal = state.friends.filter((f) => (f.streakCount || 0) > 0).length;
  const navTab = state.navSection || (state.viewScope === 'server' ? 'communities' : 'home');

  const totalXp = (user.snapScore || 0) * 15 + 450;
  const level = Math.floor(totalXp / 500) + 1;
  const xpInLevel = totalXp % 500;
  const xpPct = Math.round((xpInLevel / 500) * 100);
  const track = MUSIC_TRACKS[musicTrackIdx];

  // Calculate active voice roster count & current scope breadcrumb
  const voiceChannel = activeServer?.channels.find((c) => c.type === 'voice') || { id: 'ch_hq_lounge', name: 'Voice Lounge' };
  const inThisVc = state.voiceState[state.myVoiceChannelId || voiceChannel.id] || [];

  let scopeCrumb = 'Home';
  if (navTab === 'voice') scopeCrumb = `Voice Stage • ${voiceChannel.name}`;
  else if (navTab === 'discover') scopeCrumb = 'Discover';
  else if (navTab === 'friends') scopeCrumb = 'Squad & Streaks';
  else if (currentScopeType === 'channel' && activeChannel) scopeCrumb = `# ${activeChannel.name}`;
  else if (activeFriendEntry) scopeCrumb = `@${activeFriendEntry.user.displayName}`;

  const pool = new Map();
  if (user) pool.set(user.id, { ...user, role: 'owner' });
  for (const m of activeServer?.members || []) pool.set(m.id, m);
  for (const f of state.friends || []) {
    if (!pool.has(f.user.id)) pool.set(f.user.id, f.user);
  }
  const onlineCount = Array.from(pool.values()).filter((u) => u.presence !== 'offline').length;

  container.innerHTML = `
    <div class="app-shell">
      ${renderAuroraBackdropHtml()}

      <header class="vyro-titlebar">
        <div class="titlebar-left">
          <div class="live-sync-pill">
            <span class="live-dot ${state.wsConnected ? '' : 'reconnecting'}"></span>
            <span style="color:${state.wsConnected ? '#86EFAC' : '#FCD34D'};">${state.wsConnected ? 'Live' : 'Syncing'}</span>
          </div>
          <div class="scope-crumb-pill">${escapeHtml(scopeCrumb)}</div>
        </div>

        <div class="global-search-wrap">
          <span class="global-search-icon">${ICONS.search}</span>
          <input class="global-search-input" id="global-vyro-search" placeholder="Search friends, communities, or channels..." value="${escapeHtml(searchQuery)}" />
          <span class="search-kbd-badge">Ctrl K</span>
        </div>

        <div class="titlebar-right">
          ${
            state.updateInfo?.updateAvailable || state.desktopUpdateState?.stage === 'ready'
              ? `<button class="btn btn-primary btn-sm" id="tb-upd-btn" style="padding:5px 12px;font-size:11.5px;">${ICONS.sparkles} Update</button>`
              : `<button class="tb-icon-btn" id="tb-upd-btn" title="Check for Updates">${ICONS.refresh}</button>`
          }
          <button class="tb-icon-btn" id="tb-qr-btn" title="Connect Mobile via QR">${ICONS.qr}</button>
          <button class="tb-icon-btn" id="tb-notif-btn" title="Notifications &amp; Requests">${ICONS.bell}${unreadSnapsTotal > 0 ? `<span class="tb-notif-badge">${unreadSnapsTotal}</span>` : ''}</button>
          <button class="tb-icon-btn" id="tb-friends-btn" title="Squad &amp; Streaks">${ICONS.users}</button>
          ${
            window.vyroDesktop
              ? `<div class="tb-win-group">
                  <button class="tb-win-btn" id="win-min" title="Minimize">${ICONS.winMin}</button>
                  <button class="tb-win-btn" id="win-max" title="Maximize / Restore">${ICONS.winMax}</button>
                  <button class="tb-win-btn close" id="win-close" title="Close">${ICONS.winClose}</button>
                </div>`
              : ''
          }
        </div>
      </header>

      <div class="app-workspace ${!state.showMembersPane ? 'hide-members' : ''} mobile-tab-${state.mobileTab}">
        <aside class="vyro-left-rail">
          <div>
            <div class="rail-brand-header">
              <div class="rail-brand-left">
                <img src="/assets/icon-192.png" alt="VYRO" />
                <div class="rail-brand-word">VYRO</div>
              </div>
              <span class="rail-ver-tag">PRISM</span>
            </div>
            <nav class="rail-nav-list">
              <button class="rail-nav-btn ${navTab === 'home' ? 'active' : ''}" data-rail-nav="home">${ICONS.home}<span>Home</span></button>
              <button class="rail-nav-btn ${navTab === 'messages' ? 'active' : ''}" data-rail-nav="messages">${ICONS.message}<span>Messages</span>${unreadSnapsTotal > 0 ? `<span class="rail-nav-badge">${unreadSnapsTotal}</span>` : ''}</button>
              <button class="rail-nav-btn ${navTab === 'communities' ? 'active' : ''}" data-rail-nav="communities">${ICONS.globe}<span>Communities</span></button>
              <button class="rail-nav-btn ${navTab === 'voice' ? 'active' : ''}" data-rail-nav="voice">${ICONS.voiceStage}<span>Voice Stage</span>${inThisVc.length > 0 || state.myVoiceChannelId ? `<span class="rail-nav-badge" style="background:var(--status-online);color:#041208;">LIVE</span>` : ''}</button>
              <button class="rail-nav-btn ${navTab === 'discover' ? 'active' : ''}" data-rail-nav="discover">${ICONS.compass}<span>Discover</span></button>
              <button class="rail-nav-btn" id="rail-live-btn">${ICONS.video}<span>VYRO Live</span><span class="rail-nav-badge live-badge">18+</span></button>
              <button class="rail-nav-btn rail-plus-btn" id="rail-plus-btn"><span class="rail-plus-crown">👑</span><span>VYRO+</span>${isPlus(user) ? '' : `<span class="rail-nav-badge plus-price-badge">£1.99</span>`}</button>
              <button class="rail-nav-btn ${navTab === 'friends' ? 'active' : ''}" data-rail-nav="friends">${ICONS.users}<span>Friends</span>${state.incomingRequests.length ? `<span class="rail-nav-badge">${state.incomingRequests.length}</span>` : ''}</button>
              <button class="rail-nav-btn" id="rail-updates-btn">${ICONS.refresh}<span>Updates</span>${state.updateInfo?.updateAvailable || state.desktopUpdateState?.stage === 'ready' ? `<span class="rail-nav-badge" style="background:var(--vyro-gold);color:#090910;">NEW</span>` : ''}</button>
              <button class="rail-nav-btn" id="rail-settings-btn">${ICONS.settings}<span>Settings</span></button>
            </nav>
          </div>

          <div class="rail-bottom-stack">
            <div class="level-xp-card">
              <div class="level-xp-top">
                <span>Level ${level}</span>
                <span style="color:var(--vyro-gold);">👻 ${user.snapScore || 0}</span>
              </div>
              <div class="xp-track"><div class="xp-fill" style="width:${xpPct}%;"></div></div>
              <div class="xp-sub">${xpInLevel} / 500 XP • ${activeStreaksTotal} 🔥</div>
            </div>

            <div class="rail-user-card" id="open-my-settings">
              <div style="display:flex;align-items:center;gap:9px;min-width:0;">
                ${renderAvatarHtml(user, 34, true)}
                <div style="min-width:0;">
                  <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${renderNameHtml(user, { badgeSize: 13 })}</div>
                  <div style="font-size:11px;color:var(--status-online);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(user.statusText || 'Online')}</div>
                </div>
              </div>
              <span style="color:var(--text-muted);font-weight:800;font-size:15px;">›</span>
            </div>
          </div>
        </aside>

        <section class="center-glass-frame">
          <div class="hero-welcome-banner ${heroCollapsed ? 'collapsed' : ''}">
            ${renderBannerArtworkSvg()}
            <div class="hero-welcome-left">
              <div class="hero-accent-bars"><span></span><span></span></div>
              <div style="min-width:0;">
                <div class="hero-welcome-title">
                  <span>${getTimeGreeting()}, ${escapeHtml(user.displayName)}</span>
                  <span class="hero-stat-chip hide-sm">● ${onlineCount} Online</span>
                  ${activeStreaksTotal > 0 ? `<span class="hero-stat-chip hide-sm">🔥 ${activeStreaksTotal} Streak${activeStreaksTotal > 1 ? 's' : ''}</span>` : ''}
                </div>
                ${
                  heroCollapsed
                    ? ''
                    : `<div class="hero-welcome-sub">Drop a timed Flash Snap, share a 24h Story, or jump into Spatial Voice.</div>`
                }
              </div>
            </div>
            <div class="hero-actions-right hide-sm">
              <button class="btn btn-secondary btn-sm" id="hero-snap-btn">${ICONS.camera} New Snap</button>
              <button class="btn btn-secondary btn-sm" id="hero-voice-btn">${ICONS.voiceStage} Voice</button>
              <button class="btn btn-primary btn-sm" id="hero-qr-btn">${ICONS.qr} Mobile Connect</button>
              <button class="dock-icon-btn" id="toggle-hero-btn" title="${heroCollapsed ? 'Expand Banner' : 'Compact Banner'}" style="color:#fff;">${heroCollapsed ? '▾' : '▴'}</button>
            </div>
          </div>

          <div class="stories-strip">
            <button class="story-bubble-btn" id="add-story-btn">
              <div class="story-ring add-story">
                <div class="story-ring-inner" style="width:38px;height:38px;font-size:18px;font-weight:800;color:var(--vyro-gold);">+</div>
              </div>
              <span class="story-label">Add Story</span>
            </button>
            ${state.storyGroups
              .map(
                (g, idx) => `
              <button class="story-bubble-btn" data-story-group="${idx}">
                <div class="story-ring ${g.hasUnseen ? '' : 'seen'}">
                  <div class="story-ring-inner">${renderAvatarHtml(g.author, 36)}</div>
                </div>
                <span class="story-label">${escapeHtml(g.author.id === user.id ? 'My Story' : g.author.displayName)}</span>
              </button>
            `
              )
              .join('')}
          </div>

          <div class="center-split-body">
            <div class="inner-list-pane">
              <div class="inner-section-head">
                <span>Direct Messages</span>
                <button class="dock-icon-btn" id="open-add-friend" title="Add Friend">${ICONS.plus}</button>
              </div>
              ${
                state.friends.length === 0 && !searchQuery
                  ? `<div style="padding:10px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);font-size:11.5px;color:var(--text-muted);text-align:center;margin-bottom:6px;">
                      No DMs yet.<br/>
                      <button type="button" id="empty-list-add-fr" style="color:var(--vyro-gold);font-weight:800;margin-top:4px;">+ Add a Friend</button>
                    </div>`
                  : ''
              }
              ${state.friends
                .filter((f) => !searchQuery || f.user.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((f) => {
                  const active = navTab !== 'voice' && navTab !== 'discover' && navTab !== 'friends' && state.viewScope === 'home' && state.activeDmId === f.dmId;
                  let statusCls = 'chat';
                  let statusLabel = f.user.statusText || 'Tap to chat';
                  if (f.unopenedSnapCount > 0) {
                    statusCls = 'unopened';
                    statusLabel = `New Snap (${f.unopenedSnapCount})`;
                  } else if (f.lastMessage?.kind === 'snap') {
                    statusCls = f.lastMessage.author_id === user.id ? 'sent' : 'opened';
                    statusLabel = f.lastMessage.author_id === user.id ? 'Delivered Snap' : 'Opened Snap';
                  }
                  return `
                    <button class="dm-row ${active ? 'active' : ''}" data-dm-id="${escapeHtml(f.dmId)}">
                      ${renderAvatarHtml(f.user, 32, true)}
                      <div class="dm-meta">
                        <div class="dm-name-line">
                          <span class="dm-name">${renderNameHtml(f.user, { badgeSize: 13 })}</span>
                          ${f.streakCount > 0 ? `<span class="streak-pill">${f.streakExpiring ? '⌛' : ''}🔥 ${f.streakCount}</span>` : ''}
                        </div>
                        <div class="dm-snap-status">
                          <span class="snap-square ${statusCls}"></span>
                          <span>${escapeHtml(statusLabel)}</span>
                        </div>
                      </div>
                    </button>
                  `;
                })
                .join('')}

              <div class="inner-section-head" style="margin-top:10px;">
                <span>Communities</span>
                <button class="dock-icon-btn" id="rail-add-srv" title="Create or Join Community">${ICONS.plus}</button>
              </div>
              ${state.servers
                .filter((s) => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((s) => {
                  const isSrvActive = state.viewScope === 'server' && state.activeServerId === s.id;
                  return `
                    <button class="comm-row ${isSrvActive ? 'active' : ''}" data-srv-id="${escapeHtml(s.id)}">
                      <span class="comm-icon-badge" style="background:${escapeHtml(s.iconColor)};">${escapeHtml(s.iconEmoji || '⚡')}</span>
                      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.name)}</span>
                    </button>
                    ${
                      isSrvActive
                        ? `<div class="channel-sub-list">
                            ${s.channels
                              .map((ch) => {
                                const icon = ch.type === 'voice' ? '🔊' : ch.type === 'ephemeral' ? '⚡' : '#';
                                const chActive = ch.id === activeChannel?.id && ch.type !== 'voice';
                                const vcCount = ch.type === 'voice' ? (state.voiceState[ch.id] || []).length : 0;
                                return `
                                  <button class="channel-row ${chActive ? 'active' : ''}" data-ch-id="${escapeHtml(ch.id)}" data-ch-type="${escapeHtml(ch.type)}">
                                    <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${icon} ${escapeHtml(ch.name)}</span>
                                    ${
                                      ch.type === 'ephemeral'
                                        ? `<span class="channel-ttl-tag">${ch.defaultTtlSec}s</span>`
                                        : ch.type === 'voice' && vcCount > 0
                                        ? `<span class="channel-ttl-tag" style="background:rgba(34,197,94,0.18);color:#4ADE80;">${vcCount}</span>`
                                        : ''
                                    }
                                  </button>
                                `;
                              })
                              .join('')}
                            <button class="channel-row" id="add-channel-btn" style="color:var(--vyro-gold);">+ Add Channel</button>
                          </div>`
                        : ''
                    }
                  `;
                })
                .join('')}
            </div>

            <div class="inner-chat-pane">
              ${renderInnerChatHtml(navTab, activeServer, activeChannel, activeFriendEntry, currentScopeType, currentScopeId, pool, voiceChannel)}
            </div>
          </div>
        </section>

        ${
          state.showMembersPane
            ? `<aside class="right-widget-col" id="member-pane">${renderRightWidgetsHtml(activeServer, track, pool, voiceChannel)}</aside>`
            : ''
        }
      </div>

      <nav class="mobile-nav-bar">
        <button class="mobile-nav-btn ${state.mobileTab === 'chats' ? 'active' : ''}" data-mtab="chats"><span>💬</span><span>Chats</span></button>
        <button class="mobile-nav-btn ${state.mobileTab === 'servers' ? 'active' : ''}" data-mtab="servers"><span>🌐</span><span>Rooms</span></button>
        <button class="mobile-nav-btn" id="mobile-snap-fab"><div class="mobile-snap-fab">${ICONS.camera}</div></button>
        <button class="mobile-nav-btn" id="mobile-live-btn"><span>🔴</span><span>Live</span></button>
        <button class="mobile-nav-btn ${state.mobileTab === 'stories' ? 'active' : ''}" data-mtab="stories"><span>✨</span><span>Stories</span></button>
        <button class="mobile-nav-btn" id="mobile-profile-btn"><span>👤</span><span>You</span></button>
      </nav>
    </div>
  `;

  wireWorkspaceEvents(container, {
    wsClient,
    loadAllData,
    loadMessages,
    activeServer,
    currentScopeType,
    currentScopeId,
    voiceChannel,
    wasInputFocused,
    wasSearchFocused,
    selStart,
    selEnd,
    prevTtl
  });
}

function renderSpatialVoiceStageHtml(activeServer, voiceChannel, pool) {
  const vcId = state.myVoiceChannelId || voiceChannel.id;
  const connected = Boolean(state.myVoiceChannelId);
  const participants = state.voiceState[vcId] || [];

  // Ensure local user always sees a clean tile when connected even before round-trip
  const displayList = [...participants];
  if (connected && state.user && !displayList.some((p) => p.userId === state.user.id)) {
    displayList.unshift({ userId: state.user.id, muted: state.voiceMuted, deafened: state.voiceDeafened, camera: state.voiceCamera });
  }

  return `
    <div class="chat-header">
      <div class="chat-header-left">
        <span class="chat-header-title">🎙️ ${escapeHtml(activeServer?.name || 'VYRO Lounge')} • ${escapeHtml(voiceChannel.name)}</span>
        <span class="badge-pill" style="background:rgba(34,197,94,0.16);color:#4ADE80;">
          ● ${displayList.length} in lounge${connected && voiceJoinStartedAt ? ` • <span id="vc-stage-timer">${formatCallDuration(voiceJoinStartedAt)}</span>` : ''}
        </span>
      </div>
      <div class="chat-header-actions">
        ${
          activeServer?.inviteCode
            ? `<button class="btn btn-secondary btn-sm" id="vc-copy-invite" data-code="${escapeHtml(activeServer.inviteCode)}">${ICONS.copy} Invite: ${escapeHtml(activeServer.inviteCode)}</button>`
            : ''
        }
        <button class="header-icon-btn" id="hdr-add-friend-2" title="Add Friend">${ICONS.userPlus}</button>
        <button class="header-icon-btn" id="toggle-members-btn" title="Toggle Right Panel">${ICONS.users}</button>
      </div>
    </div>

    <div class="voice-stage-wrap">
      ${
        displayList.length
          ? `<div class="voice-stage-grid">
              ${displayList
                .map((p) => {
                  const u = pool.get(p.userId) || { displayName: 'Squad Member', presence: 'online' };
                  const isMe = p.userId === state.user?.id;
                  const showLocalVideo = isMe && state.voiceCamera && voiceCamStream;
                  const speaking = !p.muted;
                  return `
                    <div class="voice-tile ${speaking ? 'speaking' : ''}">
                      ${
                        showLocalVideo
                          ? `<video id="vc-local-video-preview" class="${voiceCamBlur ? 'blurred' : ''}" autoplay playsinline muted></video>`
                          : `<div style="transform:scale(1.15);">${renderAvatarHtml(u, 76, true)}</div>
                             <div style="font-size:12px;color:var(--text-muted);">${p.muted ? 'Muted' : 'Listening &amp; Ready'}</div>`
                      }
                      <div class="voice-tile-nametag">
                        <span style="width:7px;height:7px;border-radius:50%;background:${p.muted ? '#EF4444' : '#22C55E'};"></span>
                        <span>${escapeHtml(u.displayName)}${isMe ? ' (You)' : ''}</span>
                        ${p.muted ? '<span style="color:#FCA5A5;">🔇</span>' : ''}
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="empty-chat-bento">
              <div class="empty-chat-orb">${ICONS.voiceStage}</div>
              <div style="font-size:17px;font-weight:900;">Spatial Voice Stage Ready</div>
              <div style="font-size:13px;color:var(--text-secondary);">Hop into <strong>${escapeHtml(voiceChannel.name)}</strong> to hang out live with friends, toggle webcam preview with optical blur, and see real-time speaker tiles.</div>
              <div class="empty-starter-row">
                <button class="btn btn-primary btn-sm" id="stage-join-cta" data-vc-id="${escapeHtml(voiceChannel.id)}">${ICONS.mic} Join Voice Lounge</button>
                <button class="btn btn-secondary btn-sm" id="stage-invite-btn">${ICONS.userPlus} Invite Friends</button>
              </div>
            </div>`
      }

      <div class="voice-stage-dock">
        ${
          connected
            ? `<button class="voice-dock-btn ${state.voiceMuted ? 'toggled' : ''}" id="stage-mute-btn" title="Mute / Unmute">${state.voiceMuted ? ICONS.micOff : ICONS.mic}</button>
               <button class="voice-dock-btn ${state.voiceCamera ? '' : 'toggled'}" id="stage-cam-btn" title="Toggle Camera">${ICONS.video}</button>
               <button class="voice-dock-btn ${voiceCamBlur ? '' : 'toggled'}" id="stage-blur-btn" title="Toggle Background Blur">${ICONS.droplet}</button>
               <button class="voice-dock-btn ${state.voiceDeafened ? 'toggled' : ''}" id="stage-deaf-btn" title="Deafen Audio">${ICONS.headphones}</button>
               <button class="voice-dock-btn end" id="stage-leave-btn" data-vc-id="${escapeHtml(voiceChannel.id)}" title="Leave Voice">${ICONS.phoneOff}</button>`
            : `<button class="voice-dock-btn join" id="stage-join-btn" data-vc-id="${escapeHtml(voiceChannel.id)}">${ICONS.mic} Join Spatial Voice</button>`
        }
      </div>
    </div>
  `;
}

function renderInnerChatHtml(navTab, activeServer, activeChannel, activeFriendEntry, currentScopeType, currentScopeId, pool, voiceChannel) {
  const user = state.user;

  if (state.mobileTab === 'stories' && window.innerWidth <= 768) {
    return `
      <div class="chat-header">
        <div class="chat-header-left"><span class="chat-header-title">✨ 24h Stories</span></div>
        <button class="btn btn-primary btn-sm" id="add-story-btn-2">+ New Story</button>
      </div>
      <div class="friends-directory">
        ${
          state.storyGroups.length
            ? state.storyGroups
                .map(
                  (g, idx) => `
              <div class="dir-card" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" data-story-group="${idx}">
                <div style="display:flex;align-items:center;gap:12px;">
                  <div class="story-ring ${g.hasUnseen ? '' : 'seen'}"><div class="story-ring-inner">${renderAvatarHtml(g.author, 42)}</div></div>
                  <div><strong>${escapeHtml(g.author.displayName)}</strong><div class="field-hint">${g.stories.length} story snap(s)</div></div>
                </div>
                <span class="badge-pill" style="background:var(--vyro-gradient-soft);color:var(--vyro-gold);">Watch ▶</span>
              </div>
            `
                )
                .join('')
            : `<div class="empty-chat-bento">
                <div class="empty-chat-orb">✨</div>
                <div style="font-weight:800;font-size:16px;">No Stories Yet</div>
                <div class="field-hint">Share your first 24h Story with text, filters, and stickers!</div>
                <button class="btn btn-primary btn-sm" id="empty-story-create-btn">+ Create 24h Story</button>
              </div>`
        }
      </div>
    `;
  }

  if (navTab === 'voice') {
    return renderSpatialVoiceStageHtml(activeServer, voiceChannel, pool);
  }

  if (navTab === 'discover') {
    return `
      <div class="chat-header">
        <div class="chat-header-left"><span class="chat-header-title">🧭 Discover VYRO Communities</span></div>
        <button class="btn btn-primary btn-sm" id="disc-join-btn">+ Create / Join Server</button>
      </div>
      <div class="friends-directory">
        ${
          state.servers.length
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:14px;">
                ${state.servers
                  .map(
                    (s) => `
                  <div class="dir-card" style="display:flex;flex-direction:column;gap:10px;">
                    <div style="display:flex;align-items:center;gap:11px;">
                      <span class="comm-icon-badge" style="background:${escapeHtml(s.iconColor)};width:40px;height:40px;font-size:17px;">${escapeHtml(s.iconEmoji)}</span>
                      <div style="min-width:0;">
                        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.name)}</div>
                        <div class="field-hint">${s.members.length} members • Code: <code style="color:var(--vyro-gold);">${escapeHtml(s.inviteCode)}</code></div>
                      </div>
                    </div>
                    <div class="field-hint" style="flex:1;">${escapeHtml(s.description || 'Channels, Flash Snaps & Voice Lounge')}</div>
                    <div style="display:flex;gap:8px;">
                      <button class="btn btn-primary btn-sm" data-srv-open="${escapeHtml(s.id)}" style="flex:1;">Enter →</button>
                      <button class="btn btn-secondary btn-sm" data-copy-invite="${escapeHtml(s.inviteCode)}" title="Copy Invite Code">${ICONS.copy}</button>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : `<div class="empty-chat-bento">
                <div class="empty-chat-orb">🌐</div>
                <div style="font-size:17px;font-weight:900;">Start Your First Community</div>
                <div style="font-size:13px;color:var(--text-secondary);">Create a private server for your squad with text rooms, ⚡ ephemeral Snap channels, and live Voice Stages — or join one using a friend's invite code.</div>
                <button class="btn btn-primary btn-sm" id="empty-disc-create">+ Create or Join Server</button>
              </div>`
        }
      </div>
    `;
  }

  if (navTab === 'friends' || !currentScopeId) {
    return `
      <div class="chat-header">
        <div class="chat-header-left"><span class="chat-header-title">👥 Squad &amp; Snap Streaks</span></div>
        <button class="btn btn-primary btn-sm" id="hdr-add-friend">${ICONS.userPlus} Add Friend</button>
      </div>
      <div class="friends-directory">
        ${
          state.incomingRequests.length
            ? `<div class="dir-card" style="border-color:rgba(250,204,21,0.38);">
                <h4 style="margin-bottom:10px;color:var(--vyro-gold);">Incoming Friend Requests (${state.incomingRequests.length})</h4>
                ${state.incomingRequests
                  .map(
                    (r) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      ${renderAvatarHtml(r.user, 36, true)}
                      <strong>${escapeHtml(r.user.displayName)} <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">#${escapeHtml(r.user.discriminator)}</span></strong>
                    </div>
                    <div style="display:flex;gap:6px;">
                      <button class="btn btn-primary btn-sm" data-fr-act="accept" data-fr-id="${escapeHtml(r.friendshipId)}">Accept</button>
                      <button class="btn btn-secondary btn-sm" data-fr-act="decline" data-fr-id="${escapeHtml(r.friendshipId)}">Ignore</button>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
            : ''
        }
        ${
          state.friends.length
            ? `<div class="dir-card">
                <h4 style="margin-bottom:12px;">Your Squad (${state.friends.length})</h4>
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${state.friends
                    .map(
                      (f) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);">
                      <div style="display:flex;align-items:center;gap:11px;">
                        ${renderAvatarHtml(f.user, 38, true)}
                        <div>
                          <div style="font-weight:800;">${renderNameHtml(f.user, { labels: true })} ${f.streakCount > 0 ? `<span class="streak-pill">🔥 ${f.streakCount}</span>` : ''}</div>
                          <div class="field-hint">${escapeHtml(f.user.statusText || f.user.presence)}</div>
                        </div>
                      </div>
                      <button class="btn btn-primary btn-sm" data-open-dm="${escapeHtml(f.dmId)}">Message</button>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`
            : `<div class="empty-chat-bento">
                <div class="empty-chat-orb">⚡</div>
                <div style="font-size:18px;font-weight:900;">Clean Slate — Invite Your Real Squad</div>
                <div style="font-size:13px;color:var(--text-secondary);">VYRO has zero fake bots. Add friends by username or share your QR code so they can join your server, drop Snaps, and start daily 🔥 streaks.</div>
                <div class="empty-starter-row">
                  <button class="btn btn-primary btn-sm" id="empty-fr-add">${ICONS.userPlus} Find &amp; Add Friends</button>
                  <button class="btn btn-secondary btn-sm" id="empty-fr-qr">${ICONS.qr} Mobile QR Connect</button>
                  <button class="btn btn-secondary btn-sm" id="empty-fr-srv">${ICONS.globe} Create Community</button>
                </div>
              </div>`
        }
      </div>
    `;
  }

  let headerTitle = '';
  let headerSub = '';
  let headerAvatar = '';
  let defaultTtl = 0;

  if (currentScopeType === 'channel' && activeChannel) {
    const icon = activeChannel.type === 'ephemeral' ? '⚡' : '#';
    headerTitle = `${activeServer?.name || 'Community'} / ${icon} ${activeChannel.name}`;
    headerSub = activeChannel.topic || 'Community Channel';
    defaultTtl = activeChannel.defaultTtlSec || 0;
  } else if (activeFriendEntry) {
    headerAvatar = renderAvatarHtml(activeFriendEntry.user, 36, true);
    headerTitle = activeFriendEntry.user.displayName;
    headerSub =
      activeFriendEntry.streakCount > 0
        ? `● ${activeFriendEntry.user.presence} • 🔥 ${activeFriendEntry.streakCount}-Day Streak`
        : `● ${activeFriendEntry.user.presence}`;
  }

  const typingMap = state.typingUsers[`${currentScopeType}:${currentScopeId}`] || {};
  const typingNames = Object.values(typingMap);

  return `
    <div class="chat-header">
      <div class="chat-header-left">
        <button class="dock-icon-btn mobile-only-btn" id="mobile-back-list">←</button>
        ${headerAvatar}
        <div style="min-width:0;">
          <div class="chat-header-title">${activeFriendEntry && currentScopeType !== 'channel' ? renderNameHtml(activeFriendEntry.user) : escapeHtml(headerTitle)}</div>
          <div class="chat-header-topic">${escapeHtml(headerSub)}</div>
        </div>
      </div>
      <div class="chat-header-actions">
        ${
          currentScopeType === 'channel' && activeServer?.inviteCode
            ? `<button class="btn btn-secondary btn-sm hide-sm" data-copy-invite="${escapeHtml(activeServer.inviteCode)}" title="Copy Server Invite Code" style="font-size:11px;">${ICONS.copy} ${escapeHtml(activeServer.inviteCode)}</button>`
            : ''
        }
        <button class="header-icon-btn" id="hdr-voice-quick" title="Jump into Voice Stage">${ICONS.phone}</button>
        <button class="header-icon-btn" id="hdr-snap-quick" title="Open Snap Studio">${ICONS.video}</button>
        <button class="header-icon-btn" id="hdr-add-friend-2" title="Add Friend">${ICONS.userPlus}</button>
        <button class="header-icon-btn" id="toggle-members-btn" title="Toggle Right Panel">${ICONS.users}</button>
      </div>
    </div>

    <div class="messages-scroll" id="messages-feed">
      ${
        state.messages.length
          ? state.messages.map((m) => renderMessageRowHtml(m, user.id, isPlus(user))).join('')
          : `<div class="empty-chat-bento">
              <div class="empty-chat-orb">⚡</div>
              <div style="font-size:16px;font-weight:900;">Start the Conversation</div>
              <div style="font-size:12.5px;color:var(--text-secondary);">Send a message, drop a timed Flash Snap, or record a voice note.</div>
              <div class="empty-starter-row">
                <button type="button" class="btn btn-secondary btn-sm" data-quick-say="👋 Hey! Welcome to VYRO!">👋 Say Hi</button>
                <button type="button" class="btn btn-secondary btn-sm" data-quick-say="⚡ Wanna drop a Snap or hop in Voice?">⚡ Ping Squad</button>
                <button type="button" class="btn btn-primary btn-sm" id="empty-open-snap">${ICONS.camera} Shoot a Snap</button>
              </div>
            </div>`
      }
    </div>

    <div class="typing-bar">${typingNames.length ? `✍️ ${escapeHtml(typingNames.join(', '))} is typing...` : ''}</div>

    <div class="composer-wrap">
      ${
        emojiTrayOpen
          ? `<div class="emoji-quick-tray" id="emoji-quick-tray">
              ${QUICK_EMOJIS.map((em) => `<button type="button" class="emoji-quick-btn" data-insert-emoji="${em}">${em}</button>`).join('')}
              <div class="plus-tray-row">
                <span class="plus-tray-title">👑 VYRO+ stickers</span>
                ${
                  isPlus(user)
                    ? Object.entries(STICKERS)
                        .map(([id, st]) => `<button type="button" class="plus-sticker-btn" data-send-sticker="${id}" title="${escapeHtml(st.text)}">${st.emoji}<small>${escapeHtml(st.text)}</small></button>`)
                        .join('')
                    : `<button type="button" class="btn btn-secondary btn-sm" data-open-plus="1">Unlock stickers, effects &amp; reactions with VYRO+</button>`
                }
              </div>
            </div>`
          : ''
      }
      ${
        state.replyTo
          ? `<div class="reply-banner">
              <span>Replying to <strong>${escapeHtml(state.replyTo.author?.displayName || 'User')}</strong>: ${escapeHtml((state.replyTo.content || 'Snap').slice(0, 60))}</span>
              <button type="button" id="cancel-reply-btn">✕</button>
            </div>`
          : ''
      }
      <form id="composer-form" class="composer-box ${state.replyTo ? 'with-reply' : ''}">
        <button type="button" class="composer-icon-btn" id="open-snap-studio" title="Shoot or Draw a Snap">${ICONS.camera}</button>
        <select class="ttl-select" id="msg-ttl-select" title="Ephemeral Disappear Timer">
          <option value="0" ${defaultTtl === 0 ? 'selected' : ''}>∞ Stay</option>
          <option value="10" ${defaultTtl > 0 && defaultTtl <= 10 ? 'selected' : ''}>⏱ 10s</option>
          <option value="15" ${defaultTtl === 15 ? 'selected' : ''}>⏱ 15s</option>
          <option value="30" ${defaultTtl >= 20 ? 'selected' : ''}>⏱ 30s</option>
        </select>
        <input class="composer-input" id="msg-input" placeholder="Message ${escapeHtml(headerTitle)}..." autocomplete="off" />
        <button type="button" class="composer-icon-btn" id="composer-emoji-btn" title="Quick Emojis">${ICONS.smile}</button>
        ${
          isPlus(user)
            ? `<button type="button" class="composer-icon-btn composer-fx-btn ${composerEffect ? 'on' : ''}" id="composer-fx-btn" title="VYRO+ message effect: ${composerEffect || 'off'}">✨${composerEffect ? `<small>${escapeHtml(composerEffect)}</small>` : ''}</button>`
            : ''
        }
        <button type="button" class="composer-icon-btn" id="voice-rec-btn" title="Record Voice Note">${ICONS.mic}</button>
        <button type="submit" class="composer-send-circle" title="Send">${ICONS.send}</button>
      </form>
    </div>
  `;
}

function renderMessageRowHtml(m, viewerId, viewerIsPlus = false) {
  if (m.kind === 'system') {
    return `<div class="msg-row system-row">${escapeHtml(m.content)} • ${formatTime(m.createdAt)}</div>`;
  }
  const author = m.author || { displayName: 'Unknown', username: 'unknown', discriminator: '0000' };
  const isMine = m.authorId === viewerId;
  const rowClasses = ['msg-row'];
  if (m.isSaved) rowClasses.push('saved-snap');
  else if (m.isEphemeral || m.expiresAt > 0) rowClasses.push('ephemeral-msg');

  let bodyHtml = '';
  if (m.kind === 'snap') {
    const canReplay = !m.viewerReplayed || isMine || m.isSaved;
    const isOpened = m.viewerOpened && !isMine && !m.isSaved;
    const ttl = m.snapMeta?.timerSec || m.ttlSec || 6;
    bodyHtml = `
      <div class="snap-card ${isOpened ? 'opened' : ''}" data-open-snap="${escapeHtml(m.id)}">
        <div class="snap-card-icon">${isOpened ? '◇' : '▶'}</div>
        <div class="snap-card-info">
          <strong>${isMine ? 'Sent Snap' : isOpened ? (canReplay ? 'Opened • Tap to Replay' : 'Opened') : 'New Snap • Tap to Play'}</strong>
          <span>${ttl ? `${ttl}s timer` : 'Keep'} ${m.snapMeta?.caption ? `• "${escapeHtml(m.snapMeta.caption)}"` : ''}</span>
        </div>
      </div>
    `;
  } else if (m.kind === 'voice') {
    bodyHtml = `<div class="voice-note-card"><span>🎙️ Voice</span><audio controls src="${escapeHtml(m.mediaData)}"></audio></div>`;
  } else if (m.kind === 'sticker') {
    bodyHtml = stickerHtml(m.content) || `<div class="msg-bubble">${escapeHtml(m.content)}</div>`;
  } else {
    const fx = PLUS_EFFECTS.includes(m.effect) ? ` fx-${m.effect}` : '';
    bodyHtml = `<div class="msg-bubble ${isMine ? 'mine' : ''}${fx}"${m.effect === 'confetti' ? ` data-confetti="${escapeHtml(m.id)}" data-created="${Number(m.createdAt) || 0}"` : ''}>${formatInlineMarkdown(m.content)}</div>`;
  }

  const reactionEntries = Object.entries(m.reactions || {});
  const reactionsHtml = reactionEntries.length
    ? `<div class="msg-reactions">
        ${reactionEntries
          .map(
            ([emoji, uids]) => `
          <button type="button" class="reaction-chip ${uids.includes(viewerId) ? 'mine' : ''}" data-react-msg="${escapeHtml(m.id)}" data-emoji="${escapeHtml(emoji)}">
            <span class="${PLUS_REACTIONS.includes(emoji) ? 'plus-react-emoji' : ''}">${escapeHtml(emoji)}</span><span>${uids.length}</span>
          </button>
        `
          )
          .join('')}
      </div>`
    : '';

  return `
    <div class="${rowClasses.join(' ')}" data-msg-id="${escapeHtml(m.id)}">
      <div>${renderAvatarHtml(author, 36)}</div>
      <div style="min-width:0;">
        <div class="msg-header">
          ${
            isPlus(author)
              ? `<span class="msg-author">${renderNameHtml(author, { labels: true })}</span>`
              : `<span class="msg-author" style="color:${isMine ? '#D8B4FE' : '#fff'};">${escapeHtml(author.displayName)}</span>`
          }
          ${author.isBot ? `<span class="msg-bot-tag">BOT</span>` : ''}
          <span class="msg-time">${formatTime(m.createdAt)}</span>
          ${m.isSaved ? `<span class="msg-saved-pill">Saved</span>` : ''}
          ${m.isPinned ? `<span class="msg-saved-pill">📌 Pinned</span>` : ''}
          ${m.expiresAt > 0 && !m.isSaved ? `<span class="msg-ttl-pill">⏱ Disappears</span>` : ''}
        </div>
        ${
          m.replyTo
            ? `<div class="msg-reply-ref">↩ <strong>${escapeHtml(m.replyTo.authorName)}</strong>: ${escapeHtml((m.replyTo.content || 'Snap').slice(0, 60))}</div>`
            : ''
        }
        ${bodyHtml}
        ${reactionsHtml}
      </div>
      <div class="msg-actions">
        ${['🔥', '😂', '❤️', '⚡'].map((em) => `<button type="button" class="msg-act-btn" data-react-msg="${escapeHtml(m.id)}" data-emoji="${em}">${em}</button>`).join('')}
        ${viewerIsPlus ? PLUS_REACTIONS.map((em) => `<button type="button" class="msg-act-btn plus-react" data-react-msg="${escapeHtml(m.id)}" data-emoji="${em}" title="VYRO+ reaction">${em}</button>`).join('') : ''}
        <button type="button" class="msg-act-btn" data-reply-msg="${escapeHtml(m.id)}" title="Reply">${ICONS.reply}</button>
        <button type="button" class="msg-act-btn" data-save-msg="${escapeHtml(m.id)}" title="Save in Chat">${ICONS.bookmark}</button>
        ${isMine ? `<button type="button" class="msg-act-btn" data-del-msg="${escapeHtml(m.id)}" title="Delete">${ICONS.trash}</button>` : ''}
      </div>
    </div>
  `;
}

function renderRightWidgetsHtml(activeServer, track, pool, voiceChannel) {
  const allUsers = Array.from(pool.values());
  const onlineUsers = allUsers.filter((u) => u.presence !== 'offline');

  const inThisVc = state.voiceState[state.myVoiceChannelId || voiceChannel.id] || [];
  const connected = Boolean(state.myVoiceChannelId);

  return `
    <div class="online-now-card">
      <div class="widget-head">
        <span><span style="color:var(--status-online);">●</span> Online Now</span>
        <span class="badge-pill" style="background:rgba(255,255,255,0.06);color:var(--text-secondary);">${onlineUsers.length}</span>
      </div>
      <div class="online-list-scroll">
        ${onlineUsers
          .map(
            (u) => `
          <button class="member-item" data-inspect-user="${escapeHtml(u.id)}">
            ${renderAvatarHtml(u, 32, true)}
            <div style="flex:1;min-width:0;">
              <div class="member-name" style="color:${u.role === 'owner' ? '#D8B4FE' : 'var(--text-primary)'};">${renderNameHtml(u, { badgeSize: 13 })}</div>
              <div class="member-sub">${escapeHtml(u.statusText || u.presence)}</div>
            </div>
            ${u.role === 'owner' ? '<span title="Owner">👑</span>' : ''}
          </button>
        `
          )
          .join('')}
      </div>
    </div>

    <div class="voice-widget-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="font-weight:800;font-size:13.5px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          <span style="color:var(--status-online);">●</span> ${escapeHtml(voiceChannel.name)}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--text-muted);">${inThisVc.length} online</span>
          <button class="dock-icon-btn" id="open-voice-stage-btn" title="Expand Voice Stage">${ICONS.maximize}</button>
        </div>
      </div>
      <div class="voice-avatars-row">
        ${
          inThisVc.length
            ? inThisVc
                .map((p) => renderAvatarHtml(pool.get(p.userId) || { displayName: 'User' }, 30, true))
                .join('')
            : `<span class="field-hint">Hop in to talk live with your squad</span>`
        }
      </div>
      ${
        connected
          ? `<div class="voice-controls">
              <button class="vc-btn ${state.voiceMuted ? 'active' : ''}" id="vc-mute-btn" title="Mute">${state.voiceMuted ? '🔇' : '🎙️'}</button>
              <button class="vc-btn ${state.voiceDeafened ? 'active' : ''}" id="vc-deaf-btn" title="Deafen">${state.voiceDeafened ? '🔕' : '🎧'}</button>
              <button class="vc-btn ${state.voiceCamera ? 'active' : ''}" id="vc-cam-btn" title="Camera">📷</button>
            </div>`
          : ''
      }
      <button class="voice-join-pill ${connected ? 'connected' : ''}" id="voice-widget-btn" data-vc-id="${escapeHtml(voiceChannel.id)}">
        <span>${connected ? 'Leave Voice' : 'Join Voice'}</span>
      </button>
    </div>

    <div class="music-widget-card">
      <div class="music-cover" id="music-next-btn" title="Click for next track" style="cursor:pointer;">
        ${musicPlaying ? '<div class="eq-bars"><span></span><span></span><span></span></div>' : ICONS.music}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(track.title)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(track.artist)} • ${musicPlaying ? 'Playing' : 'Paused'}</div>
      </div>
      <button class="tb-icon-btn" id="music-toggle-btn" title="Play / Pause Ambient Audio" style="width:32px;height:32px;">
        ${musicPlaying ? '⏸' : '▶'}
      </button>
    </div>
  `;
}

function wireWorkspaceEvents(
  container,
  { wsClient, loadAllData, loadMessages, activeServer, currentScopeType, currentScopeId, voiceChannel, wasInputFocused, wasSearchFocused, selStart, selEnd, prevTtl }
) {
  const scrollEl = container.querySelector('#messages-feed');
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

  const ttlEl = container.querySelector('#msg-ttl-select');
  if (ttlEl && prevTtl !== undefined) ttlEl.value = prevTtl;

  const restoredInput = container.querySelector('#msg-input');
  if (restoredInput) {
    if (draftMessageText) restoredInput.value = draftMessageText;
    if (wasInputFocused) {
      restoredInput.focus();
      if (selStart !== null && selEnd !== null) {
        try { restoredInput.setSelectionRange(selStart, selEnd); } catch {}
      }
    }
  }

  const searchEl = container.querySelector('#global-vyro-search');
  if (searchEl) {
    if (wasSearchFocused) {
      searchEl.focus();
      try { searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length); } catch {}
    }
    searchEl.oninput = () => {
      searchQuery = searchEl.value;
      setState({ searchTick: Date.now() });
    };
  }

  // Attach live camera stream to stage preview if camera is on
  const stageVideo = container.querySelector('#vc-local-video-preview');
  if (stageVideo && voiceCamStream) {
    stageVideo.srcObject = voiceCamStream;
  }

  // Update stage timer text gently when visible
  clearInterval(voiceTimerHandle);
  if (state.myVoiceChannelId && voiceJoinStartedAt && container.querySelector('#vc-stage-timer')) {
    voiceTimerHandle = setInterval(() => {
      const el = document.getElementById('vc-stage-timer');
      if (el) el.textContent = formatCallDuration(voiceJoinStartedAt);
    }, 1000);
  }

  const openDmWithUser = async (userId, autoMessage = null) => {
    let res;
    try {
      res = await api('/api/dms/open', { method: 'POST', body: { userId } });
    } catch (err) {
      toast(err.message || 'Could not open that chat.', 'error');
      return;
    }
    if (autoMessage) {
      await api('/api/messages', {
        method: 'POST',
        body: { scopeType: 'dm', scopeId: res.dmId, kind: 'text', content: autoMessage }
      });
    }
    await loadAllData();
    setState({ viewScope: 'home', navSection: 'messages', activeDmId: res.dmId, activeFriend: res.user, mobileTab: 'chat' });
    await loadMessages('dm', res.dmId);
  };

  const toggleVoiceConnection = (vcId) => {
    playChime('voice');
    if (state.myVoiceChannelId) {
      wsClient.send('voice:leave', {});
      stopVoiceCameraStream();
      voiceJoinStartedAt = null;
      setState({ myVoiceChannelId: null, voiceCamera: false });
    } else {
      voiceJoinStartedAt = Date.now();
      wsClient.send('voice:join', { channelId: vcId, muted: state.voiceMuted, deafened: state.voiceDeafened, camera: state.voiceCamera });
      setState({ myVoiceChannelId: vcId });
      toast('Connected to Voice Stage!', 'success');
    }
  };

  const toggleVoiceCamera = async () => {
    const next = !state.voiceCamera;
    if (next) {
      try {
        voiceCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      } catch {
        toast('No camera found — audio tile remains active', 'info');
      }
    } else {
      stopVoiceCameraStream();
    }
    setState({ voiceCamera: next });
    wsClient.send('voice:update', { camera: next });
  };

  container.querySelector('#win-min')?.addEventListener('click', () => window.vyroDesktop?.minimize());
  container.querySelector('#win-max')?.addEventListener('click', () => window.vyroDesktop?.maximize());
  container.querySelector('#win-close')?.addEventListener('click', () => window.vyroDesktop?.close());
  container.querySelector('#tb-qr-btn')?.addEventListener('click', openMobileQrModal);
  container.querySelector('#hero-qr-btn')?.addEventListener('click', openMobileQrModal);
  container.querySelector('#empty-fr-qr')?.addEventListener('click', openMobileQrModal);
  container.querySelector('#tb-notif-btn')?.addEventListener('click', () => setState({ navSection: 'friends', viewScope: 'home', activeDmId: null }));
  container.querySelector('#tb-friends-btn')?.addEventListener('click', () => setState({ navSection: 'friends', viewScope: 'home', activeDmId: null }));

  container.querySelector('#toggle-hero-btn')?.addEventListener('click', () => {
    heroCollapsed = !heroCollapsed;
    setState({ heroTick: Date.now() });
  });

  const openSettings = (tab = 'profile') =>
    openSettingsAndUpdatesModal(
      loadAllData,
      async () => {
        stopVoiceCameraStream();
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        wsClient.disconnect();
        setToken('');
        setState({ user: null, route: 'auth', authTab: 'login', myVoiceChannelId: null });
        location.hash = '#/login';
      },
      tab
    );

  container.querySelector('#tb-upd-btn')?.addEventListener('click', () => openSettings('updates'));
  container.querySelector('#rail-updates-btn')?.addEventListener('click', () => openSettings('updates'));
  container.querySelector('#rail-settings-btn')?.addEventListener('click', () => openSettings('profile'));
  container.querySelector('#rail-plus-btn')?.addEventListener('click', () => openSettings('plus'));
  container.querySelector('#rail-live-btn')?.addEventListener('click', () => openLiveHub({ wsClient, openSettings }));
  container.querySelector('#mobile-live-btn')?.addEventListener('click', () => openLiveHub({ wsClient, openSettings }));
  container.querySelector('#open-my-settings')?.addEventListener('click', () => openSettings('profile'));
  container.querySelector('#mobile-profile-btn')?.addEventListener('click', () => openSettings('profile'));

  container.querySelector('#hero-voice-btn')?.addEventListener('click', () => setState({ navSection: 'voice', viewScope: 'home' }));
  container.querySelector('#open-voice-stage-btn')?.addEventListener('click', () => setState({ navSection: 'voice', viewScope: 'home' }));

  container.querySelectorAll('[data-rail-nav]').forEach((btn) => {
    btn.onclick = () => {
      const target = btn.dataset.railNav;
      if (target === 'communities') {
        const srv = state.servers[0];
        const ch = srv?.channels.find((c) => c.type !== 'voice');
        setState({
          navSection: 'communities',
          viewScope: 'server',
          activeServerId: state.activeServerId || srv?.id || null,
          activeChannelId: state.activeChannelId || ch?.id || null
        });
        if (ch) loadMessages('channel', state.activeChannelId || ch.id);
      } else {
        setState({ navSection: target, viewScope: 'home' });
      }
    };
  });

  container.querySelectorAll('[data-srv-id]').forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.srvId;
      const srv = state.servers.find((s) => s.id === sid);
      const firstText = srv?.channels.find((c) => c.type !== 'voice') || null;
      setState({ navSection: 'communities', viewScope: 'server', activeServerId: sid, activeChannelId: firstText?.id || null, mobileTab: 'chat' });
      if (firstText) await loadMessages('channel', firstText.id);
    };
  });

  container.querySelectorAll('[data-srv-open]').forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.srvOpen;
      const srv = state.servers.find((s) => s.id === sid);
      const firstText = srv?.channels.find((c) => c.type !== 'voice') || null;
      setState({ navSection: 'communities', viewScope: 'server', activeServerId: sid, activeChannelId: firstText?.id || null });
      if (firstText) await loadMessages('channel', firstText.id);
    };
  });

  container.querySelectorAll('[data-copy-invite]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const code = btn.dataset.copyInvite;
      navigator.clipboard?.writeText(code);
      toast(`Copied invite code: ${code}`, 'success');
    };
  });
  container.querySelector('#vc-copy-invite')?.addEventListener('click', (e) => {
    const code = e.currentTarget.dataset.code;
    navigator.clipboard?.writeText(code);
    toast(`Copied invite code: ${code}`, 'success');
  });

  container.querySelector('#rail-add-srv')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#disc-join-btn')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#empty-disc-create')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#empty-fr-srv')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#add-channel-btn')?.addEventListener('click', () => {
    if (activeServer) openCreateChannelModal(activeServer.id, loadAllData);
  });

  container.querySelectorAll('[data-ch-id]').forEach((btn) => {
    btn.onclick = async () => {
      const chId = btn.dataset.chId;
      const type = btn.dataset.chType;
      if (type === 'voice') {
        toggleVoiceConnection(chId);
        return;
      }
      setState({ navSection: 'communities', activeChannelId: chId, mobileTab: 'chat', replyTo: null });
      await loadMessages('channel', chId);
    };
  });

  container.querySelector('#open-add-friend')?.addEventListener('click', () => openAddFriendModal(loadAllData));
  container.querySelector('#empty-list-add-fr')?.addEventListener('click', () => openAddFriendModal(loadAllData));
  container.querySelector('#empty-fr-add')?.addEventListener('click', () => openAddFriendModal(loadAllData));
  container.querySelector('#stage-invite-btn')?.addEventListener('click', () => openAddFriendModal(loadAllData));
  container.querySelector('#hdr-add-friend')?.addEventListener('click', () => openAddFriendModal(loadAllData));
  container.querySelector('#hdr-add-friend-2')?.addEventListener('click', () => openAddFriendModal(loadAllData));

  container.querySelectorAll('[data-dm-id]').forEach((btn) => {
    btn.onclick = async () => {
      const dmId = btn.dataset.dmId;
      const fr = state.friends.find((f) => f.dmId === dmId);
      setState({ viewScope: 'home', navSection: 'home', activeDmId: dmId, activeFriend: fr?.user || null, mobileTab: 'chat', replyTo: null });
      await loadMessages('dm', dmId);
    };
  });

  container.querySelectorAll('[data-open-dm]').forEach((btn) => {
    btn.onclick = async () => {
      const dmId = btn.dataset.openDm;
      const fr = state.friends.find((f) => f.dmId === dmId);
      setState({ viewScope: 'home', navSection: 'home', activeDmId: dmId, activeFriend: fr?.user || null, mobileTab: 'chat' });
      await loadMessages('dm', dmId);
    };
  });

  container.querySelectorAll('[data-fr-act]').forEach((btn) => {
    btn.onclick = async () => {
      await api('/api/friends/respond', { method: 'POST', body: { friendshipId: btn.dataset.frId, action: btn.dataset.frAct } });
      await loadAllData();
    };
  });

  container.querySelector('#voice-widget-btn')?.addEventListener('click', (e) => toggleVoiceConnection(e.currentTarget.dataset.vcId));
  container.querySelector('#stage-join-btn')?.addEventListener('click', (e) => toggleVoiceConnection(e.currentTarget.dataset.vcId));
  container.querySelector('#stage-join-cta')?.addEventListener('click', (e) => toggleVoiceConnection(e.currentTarget.dataset.vcId));
  container.querySelector('#stage-leave-btn')?.addEventListener('click', (e) => toggleVoiceConnection(e.currentTarget.dataset.vcId));
  container.querySelector('#hdr-voice-quick')?.addEventListener('click', () => {
    if (!state.myVoiceChannelId) toggleVoiceConnection(voiceChannel.id);
    setState({ navSection: 'voice', viewScope: 'home' });
  });

  const toggleMute = () => {
    const next = !state.voiceMuted;
    setState({ voiceMuted: next });
    wsClient.send('voice:update', { muted: next });
  };
  const toggleDeaf = () => {
    const next = !state.voiceDeafened;
    setState({ voiceDeafened: next });
    wsClient.send('voice:update', { deafened: next });
  };

  container.querySelector('#vc-mute-btn')?.addEventListener('click', toggleMute);
  container.querySelector('#stage-mute-btn')?.addEventListener('click', toggleMute);
  container.querySelector('#vc-deaf-btn')?.addEventListener('click', toggleDeaf);
  container.querySelector('#stage-deaf-btn')?.addEventListener('click', toggleDeaf);
  container.querySelector('#vc-cam-btn')?.addEventListener('click', toggleVoiceCamera);
  container.querySelector('#stage-cam-btn')?.addEventListener('click', toggleVoiceCamera);
  container.querySelector('#stage-blur-btn')?.addEventListener('click', () => {
    voiceCamBlur = !voiceCamBlur;
    setState({ voiceTick: Date.now() });
  });

  container.querySelector('#music-toggle-btn')?.addEventListener('click', () => {
    toggleMusicPlayer(() => setState({ musicTick: Date.now() }));
  });
  container.querySelector('#music-next-btn')?.addEventListener('click', () => {
    musicTrackIdx = (musicTrackIdx + 1) % MUSIC_TRACKS.length;
    setState({ musicTick: Date.now() });
  });

  container.querySelector('#add-story-btn')?.addEventListener('click', () => openSnapStudioModal({ defaultTarget: 'story', onSent: loadAllData }));
  container.querySelector('#add-story-btn-2')?.addEventListener('click', () => openSnapStudioModal({ defaultTarget: 'story', onSent: loadAllData }));
  container.querySelector('#empty-story-create-btn')?.addEventListener('click', () => openSnapStudioModal({ defaultTarget: 'story', onSent: loadAllData }));
  container.querySelectorAll('[data-story-group]').forEach((btn) => {
    btn.onclick = () =>
      openStoryViewer(Number(btn.dataset.storyGroup), state.storyGroups, {
        onRefresh: loadAllData,
        onReplyDm: openDmWithUser
      });
  });

  container.querySelector('#toggle-members-btn')?.addEventListener('click', () => {
    if (window.innerWidth <= 980) container.querySelector('#member-pane')?.classList.toggle('open');
    else setState({ showMembersPane: !state.showMembersPane });
  });
  container.querySelector('#mobile-back-list')?.addEventListener('click', () => {
    setState({ mobileTab: state.viewScope === 'server' ? 'servers' : 'chats' });
  });

  container.querySelectorAll('[data-inspect-user]').forEach((btn) => {
    btn.onclick = () => {
      const uid = btn.dataset.inspectUser;
      const member =
        activeServer?.members.find((m) => m.id === uid) ||
        state.friends.find((f) => f.user.id === uid)?.user ||
        (state.user.id === uid ? state.user : null);
      if (member) openUserProfileModal(member, openDmWithUser);
    };
  });

  const launchSnap = () =>
    openSnapStudioModal({
      defaultTarget: currentScopeId ? 'current' : 'story',
      onSent: async () => {
        await loadAllData();
        if (currentScopeType && currentScopeId) await loadMessages(currentScopeType, currentScopeId);
      }
    });

  container.querySelector('#open-snap-studio')?.addEventListener('click', launchSnap);
  container.querySelector('#empty-open-snap')?.addEventListener('click', launchSnap);
  container.querySelector('#hero-snap-btn')?.addEventListener('click', launchSnap);
  container.querySelector('#hdr-snap-quick')?.addEventListener('click', launchSnap);
  container.querySelector('#mobile-snap-fab')?.addEventListener('click', launchSnap);

  container.querySelectorAll('[data-mtab]').forEach((b) => {
    b.onclick = () => setState({ mobileTab: b.dataset.mtab });
  });

  container.querySelector('#cancel-reply-btn')?.addEventListener('click', () => setState({ replyTo: null }));

  const msgInput = container.querySelector('#msg-input');
  if (msgInput && currentScopeType && currentScopeId) {
    msgInput.oninput = () => {
      draftMessageText = msgInput.value;
      wsClient.send('typing:start', { scopeType: currentScopeType, scopeId: currentScopeId });
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        wsClient.send('typing:stop', { scopeType: currentScopeType, scopeId: currentScopeId });
      }, 1500);
    };
  }

  container.querySelector('#composer-emoji-btn')?.addEventListener('click', () => {
    emojiTrayOpen = !emojiTrayOpen;
    setState({ emojiTick: Date.now() });
  });

  container.querySelector('#composer-fx-btn')?.addEventListener('click', () => {
    const order = ['', ...PLUS_EFFECTS];
    composerEffect = order[(order.indexOf(composerEffect) + 1) % order.length];
    toast(composerEffect ? `Next message: ${composerEffect} effect ✨` : 'Message effect off', 'info', 1600);
    setState({ emojiTick: Date.now() });
  });

  container.querySelectorAll('[data-send-sticker]').forEach((btn) => {
    btn.onclick = async () => {
      if (!currentScopeType || !currentScopeId) return;
      emojiTrayOpen = false;
      try {
        await api('/api/messages', {
          method: 'POST',
          body: { scopeType: currentScopeType, scopeId: currentScopeId, kind: 'sticker', content: btn.dataset.sendSticker, ttlSec: 0 }
        });
      } catch (err) {
        toast(err.message, 'error');
      }
      setState({ emojiTick: Date.now() });
    };
  });

  container.querySelectorAll('[data-open-plus]').forEach((btn) => {
    btn.onclick = () => {
      emojiTrayOpen = false;
      openSettings('plus');
    };
  });

  // Confetti plays once, only for messages that just arrived.
  container.querySelectorAll('[data-confetti]').forEach((el) => {
    const id = el.dataset.confetti;
    if (burstSeen.has(id)) return;
    burstSeen.add(id);
    if (Date.now() - Number(el.dataset.created || 0) < 15000) setTimeout(() => burstConfetti(el), 60);
  });

  container.querySelectorAll('[data-insert-emoji]').forEach((btn) => {
    btn.onclick = () => {
      const em = btn.dataset.insertEmoji;
      draftMessageText = (draftMessageText || '') + em;
      emojiTrayOpen = false;
      setState({ emojiTick: Date.now() });
      setTimeout(() => document.getElementById('msg-input')?.focus(), 0);
    };
  });

  container.querySelectorAll('[data-quick-say]').forEach((btn) => {
    btn.onclick = async () => {
      if (!currentScopeType || !currentScopeId) return;
      try {
        await api('/api/messages', {
          method: 'POST',
          body: { scopeType: currentScopeType, scopeId: currentScopeId, kind: 'text', content: btn.dataset.quickSay, ttlSec: 0 }
        });
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });

  container.querySelector('#composer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = msgInput.value.trim();
    if (!content || !currentScopeType || !currentScopeId) return;
    const ttlSec = Number(container.querySelector('#msg-ttl-select').value || 0);
    msgInput.value = '';
    draftMessageText = '';
    emojiTrayOpen = false;
    wsClient.send('typing:stop', { scopeType: currentScopeType, scopeId: currentScopeId });
    try {
      await api('/api/messages', {
        method: 'POST',
        body: { scopeType: currentScopeType, scopeId: currentScopeId, kind: 'text', content, ttlSec, replyToId: state.replyTo?.id || '', effect: composerEffect || undefined }
      });
      composerEffect = '';
      setState({ replyTo: null });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const voiceBtn = container.querySelector('#voice-rec-btn');
  if (voiceBtn && currentScopeType && currentScopeId) {
    voiceBtn.onclick = async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        voiceBtn.classList.remove('recording');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) audioChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = async () => {
            await api('/api/messages', {
              method: 'POST',
              body: { scopeType: currentScopeType, scopeId: currentScopeId, kind: 'voice', content: 'Voice Note', mediaData: reader.result }
            });
            toast('Voice note sent!', 'success');
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        voiceBtn.classList.add('recording');
        toast('Recording voice note... click mic again to send', 'info');
      } catch {
        toast('Microphone access unavailable on this device.', 'error');
      }
    };
  }

  container.querySelectorAll('[data-open-snap]').forEach((el) => {
    el.onclick = () => {
      const msg = state.messages.find((m) => m.id === el.dataset.openSnap);
      if (!msg) return;
      openSnapViewer(msg, {
        onSnapUpdated: async () => {
          await loadAllData();
          if (currentScopeType && currentScopeId) await loadMessages(currentScopeType, currentScopeId);
        },
        onSnapBack: launchSnap
      });
    };
  });

  container.querySelectorAll('[data-react-msg]').forEach((el) => {
    el.onclick = () => api(`/api/messages/${el.dataset.reactMsg}/react`, { method: 'POST', body: { emoji: el.dataset.emoji } });
  });
  container.querySelectorAll('[data-save-msg]').forEach((el) => {
    el.onclick = () => api(`/api/messages/${el.dataset.saveMsg}/save`, { method: 'POST' });
  });
  container.querySelectorAll('[data-del-msg]').forEach((el) => {
    el.onclick = () => api(`/api/messages/${el.dataset.delMsg}`, { method: 'DELETE' });
  });
  container.querySelectorAll('[data-reply-msg]').forEach((el) => {
    el.onclick = () => {
      const m = state.messages.find((x) => x.id === el.dataset.replyMsg);
      if (m) setState({ replyTo: m });
    };
  });

  // Ctrl/Cmd + K global spotlight search focus
  if (!window.__vyroKeyHooked) {
    window.__vyroKeyHooked = true;
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const input = document.getElementById('global-vyro-search');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    });
  }
}
