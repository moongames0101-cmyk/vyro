// Moderation tab (only shown to accounts listed in VYRO_ADMINS): review reports, ban from Live, gift VYRO+.
import { api } from '../api.js';
import { renderAvatarHtml } from '../icons.js';
import { escapeHtml, toast } from '../state.js';

const KIND_LABELS = {
  underage_live: 'Looks under 18 on Live',
  inappropriate: 'Sexual or graphic',
  harassment: 'Bullying or hate',
  spam: 'Spam or scam',
  age_check: 'Face scan looked under 18',
  other: 'Other'
};

export async function renderModPanel(body) {
  body.innerHTML = `<div class="field-hint">Loading reports...</div>`;
  let reports = [];
  try {
    reports = (await api('/api/admin/reports')).reports || [];
  } catch (err) {
    body.innerHTML = `<div class="auth-error-banner">${escapeHtml(err.message)}</div>`;
    return;
  }

  body.innerHTML = `<div class="plus-panel">
    <div class="plus-sub-title">Open reports (${reports.length})</div>
    ${
      reports.length
        ? reports
            .map(
              (r) => `<div class="mod-report">
                <div style="display:flex;gap:10px;align-items:center;min-width:0;">
                  ${r.target ? renderAvatarHtml(r.target, 38) : ''}
                  <div style="min-width:0;">
                    <strong>${escapeHtml(r.target ? `${r.target.displayName} (@${r.target.username})` : 'Deleted user')}</strong>
                    <div class="field-hint">${escapeHtml(KIND_LABELS[r.kind] || r.kind)} • ${r.kind === 'age_check' ? 'flagged by the VYRO face scan' : `reported by @${escapeHtml(r.reporter?.username || '?')}`} • ${new Date(r.createdAt).toLocaleString()}</div>
                    ${r.reason ? `<div style="font-size:12.5px;color:var(--text-secondary);margin-top:3px;">“${escapeHtml(r.reason)}”</div>` : ''}
                    ${r.target?.liveBanned ? '<div class="field-hint" style="color:#F87171;">Already banned from Live</div>' : ''}
                  </div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                  <button class="btn btn-secondary btn-sm" data-resolve="${escapeHtml(r.id)}" data-action="dismiss">Dismiss</button>
                  <button class="btn btn-danger btn-sm" data-resolve="${escapeHtml(r.id)}" data-action="live_ban">Ban from Live</button>
                </div>
              </div>`
            )
            .join('')
        : '<div class="field-hint">No open reports. 🎉</div>'
    }
    <form class="plus-customise" id="mod-ban-form">
      <div class="plus-sub-title">Ban someone from going live</div>
      <span class="field-hint">For under-18s found going live. This is permanent.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input class="input-control" id="mod-ban-user" placeholder="username" style="flex:1;min-width:140px;" required />
        <button class="btn btn-danger btn-sm" type="submit">Ban from Live</button>
      </div>
    </form>
    <form class="plus-customise" id="mod-gift-form">
      <div class="plus-sub-title">Gift VYRO+</div>
      <span class="field-hint">For giveaways or testing. 0 days removes a gift.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input class="input-control" id="mod-gift-user" placeholder="username" style="flex:1;min-width:140px;" required />
        <input class="input-control" id="mod-gift-days" type="number" min="0" max="366" value="30" style="width:90px;" />
        <button class="btn btn-primary btn-sm" type="submit">Gift</button>
      </div>
    </form>
  </div>`;

  body.querySelectorAll('[data-resolve]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/reports/${b.dataset.resolve}/resolve`, { method: 'POST', body: { action: b.dataset.action } });
        toast(b.dataset.action === 'live_ban' ? 'Banned from Live.' : 'Report dismissed.', 'success');
        renderModPanel(body);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
  body.querySelector('#mod-ban-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/live-ban', { method: 'POST', body: { username: body.querySelector('#mod-ban-user').value.trim() } });
      toast('Banned from Live.', 'success');
      renderModPanel(body);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  body.querySelector('#mod-gift-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/plus/gift', {
        method: 'POST',
        body: { username: body.querySelector('#mod-gift-user').value.trim(), days: Number(body.querySelector('#mod-gift-days').value) }
      });
      toast('VYRO+ gift updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
