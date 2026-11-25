import { api } from '../api.js';
import { escapeHtml, state, toast } from '../state.js';
import { closeModal, openModal } from './Modals.js';

const FILTERS = [
  { id: 'none', label: 'Normal', css: 'none' },
  { id: 'neon', label: 'Neon', css: 'contrast(1.25) saturate(1.55) hue-rotate(15deg)' },
  { id: 'sunset', label: 'Gold', css: 'sepia(0.35) saturate(1.6) brightness(1.06)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.3)' },
  { id: 'cyber', label: 'Cyber', css: 'hue-rotate(240deg) saturate(1.6) contrast(1.15)' }
];

const BACKGROUNDS = [
  ['#581C87', '#0F172A'],
  ['#7C3AED', '#FACC15'],
  ['#BE185D', '#312E81'],
  ['#0EA5E9', '#1E1B4B'],
  ['#EA580C', '#701A75']
];

const BRUSH_COLORS = ['#FFE600', '#A855F7', '#FF2E63', '#38BDF8', '#22C55E', '#FFFFFF'];

export function openSnapStudioModal({ defaultTarget = 'current', onSent }) {
  let cameraStream = null;
  let mode = 'canvas'; // 'canvas' | 'camera'
  let activeFilter = FILTERS[0];
  let activeBg = BACKGROUNDS[0];
  let brushColor = BRUSH_COLORS[0];
  let brushSize = 6;
  let caption = '';
  let captionY = 0.65;
  let timerSec = 6;
  let bgImage = null;
  let capturedDataUrl = null;
  const strokes = []; // { color, size, points: [{x,y}] }
  const stickers = []; // { emoji, x, y }

  const cleanupCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      cameraStream = null;
    }
  };

  // Determine available destinations
  const currentChannel =
    state.viewScope === 'server'
      ? state.servers.find((s) => s.id === state.activeServerId)?.channels.find((c) => c.id === state.activeChannelId)
      : null;

  openModal(
    `
    <div class="modal-head">
      <h3>📸 VYRO Snap Studio</h3>
      <button class="btn-ghost btn-sm" id="studio-close">✕</button>
    </div>
    <div class="snap-studio-layout">
      <div>
        <div class="snap-canvas-stage" id="snap-stage">
          <video id="snap-video" class="hidden" autoplay playsinline muted></video>
          <canvas id="snap-canvas" width="340" height="454"></canvas>
          <div id="snap-caption-bar" class="snap-caption-overlay hidden" style="top:65%;"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;justify-content:center;">
          <button type="button" class="btn btn-secondary btn-sm" id="mode-canvas-btn">🎨 Draw Canvas</button>
          <button type="button" class="btn btn-secondary btn-sm" id="mode-cam-btn">📷 Live Camera</button>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;">
            🖼️ Photo
            <input type="file" id="snap-upload" accept="image/*" class="hidden" />
          </label>
        </div>
      </div>

      <div class="snap-controls-col">
        <div class="field hidden" id="cam-shutter-row">
          <button type="button" class="btn btn-primary" id="snap-capture-btn">📸 Freeze Camera Frame</button>
        </div>

        <div class="field">
          <label>Backdrop / Filter</label>
          <div class="swatch-row">
            ${BACKGROUNDS.map((bg, i) => `<button type="button" class="swatch-btn ${i === 0 ? 'active' : ''}" data-bg="${i}" style="background:linear-gradient(135deg,${bg[0]},${bg[1]});"></button>`).join('')}
          </div>
          <div class="chip-row" style="margin-top:6px;">
            ${FILTERS.map((f, i) => `<button type="button" class="chip-option ${i === 0 ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label>
            <span>Doodle Brush</span>
            <button type="button" id="undo-stroke-btn" style="font-size:11px;color:var(--vyro-gold);">Undo</button>
          </label>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${BRUSH_COLORS.map((c, i) => `<button type="button" class="swatch-btn ${i === 0 ? 'active' : ''}" data-brush="${c}" style="background:${c};"></button>`).join('')}
            <input type="range" id="brush-size" min="2" max="18" value="6" style="width:78px;" />
          </div>
        </div>

        <div class="field">
          <label>Add Sticker</label>
          <div class="chip-row">
            ${['🔥', '⚡', '💀', '💛', '👑', '🎉', '✨'].map((em) => `<button type="button" class="chip-option" data-sticker="${em}">${em}</button>`).join('')}
          </div>
        </div>

        <div class="field">
          <label>Snap Caption Banner</label>
          <input class="input-control" id="snap-caption-input" placeholder="Type a Snapchat-style caption..." maxlength="100" />
          <input type="range" id="snap-caption-y" min="15" max="82" value="65" />
        </div>

        <div class="form-row-2">
          <div class="field">
            <label>Snap Timer</label>
            <select class="input-control" id="snap-timer-sel">
              <option value="3">3 Seconds</option>
              <option value="6" selected>6 Seconds</option>
              <option value="10">10 Seconds</option>
              <option value="0">∞ Keep</option>
            </select>
          </div>
          <div class="field">
            <label>Send To</label>
            <select class="input-control" id="snap-target-sel">
              ${currentChannel && currentChannel.type !== 'voice' ? `<option value="channel:${currentChannel.id}"># ${escapeHtml(currentChannel.name)}</option>` : ''}
              ${state.activeFriend && state.viewScope === 'home' ? `<option value="dm:${state.activeDmId}">DM: ${escapeHtml(state.activeFriend.displayName)}</option>` : ''}
              <option value="story" ${defaultTarget === 'story' ? 'selected' : ''}>✨ My 24h Story</option>
              ${state.friends.map((f) => `<option value="dm:${f.dmId}">🔥 DM: ${escapeHtml(f.user.displayName)}</option>`).join('')}
            </select>
          </div>
        </div>

        <button type="button" class="btn btn-primary" id="snap-send-btn">Send Snap ⚡</button>
      </div>
    </div>
    `,
    (card) => {
      const canvas = card.querySelector('#snap-canvas');
      const ctx = canvas.getContext('2d');
      const video = card.querySelector('#snap-video');
      const capBar = card.querySelector('#snap-caption-bar');
      const shutterRow = card.querySelector('#cam-shutter-row');

      const closeAll = () => {
        cleanupCamera();
        closeModal();
      };
      card.querySelector('#studio-close').onclick = closeAll;

      const drawScene = (includeCaption = false) => {
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.filter = activeFilter.css;

        if (capturedDataUrl && bgImage) {
          ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
        } else if (bgImage) {
          ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
        } else if (mode === 'camera' && video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } else {
          const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
          grad.addColorStop(0, activeBg[0]);
          grad.addColorStop(1, activeBg[1]);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.beginPath();
          ctx.arc(270, 80, 95, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Strokes
        for (const st of strokes) {
          if (st.points.length < 2) continue;
          ctx.strokeStyle = st.color;
          ctx.lineWidth = st.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(st.points[0].x, st.points[0].y);
          for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
          ctx.stroke();
        }

        // Stickers
        ctx.font = '38px Segoe UI Emoji, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const stk of stickers) {
          ctx.fillText(stk.emoji, stk.x, stk.y);
        }

        if (includeCaption && caption.trim()) {
          const y = canvas.height * captionY;
          ctx.fillStyle = 'rgba(0,0,0,0.68)';
          ctx.fillRect(0, y - 22, canvas.width, 44);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 17px Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(caption.trim(), canvas.width / 2, y);
        }
      };

      drawScene();

      // Pointer drawing on canvas
      let currentStroke = null;
      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((e.clientX - rect.left) / rect.width) * canvas.width,
          y: ((e.clientY - rect.top) / rect.height) * canvas.height
        };
      };

      canvas.onpointerdown = (e) => {
        canvas.setPointerCapture(e.pointerId);
        currentStroke = { color: brushColor, size: brushSize, points: [getPos(e)] };
        strokes.push(currentStroke);
      };
      canvas.onpointermove = (e) => {
        if (!currentStroke) return;
        currentStroke.points.push(getPos(e));
        drawScene();
      };
      canvas.onpointerup = () => {
        currentStroke = null;
      };

      card.querySelector('#mode-canvas-btn').onclick = () => {
        cleanupCamera();
        mode = 'canvas';
        capturedDataUrl = null;
        video.classList.add('hidden');
        shutterRow.classList.add('hidden');
        drawScene();
      };

      card.querySelector('#mode-cam-btn').onclick = async () => {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
          mode = 'camera';
          bgImage = null;
          capturedDataUrl = null;
          video.srcObject = cameraStream;
          video.classList.remove('hidden');
          shutterRow.classList.remove('hidden');
          video.style.filter = activeFilter.css;
        } catch {
          toast('No webcam available/permitted — use Canvas Draw or Photo upload!', 'error');
        }
      };

      card.querySelector('#snap-capture-btn').onclick = () => {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const tctx = tmp.getContext('2d');
        tctx.filter = activeFilter.css;
        tctx.drawImage(video, 0, 0, tmp.width, tmp.height);
        const img = new Image();
        img.onload = () => {
          bgImage = img;
          capturedDataUrl = tmp.toDataURL('image/jpeg', 0.88);
          cleanupCamera();
          video.classList.add('hidden');
          shutterRow.classList.add('hidden');
          drawScene();
        };
        img.src = tmp.toDataURL('image/jpeg', 0.88);
      };

      card.querySelector('#snap-upload').onchange = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            cleanupCamera();
            bgImage = img;
            capturedDataUrl = reader.result;
            video.classList.add('hidden');
            drawScene();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      };

      card.querySelectorAll('[data-bg]').forEach((b) => {
        b.onclick = () => {
          card.querySelectorAll('[data-bg]').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          bgImage = null;
          capturedDataUrl = null;
          activeBg = BACKGROUNDS[Number(b.dataset.bg)];
          drawScene();
        };
      });

      card.querySelectorAll('[data-filter]').forEach((b) => {
        b.onclick = () => {
          card.querySelectorAll('[data-filter]').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          activeFilter = FILTERS.find((f) => f.id === b.dataset.filter) || FILTERS[0];
          video.style.filter = activeFilter.css;
          drawScene();
        };
      });

      card.querySelectorAll('[data-brush]').forEach((b) => {
        b.onclick = () => {
          card.querySelectorAll('[data-brush]').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          brushColor = b.dataset.brush;
        };
      });
      card.querySelector('#brush-size').oninput = (e) => {
        brushSize = Number(e.target.value);
      };
      card.querySelector('#undo-stroke-btn').onclick = () => {
        strokes.pop();
        drawScene();
      };

      card.querySelectorAll('[data-sticker]').forEach((b) => {
        b.onclick = () => {
          stickers.push({
            emoji: b.dataset.sticker,
            x: 80 + Math.random() * 180,
            y: 90 + Math.random() * 250
          });
          drawScene();
        };
      });

      const capInput = card.querySelector('#snap-caption-input');
      const capYInput = card.querySelector('#snap-caption-y');
      const syncCap = () => {
        caption = capInput.value;
        captionY = Number(capYInput.value) / 100;
        if (caption.trim()) {
          capBar.textContent = caption;
          capBar.style.top = `${capYInput.value}%`;
          capBar.classList.remove('hidden');
        } else {
          capBar.classList.add('hidden');
        }
      };
      capInput.oninput = syncCap;
      capYInput.oninput = syncCap;

      card.querySelector('#snap-send-btn').onclick = async () => {
        const btn = card.querySelector('#snap-send-btn');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
          if (mode === 'camera' && !bgImage && video.readyState >= 2) {
            drawScene(true);
          } else {
            drawScene(true);
          }
          const mediaData = canvas.toDataURL('image/png');
          timerSec = Number(card.querySelector('#snap-timer-sel').value);
          const target = card.querySelector('#snap-target-sel').value;

          if (target === 'story') {
            await api('/api/stories', {
              method: 'POST',
              body: {
                mediaData,
                caption: caption.trim(),
                captionY,
                durationSec: timerSec || 6
              }
            });
            toast('Posted to your 24h Story! (+3 Snap Score)', 'snap');
          } else {
            const [scopeType, scopeId] = target.split(':');
            await api('/api/messages', {
              method: 'POST',
              body: {
                scopeType,
                scopeId,
                kind: 'snap',
                content: caption.trim() || 'Snap',
                mediaData,
                ttlSec: timerSec,
                snapMeta: { caption: caption.trim(), timerSec, filter: activeFilter.id }
              }
            });
            toast('Snap delivered! (+2 Snap Score)', 'snap');
          }
          closeAll();
          await onSent?.();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Send Snap ⚡';
        }
      };
    },
    true
  );
}
