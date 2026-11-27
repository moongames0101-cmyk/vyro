import { api } from '../api.js';
import { renderAvatarHtml } from '../icons.js';
import { escapeHtml, formatTime, state, toast } from '../state.js';

export async function openSnapViewer(msg, { onSnapUpdated, onSnapBack }) {
  try {
    const endpoint =
      msg.viewerOpened && msg.authorId !== state.user?.id && !msg.isSaved
        ? `/api/messages/${msg.id}/replay-snap`
        : `/api/messages/${msg.id}/open-snap`;

    const res = await api(endpoint, { method: 'POST' });
    const mediaData = res.mediaData || msg.mediaData;
    const ttl = Number(msg.snapMeta?.timerSec || msg.ttlSec || 7) || 7;

    const root = document.getElementById('modal-root');
    if (!root) return;

    let elapsed = 0;
    const stepMs = 50;
    let paused = false;

    root.innerHTML = `
      <div class="fullscreen-viewer" id="snap-viewer-overlay">
        <div class="viewer-frame">
          <div class="viewer-progress-row">
            <div class="viewer-prog-track"><div class="viewer-prog-fill" id="sv-prog"></div></div>
          </div>
          <div class="viewer-top-bar">
            <div style="display:flex;align-items:center;gap:10px;">
              ${renderAvatarHtml(msg.author, 36)}
              <div>
                <div style="font-weight:650;font-size:14px;">${escapeHtml(msg.author?.displayName || 'User')}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${formatTime(msg.createdAt)} • <span id="sv-countdown">${ttl}s</span></div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="sv-close">✕</button>
          </div>
          <img src="${escapeHtml(mediaData)}" class="viewer-media" id="sv-img" />
          <div class="viewer-bottom-bar">
            <button class="btn btn-secondary btn-sm" id="sv-save-btn">${res.message.isSaved ? '✓ Saved' : '🔖 Save in Chat'}</button>
            <button class="btn btn-secondary btn-sm" id="sv-ss-btn">📸 Screenshot</button>
            <button class="btn btn-primary btn-sm" id="sv-reply-btn" style="margin-left:auto;">Snap Back ⚡</button>
          </div>
        </div>
      </div>
    `;

    let timerId = null;
    const finish = () => {
      clearInterval(timerId);
      root.innerHTML = '';
      onSnapUpdated?.();
    };

    const progEl = root.querySelector('#sv-prog');
    const countEl = root.querySelector('#sv-countdown');

    if (ttl > 0) {
      timerId = setInterval(() => {
        if (paused) return;
        elapsed += stepMs;
        const pct = Math.min(100, (elapsed / (ttl * 1000)) * 100);
        progEl.style.width = `${pct}%`;
        const rem = Math.max(0, Math.ceil((ttl * 1000 - elapsed) / 1000));
        countEl.textContent = `${rem}s`;
        if (elapsed >= ttl * 1000) finish();
      }, stepMs);
    } else {
      progEl.style.width = '100%';
      countEl.textContent = '∞';
    }

    root.querySelector('#sv-img').onpointerdown = () => { paused = true; };
    root.querySelector('#sv-img').onpointerup = () => { paused = false; };
    root.querySelector('#sv-close').onclick = finish;
    root.querySelector('#snap-viewer-overlay').onclick = (e) => {
      if (e.target.id === 'snap-viewer-overlay') finish();
    };

    root.querySelector('#sv-save-btn').onclick = async () => {
      const savedRes = await api(`/api/messages/${msg.id}/save`, { method: 'POST' });
      root.querySelector('#sv-save-btn').textContent = savedRes.message.isSaved ? '✓ Saved' : '🔖 Save in Chat';
      toast(savedRes.message.isSaved ? 'Saved in chat!' : 'Unsaved from chat', 'success');
      onSnapUpdated?.();
    };

    root.querySelector('#sv-ss-btn').onclick = async () => {
      await api(`/api/messages/${msg.id}/screenshot`, { method: 'POST' });
      toast('Screenshot alert sent to chat!', 'snap');
      onSnapUpdated?.();
    };

    root.querySelector('#sv-reply-btn').onclick = () => {
      finish();
      onSnapBack?.();
    };
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function openStoryViewer(groupIndex, groups, { onRefresh, onReplyDm }) {
  const root = document.getElementById('modal-root');
  if (!root || !groups.length) return;

  let gIdx = groupIndex;
  let sIdx = 0;
  let timerId = null;
  let paused = false;
  let elapsed = 0;

  const close = () => {
    clearInterval(timerId);
    root.innerHTML = '';
    onRefresh?.();
  };

  const renderSlide = () => {
    clearInterval(timerId);
    const group = groups[gIdx];
    const story = group?.stories[sIdx];
    if (!group || !story) return close();

    api(`/api/stories/${story.id}/view`, { method: 'POST' }).catch(() => {});
    elapsed = 0;
    const durationMs = (story.durationSec || 6) * 1000;
    const isMine = group.author.id === state.user?.id;

    root.innerHTML = `
      <div class="fullscreen-viewer" id="story-overlay">
        <div class="viewer-frame">
          <div class="viewer-progress-row">
            ${group.stories
              .map(
                (_, i) => `
              <div class="viewer-prog-track">
                <div class="viewer-prog-fill" id="st-fill-${i}" style="width:${i < sIdx ? '100%' : '0%'};"></div>
              </div>`
              )
              .join('')}
          </div>
          <div class="viewer-top-bar">
            <div style="display:flex;align-items:center;gap:10px;">
              ${renderAvatarHtml(group.author, 36)}
              <div>
                <div style="font-weight:650;font-size:14px;">${escapeHtml(group.author.displayName)}</div>
                <div style="font-size:11px;color:var(--text-secondary);">24h Story • ${formatTime(story.createdAt)}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px;">
              ${isMine ? `<button class="btn btn-danger btn-sm" id="st-del">Delete</button>` : ''}
              <button class="btn btn-secondary btn-sm" id="st-close">✕</button>
            </div>
          </div>

          <img src="${escapeHtml(story.mediaData)}" class="viewer-media" id="st-media" />

          <div class="viewer-bottom-bar">
            ${
              isMine
                ? `<div style="font-size:12.5px;font-weight:700;color:var(--vyro-gold);">👁️ ${story.viewedBy?.length || 0} views</div>`
                : `<input class="input-control" id="st-reply-input" placeholder="Reply to ${escapeHtml(group.author.displayName)}'s story..." style="padding:8px 12px;font-size:13px;" />
                   <button class="btn btn-primary btn-sm" id="st-reply-send">Send</button>`
            }
          </div>
        </div>
      </div>
    `;

    const next = () => {
      if (sIdx + 1 < group.stories.length) {
        sIdx++;
        renderSlide();
      } else if (gIdx + 1 < groups.length) {
        gIdx++;
        sIdx = 0;
        renderSlide();
      } else {
        close();
      }
    };

    const prev = () => {
      if (sIdx > 0) {
        sIdx--;
        renderSlide();
      } else if (gIdx > 0) {
        gIdx--;
        sIdx = Math.max(0, groups[gIdx].stories.length - 1);
        renderSlide();
      }
    };

    const fillEl = root.querySelector(`#st-fill-${sIdx}`);
    timerId = setInterval(() => {
      if (paused) return;
      elapsed += 50;
      if (fillEl) fillEl.style.width = `${Math.min(100, (elapsed / durationMs) * 100)}%`;
      if (elapsed >= durationMs) next();
    }, 50);

    root.querySelector('#st-close').onclick = close;
    root.querySelector('#story-overlay').onclick = (e) => {
      if (e.target.id === 'story-overlay') close();
    };

    const mediaEl = root.querySelector('#st-media');
    mediaEl.onclick = (e) => {
      const rect = mediaEl.getBoundingClientRect();
      if (e.clientX - rect.left < rect.width * 0.35) prev();
      else next();
    };

    const delBtn = root.querySelector('#st-del');
    if (delBtn) {
      delBtn.onclick = async () => {
        await api(`/api/stories/${story.id}`, { method: 'DELETE' });
        toast('Story deleted', 'info');
        close();
      };
    }

    const replyInput = root.querySelector('#st-reply-input');
    const replySend = root.querySelector('#st-reply-send');
    if (replyInput && replySend) {
      replyInput.onfocus = () => { paused = true; };
      replyInput.onblur = () => { paused = false; };
      replySend.onclick = async () => {
        const text = replyInput.value.trim();
        if (!text) return;
        await onReplyDm(group.author.id, `Replied to your Story: "${text}"`);
        toast(`Replied to ${group.author.displayName}!`, 'success');
        close();
      };
    }
  };

  renderSlide();
}
