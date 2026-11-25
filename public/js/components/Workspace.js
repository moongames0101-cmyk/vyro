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
import { openSnapViewer, openStoryViewer } from './Viewers.js';

let typingTimeout = null;
let mediaRecorder = null;
let audioChunks = [];
let draftMessageText = '';
let searchQuery = '';

const MUSIC_TRACKS = [
  { title: 'Nightfall', artist: 'VYRO Music', freq: 220 },
  { title: 'Cyber Halo', artist: 'VYRO Synth', freq: 261.6 },
  { title: 'Golden Streak', artist: 'VYRO Chill', freq: 196 }
];
let musicPlaying = false;
let musicTrackIdx = 0;
let musicTimer = null;
let musicCtx = null;

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
    const playNote = () => {
      if (!musicPlaying || !musicCtx) return;
      const base = MUSIC_TRACKS[musicTrackIdx].freq;
      const ratios = [1, 1.2, 1.5, 1.8];
      const f = base * ratios[Math.floor(Math.random() * ratios.length)];
      const osc = musicCtx.createOscillator();
      const gain = musicCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, musicCtx.currentTime);
      gain.gain.setValueAtTime(0.001, musicCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, musicCtx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, musicCtx.currentTime + 0.9);
      osc.connect(gain);
      gain.connect(musicCtx.destination);
      osc.start();
      osc.stop(musicCtx.currentTime + 0.95);
    };
    playNote();
    musicTimer = setInterval(playNote, 900);
  } catch {}
  onUpdate?.();
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
  const navTab = state.navSection || (state.viewScope === 'server' ? 'communities' : 'home');

  const totalXp = (user.snapScore || 0) * 15 + 450;
  const level = Math.floor(totalXp / 500) + 1;
  const xpInLevel = totalXp % 500;
  const xpPct = Math.round((xpInLevel / 500) * 100);
  const track = MUSIC_TRACKS[musicTrackIdx];

  container.innerHTML = `
    <div class="app-shell">
      <div class="vyro-titlebar">
        <div class="titlebar-left">
          <div class="live-sync-pill">
            <span class="live-dot ${state.wsConnected ? '' : 'reconnecting'}"></span>
            <span style="color:${state.wsConnected ? '#86EFAC' : '#FCD34D'};">${state.wsConnected ? 'Live' : 'Syncing'}</span>
          </div>
        </div>

        <div class="global-search-wrap">
          <span class="global-search-icon">${ICONS.search}</span>
          <input class="global-search-input" id="global-vyro-search" placeholder="Search friends, servers, or messages..." value="${escapeHtml(searchQuery)}" />
        </div>

        <div class="titlebar-right">
          ${
            state.updateInfo?.updateAvailable || state.desktopUpdateState?.stage === 'ready'
              ? `<button class="btn btn-primary btn-sm" id="tb-upd-btn" style="padding:5px 11px;font-size:11.5px;">${ICONS.sparkles} Update Available</button>`
              : `<button class="tb-icon-btn" id="tb-upd-btn" title="Check for Updates">${ICONS.refresh}</button>`
          }
          <button class="tb-icon-btn" id="tb-qr-btn" title="Connect Mobile via QR">${ICONS.qr}</button>
          <button class="tb-icon-btn" id="tb-notif-btn" title="Notifications">${ICONS.bell}${unreadSnapsTotal > 0 ? `<span class="tb-notif-badge">${unreadSnapsTotal}</span>` : ''}</button>
          <button class="tb-icon-btn" id="tb-friends-btn" title="Friends">${ICONS.users}</button>
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
      </div>

      <div class="app-workspace ${!state.showMembersPane ? 'hide-members' : ''} mobile-tab-${state.mobileTab}">
        <aside class="vyro-left-rail">
          <div>
            <div class="rail-brand-header">
              <img src="/assets/icon-192.png" alt="VYRO" />
              <div class="rail-brand-word">VYRO</div>
            </div>
            <nav class="rail-nav-list">
              <button class="rail-nav-btn ${navTab === 'home' ? 'active' : ''}" data-rail-nav="home">${ICONS.home}<span>Home</span></button>
              <button class="rail-nav-btn ${navTab === 'discover' ? 'active' : ''}" data-rail-nav="discover">${ICONS.compass}<span>Discover</span></button>
              <button class="rail-nav-btn ${navTab === 'messages' ? 'active' : ''}" data-rail-nav="messages">${ICONS.message}<span>Messages</span>${unreadSnapsTotal > 0 ? `<span class="rail-nav-badge">${unreadSnapsTotal}</span>` : ''}</button>
              <button class="rail-nav-btn ${navTab === 'friends' ? 'active' : ''}" data-rail-nav="friends">${ICONS.users}<span>Friends</span></button>
              <button class="rail-nav-btn ${navTab === 'communities' ? 'active' : ''}" data-rail-nav="communities">${ICONS.globe}<span>Communities</span></button>
              <button class="rail-nav-btn" id="rail-updates-btn">${ICONS.refresh}<span>Updates</span>${state.updateInfo?.updateAvailable || state.desktopUpdateState?.stage === 'ready' ? `<span class="rail-nav-badge" style="background:var(--vyro-gold);color:#090910;">NEW</span>` : ''}</button>
              <button class="rail-nav-btn" id="rail-settings-btn">${ICONS.settings}<span>Settings</span></button>
            </nav>
          </div>

          <div class="rail-bottom-stack">
            <div class="level-xp-card">
              <div class="level-xp-top">
                <span>Level ${level}</span>
                <span style="color:var(--vyro-gold);">👻 ${user.snapScore}</span>
              </div>
              <div class="xp-track"><div class="xp-fill" style="width:${xpPct}%;"></div></div>
              <div class="xp-sub">${xpInLevel} / 500 XP</div>
            </div>

            <div class="rail-user-card" id="open-my-settings">
              <div style="display:flex;align-items:center;gap:9px;min-width:0;">
                ${renderAvatarHtml(user, 34, true)}
                <div style="min-width:0;">
                  <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(user.displayName)}</div>
                  <div style="font-size:11px;color:var(--status-online);">Online</div>
                </div>
              </div>
              <span style="color:var(--text-muted);font-weight:700;">›</span>
            </div>
          </div>
        </aside>

        <section class="center-glass-frame">
          <div class="hero-welcome-banner">
            <div class="hero-welcome-left">
              <div class="hero-accent-bars"><span></span><span></span></div>
              <div>
                <div class="hero-welcome-title">Welcome back, ${escapeHtml(user.displayName)}</div>
                <div class="hero-welcome-sub">Good to see you again! Drop a Snap or hop in Voice.</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;z-index:2;" class="hide-sm">
              <button class="btn btn-secondary btn-sm" id="hero-snap-btn">📸 New Snap</button>
              <button class="btn btn-primary btn-sm" id="hero-qr-btn">${ICONS.qr} Mobile Connect</button>
            </div>
          </div>

          <div class="stories-strip">
            <button class="story-bubble-btn" id="add-story-btn">
              <div class="story-ring add-story">
                <div class="story-ring-inner" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--vyro-gold);">+</div>
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
              ${state.friends
                .filter((f) => !searchQuery || f.user.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((f) => {
                  const active = state.viewScope === 'home' && state.activeDmId === f.dmId;
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
                          <span class="dm-name">${escapeHtml(f.user.displayName)}</span>
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
                                return `
                                  <button class="channel-row ${chActive ? 'active' : ''}" data-ch-id="${escapeHtml(ch.id)}" data-ch-type="${escapeHtml(ch.type)}">
                                    <span>${icon} ${escapeHtml(ch.name)}</span>
                                    ${ch.type === 'ephemeral' ? `<span class="channel-ttl-tag">${ch.defaultTtlSec}s</span>` : ''}
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
              ${renderInnerChatHtml(navTab, activeServer, activeChannel, activeFriendEntry, currentScopeType, currentScopeId)}
            </div>
          </div>
        </section>

        ${
          state.showMembersPane
            ? `<aside class="right-widget-col" id="member-pane">${renderRightWidgetsHtml(activeServer, track)}</aside>`
            : ''
        }
      </div>

      <nav class="mobile-nav-bar">
        <button class="mobile-nav-btn ${state.mobileTab === 'chats' ? 'active' : ''}" data-mtab="chats"><span>💬</span><span>DMs</span></button>
        <button class="mobile-nav-btn ${state.mobileTab === 'servers' ? 'active' : ''}" data-mtab="servers"><span>🌐</span><span>Rooms</span></button>
        <button class="mobile-nav-btn" id="mobile-snap-fab"><div class="mobile-snap-fab">📸</div></button>
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
    wasInputFocused,
    wasSearchFocused,
    selStart,
    selEnd,
    prevTtl
  });
}

function renderInnerChatHtml(navTab, activeServer, activeChannel, activeFriendEntry, currentScopeType, currentScopeId) {
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
            : `<div class="dir-card">No stories yet — tap <strong>+ New Story</strong> to share a 24h story!</div>`
        }
      </div>
    `;
  }

  if (navTab === 'discover') {
    return `
      <div class="chat-header">
        <div class="chat-header-left"><span class="chat-header-title">🧭 Discover VYRO Communities</span></div>
        <button class="btn btn-primary btn-sm" id="disc-join-btn">+ Join by Invite</button>
      </div>
      <div class="friends-directory">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
          ${state.servers
            .map(
              (s) => `
            <div class="dir-card" style="display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="comm-icon-badge" style="background:${escapeHtml(s.iconColor)};width:36px;height:36px;">${escapeHtml(s.iconEmoji)}</span>
                <div>
                  <div style="font-weight:800;">${escapeHtml(s.name)}</div>
                  <div class="field-hint">${s.members.length} members • Code: <code>${escapeHtml(s.inviteCode)}</code></div>
                </div>
              </div>
              <div class="field-hint">${escapeHtml(s.description)}</div>
              <button class="btn btn-secondary btn-sm" data-srv-open="${escapeHtml(s.id)}">Enter Community →</button>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (navTab === 'friends' || !currentScopeId) {
    return `
      <div class="chat-header">
        <div class="chat-header-left"><span class="chat-header-title">👥 Friends &amp; Snap Streaks</span></div>
        <button class="btn btn-primary btn-sm" id="hdr-add-friend">${ICONS.plus} Add Friend</button>
      </div>
      <div class="friends-directory">
        ${
          state.incomingRequests.length
            ? `<div class="dir-card">
                <h4 style="margin-bottom:10px;color:var(--vyro-gold);">Incoming Requests (${state.incomingRequests.length})</h4>
                ${state.incomingRequests
                  .map(
                    (r) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;">
                    <div style="display:flex;align-items:center;gap:10px;">
                      ${renderAvatarHtml(r.user, 34, true)}
                      <strong>${escapeHtml(r.user.displayName)}#${escapeHtml(r.user.discriminator)}</strong>
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
        <div class="dir-card">
          <h4 style="margin-bottom:10px;">Your Squad (${state.friends.length})</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${state.friends
              .map(
                (f) => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,0.04);">
                <div style="display:flex;align-items:center;gap:10px;">
                  ${renderAvatarHtml(f.user, 36, true)}
                  <div>
                    <div style="font-weight:700;">${escapeHtml(f.user.displayName)} ${f.streakCount > 0 ? `<span class="streak-pill">🔥 ${f.streakCount}</span>` : ''}</div>
                    <div class="field-hint">${escapeHtml(f.user.statusText || f.user.presence)}</div>
                  </div>
                </div>
                <button class="btn btn-primary btn-sm" data-open-dm="${escapeHtml(f.dmId)}">Message</button>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
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
          <div class="chat-header-title">${escapeHtml(headerTitle)}</div>
          <div class="chat-header-topic">${escapeHtml(headerSub)}</div>
        </div>
      </div>
      <div class="chat-header-actions">
        <button class="header-icon-btn" id="hdr-voice-quick" title="Jump into Voice Chat">${ICONS.phone}</button>
        <button class="header-icon-btn" id="hdr-snap-quick" title="Send Video/Photo Snap">${ICONS.video}</button>
        <button class="header-icon-btn" id="hdr-add-friend-2" title="Add Friend">${ICONS.userPlus}</button>
        <button class="header-icon-btn" id="toggle-members-btn" title="Toggle Right Panel">${ICONS.users}</button>
      </div>
    </div>

    <div class="messages-scroll" id="messages-feed">
      ${
        state.messages.length
          ? state.messages.map((m) => renderMessageRowHtml(m, user.id)).join('')
          : `<div style="margin:auto;text-align:center;color:var(--text-muted);padding:32px;">
              <div style="font-size:32px;margin-bottom:8px;">⚡</div>
              <div style="font-weight:700;color:var(--text-secondary);">Start the conversation!</div>
              <div style="font-size:12px;">Send a message, drop a timed Snap, or record a voice note.</div>
            </div>`
      }
    </div>

    <div class="typing-bar">${typingNames.length ? `✍️ ${escapeHtml(typingNames.join(', '))} typing...` : ''}</div>

    <div class="composer-wrap">
      ${
        state.replyTo
          ? `<div class="reply-banner">
              <span>Replying to <strong>${escapeHtml(state.replyTo.author?.displayName || 'User')}</strong>: ${escapeHtml(state.replyTo.content.slice(0, 60))}</span>
              <button type="button" id="cancel-reply-btn">✕</button>
            </div>`
          : ''
      }
      <form id="composer-form" class="composer-box ${state.replyTo ? 'with-reply' : ''}">
        <button type="button" class="composer-icon-btn" id="open-snap-studio" title="Shoot or Draw a Snap">${ICONS.camera}</button>
        <select class="ttl-select" id="msg-ttl-select" title="Ephemeral Disappear Timer">
          <option value="0" ${defaultTtl === 0 ? 'selected' : ''}>∞ Stay</option>
          <option value="10" ${defaultTtl > 0 && defaultTtl <= 10 ? 'selected' : ''}>⏱️ 10s</option>
          <option value="15" ${defaultTtl === 15 ? 'selected' : ''}>⏱️ 15s</option>
          <option value="30" ${defaultTtl >= 20 ? 'selected' : ''}>⏱️ 30s</option>
        </select>
        <input class="composer-input" id="msg-input" placeholder="Type a message..." autocomplete="off" />
        <button type="button" class="composer-icon-btn" id="voice-rec-btn" title="Record Voice Note">${ICONS.mic}</button>
        <button type="submit" class="composer-send-circle" title="Send">${ICONS.send}</button>
      </form>
    </div>
  `;
}

function renderMessageRowHtml(m, viewerId) {
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
  } else {
    bodyHtml = `<div class="msg-bubble ${isMine ? 'mine' : ''}">${formatInlineMarkdown(m.content)}</div>`;
  }

  const reactionEntries = Object.entries(m.reactions || {});
  const reactionsHtml = reactionEntries.length
    ? `<div class="msg-reactions">
        ${reactionEntries
          .map(
            ([emoji, uids]) => `
          <button type="button" class="reaction-chip ${uids.includes(viewerId) ? 'mine' : ''}" data-react-msg="${escapeHtml(m.id)}" data-emoji="${escapeHtml(emoji)}">
            <span>${escapeHtml(emoji)}</span><span>${uids.length}</span>
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
          <span class="msg-author" style="color:${isMine ? '#C084FC' : '#fff'};">${escapeHtml(author.displayName)}</span>
          ${author.isBot ? `<span class="msg-bot-tag">BOT</span>` : ''}
          <span class="msg-time">${formatTime(m.createdAt)}</span>
          ${m.isSaved ? `<span class="msg-saved-pill">Saved</span>` : ''}
          ${m.isPinned ? `<span class="msg-saved-pill">📌 Pinned</span>` : ''}
          ${m.expiresAt > 0 && !m.isSaved ? `<span class="msg-ttl-pill">⏱️ Disappears</span>` : ''}
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
        ${['🔥', '😂', '❤️'].map((em) => `<button type="button" class="msg-act-btn" data-react-msg="${escapeHtml(m.id)}" data-emoji="${em}">${em}</button>`).join('')}
        <button type="button" class="msg-act-btn" data-reply-msg="${escapeHtml(m.id)}" title="Reply">↩</button>
        <button type="button" class="msg-act-btn" data-save-msg="${escapeHtml(m.id)}" title="Save in Chat">🔖</button>
        ${isMine ? `<button type="button" class="msg-act-btn" data-del-msg="${escapeHtml(m.id)}" title="Delete">🗑️</button>` : ''}
      </div>
    </div>
  `;
}

function renderRightWidgetsHtml(activeServer, track) {
  const pool = new Map();
  if (state.user) pool.set(state.user.id, { ...state.user, role: 'owner' });
  for (const m of activeServer?.members || []) pool.set(m.id, m);
  for (const f of state.friends || []) {
    if (!pool.has(f.user.id)) pool.set(f.user.id, f.user);
  }
  const allUsers = Array.from(pool.values());
  const onlineUsers = allUsers.filter((u) => u.presence !== 'offline');

  const voiceChannel = activeServer?.channels.find((c) => c.type === 'voice') || { id: 'ch_hq_lounge', name: 'Voice Chat' };
  const inThisVc = state.voiceState[state.myVoiceChannelId || voiceChannel.id] || [];
  const connected = Boolean(state.myVoiceChannelId);

  return `
    <div class="online-now-card">
      <div class="widget-head">
        <span><span style="color:var(--status-online);">●</span> Online Now</span>
        <span style="color:var(--text-muted);font-size:12px;">${onlineUsers.length}</span>
      </div>
      <div class="online-list-scroll">
        ${onlineUsers
          .map(
            (u) => `
          <button class="member-item" data-inspect-user="${escapeHtml(u.id)}">
            ${renderAvatarHtml(u, 32, true)}
            <div style="flex:1;min-width:0;">
              <div class="member-name" style="color:${u.role === 'owner' ? '#C084FC' : 'var(--text-primary)'};">${escapeHtml(u.displayName)}</div>
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
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:800;font-size:13.5px;"><span style="color:var(--status-online);">●</span> ${escapeHtml(voiceChannel.name)}</div>
        <span style="font-size:11.5px;color:var(--text-muted);">${inThisVc.length} online</span>
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
              <button class="vc-btn ${state.voiceMuted ? 'active' : ''}" id="vc-mute-btn">${state.voiceMuted ? '🔇' : '🎙️'}</button>
              <button class="vc-btn ${state.voiceDeafened ? 'active' : ''}" id="vc-deaf-btn">${state.voiceDeafened ? '🔕' : '🎧'}</button>
              <button class="vc-btn ${state.voiceCamera ? 'active' : ''}" id="vc-cam-btn">📷</button>
            </div>`
          : ''
      }
      <button class="voice-join-pill ${connected ? 'connected' : ''}" id="voice-widget-btn" data-vc-id="${escapeHtml(voiceChannel.id)}">
        <span>${connected ? '🔇 Leave Voice' : '🎙️ Join Voice'}</span>
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
  { wsClient, loadAllData, loadMessages, activeServer, currentScopeType, currentScopeId, wasInputFocused, wasSearchFocused, selStart, selEnd, prevTtl }
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

  const openDmWithUser = async (userId, autoMessage = null) => {
    const res = await api('/api/dms/open', { method: 'POST', body: { userId } });
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

  container.querySelector('#win-min')?.addEventListener('click', () => window.vyroDesktop?.minimize());
  container.querySelector('#win-max')?.addEventListener('click', () => window.vyroDesktop?.maximize());
  container.querySelector('#win-close')?.addEventListener('click', () => window.vyroDesktop?.close());
  container.querySelector('#tb-qr-btn')?.addEventListener('click', openMobileQrModal);
  container.querySelector('#hero-qr-btn')?.addEventListener('click', openMobileQrModal);
  container.querySelector('#tb-notif-btn')?.addEventListener('click', () => setState({ navSection: 'friends', viewScope: 'home', activeDmId: null }));
  container.querySelector('#tb-friends-btn')?.addEventListener('click', () => setState({ navSection: 'friends', viewScope: 'home', activeDmId: null }));

  const openSettings = (tab = 'profile') =>
    openSettingsAndUpdatesModal(
      loadAllData,
      async () => {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        wsClient.disconnect();
        setToken('');
        setState({ user: null, route: 'auth', authTab: 'login' });
        location.hash = '#/login';
      },
      tab
    );

  container.querySelector('#tb-upd-btn')?.addEventListener('click', () => openSettings('updates'));
  container.querySelector('#rail-updates-btn')?.addEventListener('click', () => openSettings('updates'));
  container.querySelector('#rail-settings-btn')?.addEventListener('click', () => openSettings('profile'));
  container.querySelector('#open-my-settings')?.addEventListener('click', () => openSettings('profile'));
  container.querySelector('#mobile-profile-btn')?.addEventListener('click', () => openSettings('profile'));

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

  container.querySelector('#rail-add-srv')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#disc-join-btn')?.addEventListener('click', () => openCreateJoinServerModal(loadAllData));
  container.querySelector('#add-channel-btn')?.addEventListener('click', () => {
    if (activeServer) openCreateChannelModal(activeServer.id, loadAllData);
  });

  container.querySelectorAll('[data-ch-id]').forEach((btn) => {
    btn.onclick = async () => {
      const chId = btn.dataset.chId;
      const type = btn.dataset.chType;
      if (type === 'voice') {
        playChime('voice');
        if (state.myVoiceChannelId === chId) {
          wsClient.send('voice:leave', {});
          setState({ myVoiceChannelId: null });
        } else {
          wsClient.send('voice:join', { channelId: chId, muted: state.voiceMuted, deafened: state.voiceDeafened, camera: state.voiceCamera });
          setState({ myVoiceChannelId: chId });
          toast('Joined Voice Chat!', 'success');
        }
        return;
      }
      setState({ activeChannelId: chId, mobileTab: 'chat', replyTo: null });
      await loadMessages('channel', chId);
    };
  });

  container.querySelector('#open-add-friend')?.addEventListener('click', () => openAddFriendModal(loadAllData));
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

  container.querySelector('#voice-widget-btn')?.addEventListener('click', () => {
    const vcId = container.querySelector('#voice-widget-btn').dataset.vcId;
    playChime('voice');
    if (state.myVoiceChannelId) {
      wsClient.send('voice:leave', {});
      setState({ myVoiceChannelId: null });
    } else {
      wsClient.send('voice:join', { channelId: vcId, muted: state.voiceMuted, deafened: state.voiceDeafened, camera: state.voiceCamera });
      setState({ myVoiceChannelId: vcId });
      toast('Connected to Voice Chat!', 'success');
    }
  });
  container.querySelector('#hdr-voice-quick')?.addEventListener('click', () => container.querySelector('#voice-widget-btn')?.click());
  container.querySelector('#vc-mute-btn')?.addEventListener('click', () => {
    const next = !state.voiceMuted;
    setState({ voiceMuted: next });
    wsClient.send('voice:update', { muted: next });
  });
  container.querySelector('#vc-deaf-btn')?.addEventListener('click', () => {
    const next = !state.voiceDeafened;
    setState({ voiceDeafened: next });
    wsClient.send('voice:update', { deafened: next });
  });
  container.querySelector('#vc-cam-btn')?.addEventListener('click', () => {
    const next = !state.voiceCamera;
    setState({ voiceCamera: next });
    wsClient.send('voice:update', { camera: next });
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
  container.querySelectorAll('[data-story-group]').forEach((btn) => {
    btn.onclick = () =>
      openStoryViewer(Number(btn.dataset.storyGroup), state.storyGroups, {
        onRefresh: loadAllData,
        onReplyDm: openDmWithUser
      });
  });

  container.querySelector('#toggle-members-btn')?.addEventListener('click', () => {
    if (window.innerWidth <= 1120) container.querySelector('#member-pane')?.classList.toggle('open');
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

  container.querySelector('#composer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = msgInput.value.trim();
    if (!content || !currentScopeType || !currentScopeId) return;
    const ttlSec = Number(container.querySelector('#msg-ttl-select').value || 0);
    msgInput.value = '';
    draftMessageText = '';
    wsClient.send('typing:stop', { scopeType: currentScopeType, scopeId: currentScopeId });
    try {
      await api('/api/messages', {
        method: 'POST',
        body: { scopeType: currentScopeType, scopeId: currentScopeId, kind: 'text', content, ttlSec, replyToId: state.replyTo?.id || '' }
      });
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
}
