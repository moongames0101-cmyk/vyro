import { escapeHtml } from '../state.js';

/**
 * Compute base contain scale so 100% of the longest image side fits inside `size`,
 * plus the exact inscribed-circle scale where even all 4 corners never clip outside a circle.
 */
export function computeFitScales(imgWidth, imgHeight, size) {
  const containScale = Math.min(size / imgWidth, size / imgHeight);
  const coverScale = Math.max(size / imgWidth, size / imgHeight);
  const diag = Math.hypot(imgWidth, imgHeight) || size;
  const zeroCutoutScale = (size * 0.96) / diag;
  const zeroCutoutMultiplier = zeroCutoutScale / containScale;
  const coverMultiplier = coverScale / containScale;
  return { containScale, coverScale, zeroCutoutMultiplier, coverMultiplier };
}

/**
 * Draw an ambient blurred version of `img` onto `ctx` without relying on `ctx.filter`
 * (compatible with all WebViews including older Android versions).
 */
function drawAmbientBackdrop(ctx, img, size) {
  ctx.fillStyle = '#0F1220';
  ctx.fillRect(0, 0, size, size);

  const tiny = document.createElement('canvas');
  tiny.width = 12;
  tiny.height = 12;
  const tctx = tiny.getContext('2d');
  const scale = Math.max(12 / img.width, 12 / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  tctx.drawImage(img, (12 - dw) / 2, (12 - dh) / 2, dw, dh);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 0.72;
  ctx.drawImage(tiny, -12, -12, size + 24, size + 24);
  ctx.restore();

  ctx.fillStyle = 'rgba(7, 7, 13, 0.34)';
  ctx.fillRect(0, 0, size, size);
}

/**
 * Render an image into a square avatar canvas centered at `(offsetX, offsetY)` with `zoom`
 * relative to contain-fit (`1.0` = full width and height inside box; `~0.71` = zero corner clipping in circle).
 */
export function renderFramedAvatarCanvas(img, size, { zoom = 0.88, offsetX = 0, offsetY = 0, backdrop = 'blur' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (backdrop === 'blur') {
    drawAmbientBackdrop(ctx, img, size);
  } else {
    ctx.fillStyle = '#131629';
    ctx.fillRect(0, 0, size, size);
  }

  const { containScale } = computeFitScales(img.width, img.height, size);
  const effectiveScale = containScale * zoom;
  const drawW = img.width * effectiveScale;
  const drawH = img.height * effectiveScale;
  const x = (size - drawW) / 2 + offsetX * size;
  const y = (size - drawH) / 2 + offsetY * size;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, drawW, drawH);
  ctx.restore();

  return canvas;
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const loadFromUrl = (src) => {
      const img = new Image();
      img.onload = () => resolve({ img, dataUrl: src });
      img.onerror = reject;
      img.src = src;
    };

    if (typeof source === 'string') {
      loadFromUrl(source);
      return;
    }

    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => loadFromUrl(reader.result);
    reader.readAsDataURL(source);
  });
}

/**
 * Open an interactive circular profile picture crop & fit modal above any open dialog.
 */
export async function openAvatarCropperModal(fileOrUrl, { title = 'Frame Profile Picture', onConfirm, onError } = {}) {
  let loaded;
  try {
    loaded = await loadImageElement(fileOrUrl);
  } catch (err) {
    onError?.(err);
    return;
  }

  const { img } = loaded;
  const { zeroCutoutMultiplier, coverMultiplier } = computeFitScales(img.width, img.height, 240);

  // Start cleanly inside the circle so heads, sides, or multiple people aren't clipped
  let zoom = Number(Math.max(0.65, Math.min(0.88, zeroCutoutMultiplier * 1.12)).toFixed(2));
  let offsetX = 0;
  let offsetY = 0;
  let backdrop = 'blur';

  document.getElementById('vyro-avatar-cropper-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vyro-avatar-cropper-overlay';
  overlay.className = 'vyro-cropper-backdrop';
  overlay.innerHTML = `
    <div class="vyro-cropper-card">
      <div class="modal-head">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="btn-ghost btn-sm" id="crop-cancel-x">✕</button>
      </div>
      <div class="vyro-cropper-stage" id="crop-stage" title="Drag to reposition">
        <canvas id="crop-preview-canvas" width="240" height="240"></canvas>
      </div>
      <p class="field-hint" style="text-align:center;">Drag image inside the circle or adjust zoom so nobody is cut out.</p>

      <div class="chip-row" style="justify-content:center;">
        <button type="button" class="chip-option" id="crop-preset-nocut">Fit Whole (No Cutout)</button>
        <button type="button" class="chip-option active" id="crop-preset-safe">Safe Frame</button>
        <button type="button" class="chip-option" id="crop-preset-fill">Fill Circle</button>
      </div>

      <div class="field">
        <label>
          <span>Zoom</span>
          <span id="crop-zoom-val" style="font-family:var(--font-mono);color:var(--vyro-gold);">${Math.round(zoom * 100)}%</span>
        </label>
        <input type="range" id="crop-zoom-range" min="0.55" max="${Math.max(2.6, Number((coverMultiplier + 0.8).toFixed(2)))}" step="0.02" value="${zoom}" />
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div class="chip-row">
          <button type="button" class="chip-option active" data-crop-bg="blur">Soft Blur Edge</button>
          <button type="button" class="chip-option" data-crop-bg="solid">Dark Edge</button>
        </div>
        <button type="button" class="btn-ghost btn-sm" id="crop-recenter">Center</button>
      </div>

      <div style="display:flex;gap:10px;margin-top:4px;">
        <button type="button" class="btn btn-secondary" id="crop-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-primary" id="crop-apply-btn" style="flex:1;">Use Profile Pic ✓</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const stage = overlay.querySelector('#crop-stage');
  const previewCanvas = overlay.querySelector('#crop-preview-canvas');
  const pctx = previewCanvas.getContext('2d');
  const zoomRange = overlay.querySelector('#crop-zoom-range');
  const zoomLabel = overlay.querySelector('#crop-zoom-val');

  const presetBtns = {
    nocut: overlay.querySelector('#crop-preset-nocut'),
    safe: overlay.querySelector('#crop-preset-safe'),
    fill: overlay.querySelector('#crop-preset-fill')
  };

  const setActivePreset = (key) => {
    Object.entries(presetBtns).forEach(([k, btn]) => btn.classList.toggle('active', k === key));
  };

  const redraw = () => {
    const rendered = renderFramedAvatarCanvas(img, 240, { zoom, offsetX, offsetY, backdrop });
    pctx.clearRect(0, 0, 240, 240);
    pctx.drawImage(rendered, 0, 0);
    zoomRange.value = String(zoom);
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };

  redraw();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  stage.onpointerdown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  };
  stage.onpointermove = (e) => {
    if (!dragging) return;
    const rect = stage.getBoundingClientRect();
    offsetX += (e.clientX - lastX) / rect.width;
    offsetY += (e.clientY - lastY) / rect.height;
    offsetX = Math.max(-0.8, Math.min(0.8, offsetX));
    offsetY = Math.max(-0.8, Math.min(0.8, offsetY));
    lastX = e.clientX;
    lastY = e.clientY;
    redraw();
  };
  const stopDrag = () => {
    dragging = false;
  };
  stage.onpointerup = stopDrag;
  stage.onpointercancel = stopDrag;

  stage.onwheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.06 : -0.06;
    zoom = Math.max(Number(zoomRange.min), Math.min(Number(zoomRange.max), Number((zoom + delta).toFixed(2))));
    setActivePreset('');
    redraw();
  };

  zoomRange.oninput = () => {
    zoom = Number(zoomRange.value);
    setActivePreset('');
    redraw();
  };

  presetBtns.nocut.onclick = () => {
    zoom = Number(Math.max(0.55, zeroCutoutMultiplier).toFixed(2));
    offsetX = 0;
    offsetY = 0;
    setActivePreset('nocut');
    redraw();
  };
  presetBtns.safe.onclick = () => {
    zoom = Number(Math.max(0.65, Math.min(0.88, zeroCutoutMultiplier * 1.12)).toFixed(2));
    offsetX = 0;
    offsetY = 0;
    setActivePreset('safe');
    redraw();
  };
  presetBtns.fill.onclick = () => {
    zoom = Number(Math.max(1.0, coverMultiplier).toFixed(2));
    offsetX = 0;
    offsetY = 0;
    setActivePreset('fill');
    redraw();
  };

  overlay.querySelectorAll('[data-crop-bg]').forEach((btn) => {
    btn.onclick = () => {
      overlay.querySelectorAll('[data-crop-bg]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      backdrop = btn.dataset.cropBg;
      redraw();
    };
  });

  overlay.querySelector('#crop-recenter').onclick = () => {
    offsetX = 0;
    offsetY = 0;
    redraw();
  };

  const close = () => overlay.remove();
  overlay.querySelector('#crop-cancel-x').onclick = close;
  overlay.querySelector('#crop-cancel-btn').onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  overlay.querySelector('#crop-apply-btn').onclick = () => {
    const out = renderFramedAvatarCanvas(img, 320, { zoom, offsetX, offsetY, backdrop });
    const dataUrl = out.toDataURL('image/jpeg', 0.90);
    close();
    onConfirm?.(dataUrl);
  };
}
