// VYRO Live: go live to your followers, or watch. Hosting is 18+ only.
// Video goes straight between phones/computers (WebRTC); the VYRO server only passes the
// connection messages along. Good for small audiences; big audiences need a media server later.
import { api } from '../api.js';
import { renderAvatarHtml } from '../icons.js';
import { loadAgeModels, runAgeScan, spotCheck } from '../ageCheck.js';
import { renderNameHtml } from '../plus.js';
import { escapeHtml, onWsEvent, setState, state, toast } from '../state.js';

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const REPORT_REASONS = [
  ['underage_live', 'The host looks under 18'],
  ['inappropriate', 'Sexual or graphic content'],
  ['harassment', 'Bullying or hate'],
  ['spam', 'Spam or scam'],
  ['other', 'Something else']
];

let ctx = null;
let root = null;
let view = 'list'; // list | setup | host | watch | ended
let lives = [];
let eligibility = null;
let loading = false;
let localStream = null;
let remoteStream = null;
let currentLive = null;
let role = null; // 'host' | 'viewer'
let chat = [];
let viewerCount = 0;
let reportOpen = false;
let endedReason = '';
let unsub = null;
let faceCfg = { required: true, minAge: 18 };
// age scan on the Go Live screen
let scan = { state: 'idle', step: 'look', progress: 0, hint: '', message: '', attemptsLeft: null };
let scanRun = 0;
let draftTitle = '';
let draftAudience = 'adults';
let spotTimer = null;
const peers = new Map(); // host: viewerId -> RTCPeerConnection; viewer: hostId -> RTCPeerConnection
const pendingIce = new Map();

function send(event, data) {
  ctx?.wsClient?.send(event, data);
}

export function openLiveHub(c) {
  ctx = c;
  if (!root) {
    root = document.createElement('div');
    root.id = 'live-root';
    document.body.appendChild(root);
  }
  if (!unsub) unsub = onWsEvent(handleWs);
  if (!currentLive) view = 'list';
  render();
  if (view === 'list') refreshList();
}

function closeHub() {
  if (currentLive) return; // must end or leave first
  stopLocal();
  if (root) root.innerHTML = '';
  root?.remove();
  root = null;
  if (unsub) unsub();
  unsub = null;
}

async function refreshList() {
  loading = true;
  render();
  try {
    const res = await api('/api/live');
    lives = res.lives || [];
    eligibility = res.eligibility || null;
    if (res.faceCheck) faceCfg = res.faceCheck;
  } catch (err) {
    toast(err.message, 'error');
  }
  loading = false;
  if (view === 'list') render();
}

// ---------------- rendering ----------------
function render() {
  if (!root) return;
  let body = '';
  if (view === 'list') body = listHtml();
  else if (view === 'setup') body = setupHtml();
  else if (view === 'host' || view === 'watch') body = stageHtml();
  else if (view === 'ended') body = endedHtml();
  root.innerHTML = `<div class="live-overlay" role="dialog" aria-label="VYRO Live"><div class="live-shell">${body}</div></div>`;
  wire();
  attachVideo();
}

function headHtml(title, right = '') {
  return `<div class="live-head">
    <div class="live-head-title"><span class="live-dot"></span>${title}<span class="live-age-chip">18+ hosts</span></div>
    <div style="display:flex;gap:8px;align-items:center;">${right}${currentLive ? '' : '<button class="btn-ghost btn-sm" id="live-close" aria-label="Close">✕</button>'}</div>
  </div>`;
}

function eligibilityHtml() {
  if (!eligibility) return '';
  if (eligibility.ok) {
    return `<button class="btn btn-primary live-go-btn" id="live-go">Go live</button>`;
  }
  if (eligibility.code === 'birthday_required') {
    return `<form class="live-notice" id="live-bday-form">
      <strong>Add your date of birth to use VYRO Live</strong>
      <span>Hosting is for people aged 18 and over. You can only set this once.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        <input class="input-control" type="date" id="live-bday" required max="${new Date().toISOString().slice(0, 10)}" style="max-width:200px;" />
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
      </div>
    </form>`;
  }
  if (eligibility.code === 'under_18') {
    return `<div class="live-notice"><strong>Going live is 18+ only</strong><span>You can still watch lives that are open to everyone.</span></div>`;
  }
  if (eligibility.code === 'banned') {
    return `<div class="live-notice danger"><strong>You can't go live</strong><span>This account is permanently banned from going live.</span></div>`;
  }
  return '';
}

function listHtml() {
  const cards = lives
    .map(
      (l) => `<button class="live-card" data-watch="${escapeHtml(l.id)}">
        <div class="live-card-top">
          <span class="live-pill">LIVE</span>
          <span class="live-viewers">👁 ${Number(l.viewers) || 0}</span>
        </div>
        <div class="live-card-host">${renderAvatarHtml(l.host, 46)}<div style="min-width:0;">
          <div class="live-card-name">${renderNameHtml(l.host, { badgeSize: 13 })}</div>
          <div class="live-card-title">${escapeHtml(l.title)}</div>
        </div></div>
        <div class="live-card-foot">${l.host && state.user && l.host.id === state.user.id ? 'Your live, ' : ''}${l.audience === 'adults' ? '18+ only' : 'open to everyone'}</div>
      </button>`
    )
    .join('');
  return `${headHtml('VYRO Live')}
    <div class="live-intro">
      <div>
        <div class="live-intro-title">Host your own live</div>
        <div class="live-intro-sub">Talk to your squad face to face. Under-18s found going live are banned from going live permanently.</div>
      </div>
      ${eligibilityHtml()}
    </div>
    <div class="live-section-title">Live now ${loading ? '<span class="field-hint">loading...</span>' : ''}</div>
    ${cards ? `<div class="live-grid">${cards}</div>` : `<div class="live-empty"><div class="live-empty-orb">📺</div><div>No one is live right now.</div><div class="field-hint">Lives you can watch will show up here.</div></div>`}`;
}

function setupHtml() {
  return `${headHtml('Go live')}
    <div class="live-setup">
      <div>
        <div class="live-video-wrap">
          <video id="live-video" class="mirror" autoplay playsinline muted></video>
          <div class="live-video-hint" id="live-cam-hint">Starting camera...</div>
          ${faceCfg.required ? `<div class="scan-overlay ${scan.state === 'scanning' ? 'on' : ''}" id="scan-overlay"><div class="scan-ring"></div><div class="scan-instruction" id="scan-instruction">${scanInstruction()}</div></div>` : ''}
        </div>
        ${faceCfg.required ? ageScanCardHtml() : ''}
      </div>
      <form id="live-start-form" class="form-grid">
        <div class="field">
          <label>Title</label>
          <input class="input-control" id="live-title" maxlength="80" placeholder="What's your live about?" value="${escapeHtml(draftTitle)}" />
        </div>
        <div class="field">
          <label>Who can watch</label>
          <select class="input-control" id="live-audience">
            <option value="adults" ${draftAudience === 'adults' ? 'selected' : ''}>18+ only</option>
            <option value="everyone" ${draftAudience === 'everyone' ? 'selected' : ''}>Everyone on VYRO (13+)</option>
          </select>
        </div>
        <div class="live-rules">
          <strong>Live rules</strong>
          <span>No nudity, violence, hate or bullying. Viewers can report you. If we find out you are under 18, you will be banned from going live permanently.</span>
        </div>
        <div style="display:flex;gap:10px;">
          <button type="button" class="btn btn-secondary" id="live-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary live-go-btn" style="flex:1;" ${faceCfg.required && scan.state !== 'passed' ? 'disabled title="Do the age scan first"' : ''}>Start live</button>
        </div>
      </form>
    </div>`;
}

function scanInstruction() {
  if (scan.state !== 'scanning') return '';
  if (scan.step === 'look') return 'Look straight at the camera';
  if (scan.step === 'turn') return 'Slowly turn your head left, then right';
  if (scan.step === 'lookBack') return 'Now look back at the camera';
  return 'Done';
}

function ageScanCardHtml() {
  const privacy = `<span class="field-hint">The scan happens on your device. Your face is never uploaded or saved. VYRO only keeps the estimated age.</span>`;
  if (scan.state === 'passed') {
    return `<div class="scan-card ok"><strong>Age check passed</strong><span class="field-hint">You can go live now.</span></div>`;
  }
  if (scan.state === 'loading') {
    return `<div class="scan-card"><strong>Getting the age check ready...</strong>${privacy}</div>`;
  }
  if (scan.state === 'scanning') {
    return `<div class="scan-card">
      <strong id="scan-title">${scanInstruction()}</strong>
      <div class="scan-bar"><div class="scan-bar-fill" id="scan-bar" style="width:${Math.round(scan.progress * 100)}%"></div></div>
      <span class="field-hint" id="scan-hint">${escapeHtml(scan.hint || 'Hold your phone at arm’s length in good light.')}</span>
      <button type="button" class="btn btn-secondary btn-sm" id="scan-cancel">Cancel</button>
    </div>`;
  }
  const failed = scan.state === 'failed';
  return `<div class="scan-card ${failed ? 'bad' : ''}">
    <strong>${failed ? 'We couldn’t confirm you’re 18 or over' : 'Quick age check'}</strong>
    <span>${
      failed
        ? escapeHtml(scan.message)
        : 'VYRO Live is 18+. Before you go live we check your face looks over 18. It takes about 10 seconds.'
    }</span>
    ${privacy}
    ${scan.attemptsLeft === 0 ? '' : `<button type="button" class="btn btn-primary btn-sm" id="scan-start" ${localStream ? '' : 'disabled'}>${failed ? 'Try again' : 'Start age scan'}${failed && scan.attemptsLeft ? ` (${scan.attemptsLeft} left today)` : ''}</button>`}
  </div>`;
}

function updateScanUi() {
  if (!root) return;
  const bar = root.querySelector('#scan-bar');
  if (bar) bar.style.width = `${Math.round(scan.progress * 100)}%`;
  const title = root.querySelector('#scan-title');
  if (title) title.textContent = scanInstruction();
  const ins = root.querySelector('#scan-instruction');
  if (ins) ins.textContent = scanInstruction();
  const hint = root.querySelector('#scan-hint');
  if (hint) hint.textContent = scan.hint || 'Hold your phone at arm’s length in good light.';
}

async function startScan() {
  const myRun = ++scanRun;
  scan = { ...scan, state: 'loading', hint: '', message: '' };
  render();
  try {
    await loadAgeModels();
    if (myRun !== scanRun) return;
    scan = { ...scan, state: 'scanning', step: 'look', progress: 0 };
    render();
    const result = await runAgeScan(() => root?.querySelector('#live-video'), {
      isCancelled: () => myRun !== scanRun || view !== 'setup',
      onUpdate: (u) => {
        scan = { ...scan, step: u.step, progress: u.progress, hint: u.hint };
        updateScanUi();
      }
    });
    const res = await api('/api/live/age-check', { method: 'POST', body: { kind: 'golive', ...result } });
    if (myRun !== scanRun) return;
    if (res.passed) {
      scan = { ...scan, state: 'passed' };
    } else {
      const msg =
        res.reason === 'no_liveness'
          ? 'Make sure you turn your head left and right when asked.'
          : res.reason === 'too_few'
            ? 'We didn’t get a clear enough look. Face the camera in good light.'
            : 'Our check thinks you might be under 18. Try again facing the camera in good, even light, without a hat or sunglasses.';
      scan = { ...scan, state: 'failed', message: msg, attemptsLeft: res.attemptsLeft };
      if (res.attemptsLeft === 0) scan.message += ' You’ve used all your scans for today.';
    }
  } catch (err) {
    if (err.code === 'cancelled') {
      if (myRun === scanRun) scan = { ...scan, state: 'idle' };
    } else {
      scan = {
        ...scan,
        state: 'failed',
        message: err.code === 'face_limit' || err.status === 429 ? 'You’ve used all your scans for today. Try again tomorrow.' : err.message || 'The age check could not run on this device.',
        attemptsLeft: err.status === 429 ? 0 : scan.attemptsLeft
      };
    }
  }
  if (view === 'setup') render();
}

function startSpotChecks() {
  clearInterval(spotTimer);
  if (!faceCfg.required) return;
  // A quiet check now and then while live. It only alerts moderators; it never ends the live.
  const check = async () => {
    if (!currentLive || role !== 'host') return;
    const r = await spotCheck(() => root?.querySelector('#live-video')).catch(() => null);
    if (r && currentLive) {
      api('/api/live/age-check', { method: 'POST', body: { kind: 'spot', liveId: currentLive.id, ...r } }).catch(() => {});
    }
  };
  setTimeout(check, 60 * 1000);
  spotTimer = setInterval(check, 3 * 60 * 1000);
}

function chatHtml() {
  return chat
    .slice(-80)
    .map(
      (c) => `<div class="live-chat-line ${c.isHost ? 'host' : ''}"><span class="live-chat-name">${renderNameHtml(c.user, { badgeSize: 12 })}</span><span>${escapeHtml(c.text)}</span></div>`
    )
    .join('');
}

function stageHtml() {
  const isHost = view === 'host';
  const host = currentLive?.host || {};
  const right = `<span class="live-pill">LIVE</span><span class="live-viewers" id="live-count">👁 ${viewerCount}</span>`;
  return `${headHtml(escapeHtml(currentLive?.title || 'VYRO Live'), right)}
    <div class="live-stage">
      <div class="live-video-wrap big">
        <video id="live-video" ${isHost ? 'class="mirror"' : ''} autoplay playsinline ${isHost ? 'muted' : ''}></video>
        ${isHost ? '' : '<div class="live-video-hint" id="live-cam-hint">Connecting to the host...</div>'}
        <div class="live-host-tag">${renderAvatarHtml(host, 30)}<span>${renderNameHtml(host, { badgeSize: 12 })}</span></div>
      </div>
      <div class="live-side">
        <div class="live-chat" id="live-chat">${chatHtml() || '<div class="field-hint">Say hi 👋</div>'}</div>
        <form class="live-chat-form" id="live-chat-form">
          <input class="input-control" id="live-chat-input" maxlength="300" placeholder="Say something nice..." autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Send</button>
        </form>
        <div class="live-actions">
          ${
            isHost
              ? `<button class="btn btn-secondary btn-sm" id="live-mic">Mic</button>
                 <button class="btn btn-secondary btn-sm" id="live-cam">Camera</button>
                 <button class="btn btn-danger btn-sm" id="live-end">End live</button>`
              : `<button class="btn btn-secondary btn-sm" id="live-report">Report</button>
                 <button class="btn btn-danger btn-sm" id="live-leave">Leave</button>`
          }
        </div>
        ${reportOpen ? reportHtml() : ''}
      </div>
    </div>`;
}

function reportHtml() {
  return `<form class="live-report" id="live-report-form">
    <strong>Report this live</strong>
    ${REPORT_REASONS.map(([k, label], i) => `<label class="live-report-opt"><input type="radio" name="rk" value="${k}" ${i === 0 ? 'checked' : ''}/> ${label}</label>`).join('')}
    <input class="input-control" id="live-report-text" maxlength="300" placeholder="Anything else we should know? (optional)" />
    <div style="display:flex;gap:8px;"><button type="button" class="btn btn-secondary btn-sm" id="live-report-cancel">Cancel</button><button class="btn btn-primary btn-sm" type="submit" style="flex:1;">Send report</button></div>
  </form>`;
}

function endedHtml() {
  const msg =
    endedReason === 'banned'
      ? 'This live was ended by VYRO moderators.'
      : endedReason === 'host_left'
        ? 'The host lost connection.'
        : 'This live has ended.';
  return `${headHtml('VYRO Live')}<div class="live-empty"><div class="live-empty-orb">👋</div><div>${msg}</div><button class="btn btn-primary" id="live-back">Back to lives</button></div>`;
}

function attachVideo() {
  const v = root?.querySelector('#live-video');
  if (!v) return;
  const stream = view === 'watch' ? remoteStream : localStream;
  if (stream && v.srcObject !== stream) v.srcObject = stream;
  const hint = root.querySelector('#live-cam-hint');
  if (hint && stream) hint.remove();
}

function updateChat() {
  const el = root?.querySelector('#live-chat');
  if (!el) return;
  el.innerHTML = chatHtml();
  el.scrollTop = el.scrollHeight;
}

function updateCount() {
  const el = root?.querySelector('#live-count');
  if (el) el.textContent = `👁 ${viewerCount}`;
}

// ---------------- actions ----------------
function wire() {
  const $ = (sel) => root.querySelector(sel);
  $('#live-close')?.addEventListener('click', closeHub);
  $('#live-back')?.addEventListener('click', () => {
    view = 'list';
    refreshList();
  });
  $('#live-go')?.addEventListener('click', startSetup);
  $('#scan-start')?.addEventListener('click', startScan);
  $('#scan-cancel')?.addEventListener('click', () => {
    scanRun += 1;
    scan = { ...scan, state: 'idle' };
    render();
  });
  $('#live-title')?.addEventListener('input', (e) => (draftTitle = e.target.value));
  $('#live-audience')?.addEventListener('change', (e) => (draftAudience = e.target.value));
  $('#live-cancel')?.addEventListener('click', () => {
    scanRun += 1;
    stopLocal();
    view = 'list';
    refreshList();
  });
  root.querySelectorAll('[data-watch]').forEach((b) => (b.onclick = () => watch(b.dataset.watch)));

  $('#live-bday-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/auth/me', { method: 'PATCH', body: { birthday: $('#live-bday').value } });
      setState({ user: res.user });
      await refreshList();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#live-start-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!localStream) return toast('Allow camera and microphone first.', 'error');
    try {
      const res = await api('/api/live/start', {
        method: 'POST',
        body: { title: $('#live-title').value, audience: $('#live-audience').value }
      });
      currentLive = res.live;
      role = 'host';
      chat = [];
      viewerCount = 0;
      view = 'host';
      send('live:host', { liveId: currentLive.id });
      render();
      startSpotChecks();
    } catch (err) {
      toast(err.message, 'error');
      if (err.status === 403 && err.code === 'face_check_required') {
        scan = { ...scan, state: 'idle' };
        render();
      } else if (err.status === 403) {
        stopLocal();
        view = 'list';
        refreshList();
      }
    }
  });

  $('#live-chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#live-chat-input');
    const text = input.value.trim();
    if (!text || !currentLive) return;
    send('live:chat', { liveId: currentLive.id, text });
    input.value = '';
  });

  $('#live-end')?.addEventListener('click', endMyLive);
  $('#live-leave')?.addEventListener('click', leaveLive);
  $('#live-mic')?.addEventListener('click', (e) => toggleTrack('audio', e.currentTarget));
  $('#live-cam')?.addEventListener('click', (e) => toggleTrack('video', e.currentTarget));
  $('#live-report')?.addEventListener('click', () => {
    reportOpen = true;
    render();
  });
  $('#live-report-cancel')?.addEventListener('click', () => {
    reportOpen = false;
    render();
  });
  $('#live-report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = root.querySelector('input[name="rk"]:checked')?.value || 'other';
    try {
      await api('/api/reports', {
        method: 'POST',
        body: { targetUserId: currentLive.host.id, kind, contextId: currentLive.id, reason: $('#live-report-text').value }
      });
      toast('Thanks. The VYRO team will review this live.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    reportOpen = false;
    render();
  });
}

async function startSetup() {
  view = 'setup';
  scanRun += 1;
  scan = { state: 'idle', step: 'look', progress: 0, hint: '', message: '', attemptsLeft: null };
  draftTitle = '';
  draftAudience = 'adults';
  render();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    attachVideo();
    if (faceCfg.required && view === 'setup') {
      render();
      loadAgeModels().catch(() => {}); // warm up while they type a title
    }
  } catch {
    const hint = root?.querySelector('#live-cam-hint');
    if (hint) hint.textContent = 'Camera or microphone blocked. Allow them in your settings to go live.';
  }
}

function toggleTrack(kind, btn) {
  if (!localStream) return;
  const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
  const enabled = !tracks.every((t) => t.enabled);
  tracks.forEach((t) => (t.enabled = enabled));
  btn.classList.toggle('off', !enabled);
}

function stopLocal() {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
  localStream = null;
}

function closePeers() {
  for (const pc of peers.values()) {
    try {
      pc.close();
    } catch {}
  }
  peers.clear();
  pendingIce.clear();
}

async function endMyLive() {
  if (!currentLive) return;
  const id = currentLive.id;
  try {
    await api(`/api/live/${id}/end`, { method: 'POST' });
  } catch {}
  finishLocal('host_ended');
}

function leaveLive() {
  if (currentLive) send('live:leave', { liveId: currentLive.id });
  finishLocal('', true);
}

function finishLocal(reason, backToList = false) {
  clearInterval(spotTimer);
  spotTimer = null;
  closePeers();
  stopLocal();
  remoteStream = null;
  currentLive = null;
  role = null;
  reportOpen = false;
  chat = [];
  endedReason = reason;
  view = backToList || reason === 'host_ended' ? 'list' : 'ended';
  render();
  if (view === 'list') refreshList();
}

async function watch(liveId) {
  const live = lives.find((l) => l.id === liveId);
  if (!live) return;
  if (live.host && state.user && live.host.id === state.user.id) return toast('This is your live.', 'info');
  currentLive = live;
  role = 'viewer';
  chat = [];
  viewerCount = live.viewers || 0;
  remoteStream = null;
  view = 'watch';
  render();
  send('live:join', { liveId });
}

// ---------------- WebRTC ----------------
function newPeer(otherId) {
  const pc = new RTCPeerConnection(ICE);
  pc.onicecandidate = (e) => {
    if (e.candidate && currentLive) send('live:signal', { liveId: currentLive.id, to: otherId, payload: { type: 'ice', candidate: e.candidate } });
  };
  peers.set(otherId, pc);
  return pc;
}

async function flushIce(otherId, pc) {
  const list = pendingIce.get(otherId) || [];
  pendingIce.delete(otherId);
  for (const c of list) {
    try {
      await pc.addIceCandidate(c);
    } catch {}
  }
}

async function hostAddViewer(viewerId) {
  if (!localStream || !currentLive) return;
  peers.get(viewerId)?.close();
  const pc = newPeer(viewerId);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send('live:signal', { liveId: currentLive.id, to: viewerId, payload: { type: 'offer', sdp: pc.localDescription } });
}

async function onSignal(from, payload) {
  if (!currentLive || !payload) return;
  if (payload.type === 'offer' && role === 'viewer') {
    peers.get(from)?.close();
    const pc = newPeer(from);
    pc.ontrack = (e) => {
      remoteStream = e.streams[0];
      attachVideo();
    };
    await pc.setRemoteDescription(payload.sdp);
    await flushIce(from, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send('live:signal', { liveId: currentLive.id, to: from, payload: { type: 'answer', sdp: pc.localDescription } });
  } else if (payload.type === 'answer' && role === 'host') {
    const pc = peers.get(from);
    if (pc) {
      await pc.setRemoteDescription(payload.sdp);
      await flushIce(from, pc);
    }
  } else if (payload.type === 'ice') {
    const pc = peers.get(from);
    if (pc && pc.remoteDescription) {
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {}
    } else {
      if (!pendingIce.has(from)) pendingIce.set(from, []);
      pendingIce.get(from).push(payload.candidate);
    }
  }
}

function handleWs(event, data) {
  if (!data) return;
  if (event === 'hello' && currentLive) {
    // Socket reconnected: pick the live back up.
    if (role === 'host') send('live:host', { liveId: currentLive.id });
    else send('live:join', { liveId: currentLive.id });
    return;
  }
  if (event === 'live:list-changed' && view === 'list' && root) {
    refreshList();
    return;
  }
  if (!currentLive || data.liveId !== currentLive.id) return;

  if (event === 'live:viewer-join' && role === 'host') hostAddViewer(data.viewerId).catch(() => {});
  else if (event === 'live:viewer-leave' && role === 'host') {
    peers.get(data.viewerId)?.close();
    peers.delete(data.viewerId);
  } else if (event === 'live:signal') onSignal(data.from, data.payload).catch(() => {});
  else if (event === 'live:viewers') {
    viewerCount = data.count || 0;
    updateCount();
  } else if (event === 'live:chat') {
    chat.push(data);
    if (chat.length > 200) chat = chat.slice(-200);
    updateChat();
  } else if (event === 'live:ended') {
    finishLocal(role === 'host' && data.reason === 'host_ended' ? 'host_ended' : data.reason || 'ended');
  } else if (event === 'live:denied') {
    toast(data.reason || 'You cannot watch this live.', 'error');
    finishLocal('', true);
  }
}
