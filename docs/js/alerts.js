// ── ALERTS INBOX ──────────────────────────────────────────────
// Inbox · Archived · Cleared — like email + phone notifications.
//   ✓ mark read (or tap to open)   🗄 archive (kept, dated)   ✕ clear (swipe left on phone)
//   ↩ restore from Archived/Cleared back to the Inbox. Checkboxes for bulk actions.
// Writes go through the worker's authenticated /alerts/action route.

const ALERTS = { view: 'inbox', items: [], selected: new Set(), open: new Set() };

const _esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const _when = d => d ? new Date(d).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
const _state = a => a.archived_at ? 'archived' : a.dismissed_at ? 'cleared' : 'inbox';

async function loadAlerts() {
  const el = document.getElementById('alerts-log');
  if (IS_GUEST) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view alerts</div>';
    return;
  }
  const r = await fetch(`${PROXY}/alerts?select=*&order=created_at.desc&limit=300`);
  if (!r.ok) throw new Error(`${r.status} alerts`);
  ALERTS.items = await r.json();
  renderAlerts();
}

function alertCounts() {
  const c = { inbox: 0, unread: 0, archived: 0, cleared: 0 };
  ALERTS.items.forEach(a => { const s = _state(a); c[s]++; if (s === 'inbox' && !a.read_at) c.unread++; });
  return c;
}

function updateAlertBadge() {
  const btn = document.querySelector("nav button[onclick*=\"'alerts'\"]");
  if (!btn) return;
  const n = alertCounts().unread;
  btn.innerHTML = `🔔 Alerts${n ? ` <span class="nav-badge">${n}</span>` : ''}`;
}

function renderAlerts() {
  const el = document.getElementById('alerts-log');
  const c = alertCounts();
  const v = ALERTS.view;
  const list = ALERTS.items.filter(a => _state(a) === v);
  // drop selections that are no longer visible
  ALERTS.selected = new Set([...ALERTS.selected].filter(id => list.some(a => a.id === id)));
  const sel = ALERTS.selected.size;
  const allSel = list.length && sel === list.length;

  const tabs = [
    ['inbox',    `📥 Inbox${c.unread ? ` <span class="nav-badge">${c.unread}</span>` : ''}`],
    ['archived', `🗄 Archived <span class="a-count">${c.archived}</span>`],
    ['cleared',  `🧹 Cleared <span class="a-count">${c.cleared}</span>`],
  ].map(([k, label]) => `<button class="a-tab${v === k ? ' active' : ''}" onclick="alertsView('${k}')">${label}</button>`).join('');

  const bulk = v === 'inbox'
    ? `<button onclick="alertsBulk('read')"    ${sel ? '' : 'disabled'}>✓ Mark read</button>
       <button onclick="alertsBulk('archive')" ${sel ? '' : 'disabled'}>🗄 Archive</button>
       <button onclick="alertsBulk('dismiss')" ${sel ? '' : 'disabled'}>✕ Clear</button>
       <button class="a-ghost" onclick="alertsClearRead()" ${list.some(a => a.read_at) ? '' : 'disabled'}>Clear all read</button>`
    : v === 'archived'
    ? `<button onclick="alertsBulk('restore')" ${sel ? '' : 'disabled'}>↩ Restore</button>
       <button onclick="alertsBulk('dismiss')" ${sel ? '' : 'disabled'}>✕ Clear</button>`
    : `<button onclick="alertsBulk('restore')" ${sel ? '' : 'disabled'}>↩ Restore</button>
       <button onclick="alertsBulk('archive')" ${sel ? '' : 'disabled'}>🗄 Archive</button>`;

  const empty = { inbox: '🎉 All caught up — no alerts in your inbox.', archived: 'Nothing archived yet.', cleared: 'Nothing cleared.' }[v];

  el.innerHTML = `
    <div class="a-tabs">${tabs}</div>
    <div class="a-toolbar">
      <label class="a-check"><input type="checkbox" ${allSel ? 'checked' : ''} ${list.length ? '' : 'disabled'} onchange="alertsSelectAll(this.checked)"> ${sel ? `${sel} selected` : 'Select all'}</label>
      <div class="a-actions">${bulk}</div>
    </div>
    <div id="alerts-list">${list.length ? list.map(alertCard).join('') : `<div class="loading">${empty}</div>`}</div>
    ${v === 'inbox' ? '<div class="a-hint">Tap an alert to read it · swipe left to clear · 🗄 keeps it in Archived with the date</div>' : ''}`;
  bindSwipes();
  updateAlertBadge();
}

function alertCard(a) {
  const type = a.alert_type || a.type || 'info';
  const t = a.title || '';
  const st = _state(a);
  let cls = type === 'buy' ? 'buy' : (type === 'sell' || type === 'trim') ? 'sell' : '';
  if (type === 'report') cls = t.startsWith('✅') ? 'buy' : t.startsWith('❔') ? 'muted' : '';
  const unread = st === 'inbox' && !a.read_at;
  const open = ALERTS.open.has(a.id);
  const structured = /\nMeasure\s/.test('\n' + (a.body || '')) || type === 'report';
  const btns = st === 'inbox'
    ? `${unread ? `<button title="Mark read" onclick="alertsAct(event,[${a.id}],'read')">✓</button>`
                : `<button title="Mark unread" onclick="alertsAct(event,[${a.id}],'unread')">●</button>`}
       <button title="Archive" onclick="alertsAct(event,[${a.id}],'archive')">🗄</button>
       <button title="Clear" onclick="alertsAct(event,[${a.id}],'dismiss')">✕</button>`
    : `<button title="Restore to inbox" onclick="alertsAct(event,[${a.id}],'restore')">↩</button>`;
  const stamp = st === 'archived' ? `<span class="a-stamp">🗄 Archived ${_when(a.archived_at)}</span>`
              : st === 'cleared'  ? `<span class="a-stamp">🧹 Cleared ${_when(a.dismissed_at)}</span>` : '';
  return `<div class="alert-item ${cls}${unread ? ' unread' : ''}" data-id="${a.id}">
    <div class="a-row">
      <input type="checkbox" class="a-sel" ${ALERTS.selected.has(a.id) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="alertsSelect(${a.id}, this.checked)">
      <div class="a-main" onclick="alertsToggle(${a.id})">
        <div class="a-title">${unread ? '<span class="a-dot"></span>' : ''}${_esc(t)}</div>
        <div class="a-time">${_when(a.created_at)} · ${_esc(type)}${a.pie ? ` · ${_esc(a.pie)}` : ''} ${stamp}</div>
      </div>
      <div class="a-btns">${btns}</div>
    </div>
    ${open ? `<div class="a-body${structured ? ' a-report' : ''}">${_esc(a.body)}</div>` : ''}
  </div>`;
}

// ── interactions ──────────────────────────────────────────────
function alertsView(v) { ALERTS.view = v; ALERTS.selected.clear(); renderAlerts(); }
function alertsSelect(id, on) { on ? ALERTS.selected.add(id) : ALERTS.selected.delete(id); renderAlerts(); }
function alertsSelectAll(on) {
  ALERTS.selected = new Set(on ? ALERTS.items.filter(a => _state(a) === ALERTS.view).map(a => a.id) : []);
  renderAlerts();
}
function alertsToggle(id) {
  const a = ALERTS.items.find(x => x.id === id);
  if (ALERTS.open.has(id)) ALERTS.open.delete(id); else ALERTS.open.add(id);
  if (a && _state(a) === 'inbox' && !a.read_at) return alertsAct(null, [id], 'read');
  renderAlerts();
}
function alertsBulk(action) { alertsAct(null, [...ALERTS.selected], action); }
function alertsClearRead() {
  const ids = ALERTS.items.filter(a => _state(a) === 'inbox' && a.read_at).map(a => a.id);
  if (ids.length) alertsAct(null, ids, 'dismiss');
}

const _LOCAL = {
  read:    n => ({ read_at: n }),
  unread:  () => ({ read_at: null }),
  archive: n => ({ archived_at: n, dismissed_at: null, read_at: n }),
  dismiss: n => ({ dismissed_at: n, archived_at: null, read_at: n }),
  restore: () => ({ archived_at: null, dismissed_at: null }),
};

async function alertsAct(ev, ids, action) {
  if (ev) ev.stopPropagation();
  if (!ids.length) return;
  const now = new Date().toISOString();
  const before = ALERTS.items.map(a => ({ ...a }));
  const leaving = ['archive', 'dismiss', 'restore'].includes(action);

  // slide cards out, then update (optimistic)
  if (leaving) {
    ids.forEach(id => document.querySelector(`.alert-item[data-id="${id}"]`)?.classList.add(action === 'archive' ? 'leaving-archive' : 'leaving'));
    await new Promise(r => setTimeout(r, 220));
  }
  ALERTS.items.forEach(a => { if (ids.includes(a.id)) Object.assign(a, _LOCAL[action](now)); });
  ids.forEach(id => ALERTS.selected.delete(id));
  renderAlerts();

  try {
    const r = await fetch(`${PROXY}/alerts/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SESSION_TOKEN, ids, action }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    if (leaving) alertsToast(ids, action);
  } catch (e) {
    ALERTS.items = before; renderAlerts();
    alertsToast(null, null, `Couldn't save: ${e.message}${/session/i.test(e.message) ? ' — sign in again' : ''}`);
  }
}

// undo toast
let _toastTimer;
function alertsToast(ids, action, error) {
  let t = document.getElementById('alerts-toast');
  if (!t) { t = document.createElement('div'); t.id = 'alerts-toast'; document.body.appendChild(t); }
  const label = { archive: 'Archived', dismiss: 'Cleared', restore: 'Restored to inbox' }[action];
  const undo = { archive: 'restore', dismiss: 'restore', restore: null }[action];
  t.className = 'show' + (error ? ' err' : '');
  t.innerHTML = error ? _esc(error)
    : `${label} ${ids.length > 1 ? `${ids.length} alerts` : ''}${undo ? ` <button onclick="alertsUndo([${ids}])">Undo</button>` : ''}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.className = '', 5000);
}
function alertsUndo(ids) {
  document.getElementById('alerts-toast').className = '';
  const prev = ALERTS.view;
  alertsAct(null, ids, 'restore').then(() => { ALERTS.view = prev; renderAlerts(); });
}

// swipe left to clear (phone)
function bindSwipes() {
  if (ALERTS.view !== 'inbox') return;
  document.querySelectorAll('#alerts-list .alert-item').forEach(card => {
    let x0 = null, y0 = null, dx = 0;
    card.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; card.style.transition = 'none'; }, { passive: true });
    card.addEventListener('touchmove', e => {
      if (x0 === null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (Math.abs(my) > Math.abs(mx)) return;   // vertical scroll
      dx = Math.min(0, mx);
      card.style.transform = `translateX(${dx}px)`; card.style.opacity = String(1 + dx / 300);
    }, { passive: true });
    card.addEventListener('touchend', () => {
      card.style.transition = ''; x0 = null;
      if (dx < -90) alertsAct(null, [Number(card.dataset.id)], 'dismiss');
      else { card.style.transform = ''; card.style.opacity = ''; }
    });
  });
}
