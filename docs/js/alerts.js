// ── ALERTS INBOX ──────────────────────────────────────────────
// Inbox · Archived · Cleared — like email + phone notifications.
//   ✓ mark read (or tap to open)   🗄 archive (kept, dated)   ✕ clear (swipe left on phone)
//   ↩ restore from Archived/Cleared back to the Inbox. Checkboxes for bulk actions.
// Writes go through the worker's authenticated /alerts/action route.

const ALERTS = { view: 'inbox', tab: 'live', items: [], selected: new Set(), open: new Set() };
// Market signals (100/200-day average crosses, 52-week highs): Live · Pre Market · Post Market tabs on top, the Inbox is one more tab (docs/js/signals.js)
const SIG = { state: 'idle', rows: [], failed: [], total: 0, done: 0, at: null, expanded: new Set(), error: '' };

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
  const el = document.getElementById('alerts-log'); if (!el) return;
  const c = alertCounts(), head = alertsHead(c);
  if (ALERTS.tab === 'inbox' || typeof Signals === 'undefined') { el.innerHTML = head + inboxHtml(c); bindSwipes(); }
  else { el.innerHTML = head + marketHtml(); alertsEnsureScan(); }
  updateAlertBadge();
}

function alertsHead(c) {
  const day = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const t = ALERTS.tab, tab = (k, label) => `<button type="button" class="al-tab${t === k ? ' on' : ''}" data-al-tab="${k}" role="tab" aria-selected="${t === k}">${label}</button>`;
  return `<div class="al-head"><div class="al-date">${_esc(day)}</div><button type="button" class="al-inbox${t === 'inbox' ? ' on' : ''}" data-al-tab="inbox">📥 Inbox${c.unread ? ` <span class="nav-badge">${c.unread}</span>` : ''}</button></div>
    <div class="al-tabs" role="tablist">${tab('live', '☀️ Live')}${tab('pre', '🌤️ Pre Market')}${tab('post', '🌙 Post Market')}</div>`;
}

const AL_NOTE = {
  live: "Today's session while it is running (UK 08:00–16:30, US 14:30–21:00 UK time).",
  pre: "What was already true at today's open: the last completed daily close.",
  post: "Today's completed session, once that market has closed.",
};
function marketHtml() {
  const v = ALERTS.tab, note = `<div class="sg-note">${_esc(AL_NOTE[v])}</div>`;
  if (SIG.state === 'busy' || SIG.state === 'idle') return `${note}<div class="loading busy">Scanning your holdings and watchlist${SIG.total ? ` (${SIG.done}/${SIG.total})` : ''}…</div>`;
  if (SIG.state === 'error') return `${note}<div class="sg-empty">Signals could not be loaded (${_esc(SIG.error)}). <button type="button" class="sg-more" data-al-rescan>Try again</button></div>`;
  const rows = SIG.rows, openNow = rows.filter(r => r.a.open).length, doneToday = rows.filter(r => r.a.doneToday).length;
  const empty = v === 'live' ? (openNow ? 'Nothing has crossed a 100 / 200-day average or made a 52-week high in the markets that are open.' : 'No market you hold or watch is open right now. See Pre Market for what was true at the open, or Post Market once today has closed.')
    : v === 'post' ? (doneToday ? 'Nothing crossed a 100 / 200-day average or made a 52-week high at today\'s close.' : 'No market you hold or watch has closed today yet.')
    : 'Nothing was crossing a 100 / 200-day average or at a 52-week high at the last close.';
  const when = SIG.at ? new Date(SIG.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  return `${note}${Signals.html(Signals.group(rows, v), { expanded: SIG.expanded, empty })}
    <div class="sg-note">Checked ${rows.length} of ${SIG.total} holdings and watchlist stocks at ${when}${SIG.failed.length ? ` · ${SIG.failed.length} could not be read (${_esc(SIG.failed.slice(0, 6).join(', '))}${SIG.failed.length > 6 ? '…' : ''}), so nothing is claimed for them` : ''}. From Yahoo daily closes, fetched when you open this tab. A cross means the close moved to the other side of the average since the session before. A screening aid, not advice. <button type="button" class="sg-more sg-inline" data-al-rescan>Rescan</button></div>`;
}

// stocks to scan: everything you hold that maps to a Yahoo symbol, plus your watchlist (one fetch per symbol; the worker/relay does the Yahoo call)
async function alertsInputs() {
  const out = [], yahooOf = (typeof SupportLevels !== 'undefined' && SupportLevels.yahooOf) || (() => null);
  const snap = (await api('portfolio_snapshots', '?select=id&order=created_at.desc&limit=1'))[0];
  const pos = snap ? await api('positions', `?snapshot_id=eq.${snap.id}&select=ticker,display`) : [];
  (pos || []).forEach(p => { const y = yahooOf(p.ticker); if (y) out.push({ symbol: y[0], name: p.display || y[0], src: 'holding' }); });
  const wl = await api('watchlist', '?select=ticker,name').catch(() => []);
  (wl || []).forEach(w => { if (w && w.ticker) out.push({ symbol: String(w.ticker), name: String(w.ticker).replace(/\.[A-Z]{1,3}$/, ''), src: 'watch' }); });
  return out;
}
async function alertsChart(symbol) {
  const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: SESSION_TOKEN, symbol, range: '1y' }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.points || !d.points.length) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function alertsEnsureScan(fresh) {
  const panel = document.getElementById('alerts');
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) return;
  if (!panel || !panel.classList.contains('active')) return;                 // alerts are preloaded at sign-in: only scan once the tab is really open
  if (SIG.state === 'busy' || (SIG.state === 'done' && !fresh)) return;
  SIG.state = 'busy'; SIG.done = 0; SIG.total = 0; SIG.error = ''; if (fresh) Signals.clearCache();
  const repaint = () => { if (ALERTS.tab !== 'inbox') { const el = document.getElementById('alerts-log'); const n = el && el.querySelector('.loading.busy'); if (n && SIG.state === 'busy') n.textContent = `Scanning your holdings and watchlist${SIG.total ? ` (${SIG.done}/${SIG.total})` : ''}…`; } };
  try {
    const inputs = await alertsInputs(), res = await Signals.scan(inputs, { fresh: !!fresh, chart: alertsChart, onProgress: (d, t) => { SIG.done = d; SIG.total = t; repaint(); } });
    Object.assign(SIG, { rows: res.rows, failed: res.failed, total: res.total, at: res.at, state: 'done' });
  } catch (e) { SIG.state = 'error'; SIG.error = e.message || 'error'; }
  renderAlerts();
}
function alertsShown() { if (ALERTS.tab !== 'inbox') alertsEnsureScan(); }

document.addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target.closest('[data-al-tab],[data-al-more],[data-al-rescan]') : null; if (!t) return;
  if (t.hasAttribute('data-al-tab')) { ALERTS.tab = t.getAttribute('data-al-tab'); ALERTS.selected.clear(); renderAlerts(); }
  else if (t.hasAttribute('data-al-more')) { SIG.expanded.add(t.getAttribute('data-al-more')); renderAlerts(); }
  else { SIG.state = 'idle'; alertsEnsureScan(true); renderAlerts(); }
});

function inboxHtml(c) {
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

  return `
    <div class="a-tabs">${tabs}</div>
    <div class="a-toolbar">
      <label class="a-check"><input type="checkbox" ${allSel ? 'checked' : ''} ${list.length ? '' : 'disabled'} onchange="alertsSelectAll(this.checked)"> ${sel ? `${sel} selected` : 'Select all'}</label>
      <div class="a-actions">${bulk}</div>
    </div>
    <div id="alerts-list">${list.length ? list.map(alertCard).join('') : `<div class="loading">${empty}</div>`}</div>
    ${v === 'inbox' ? '<div class="a-hint">Tap an alert to read it · swipe left to clear · 🗄 keeps it in Archived with the date</div>' : ''}`;
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
function alertsView(v) { ALERTS.view = v; ALERTS.tab = 'inbox'; ALERTS.selected.clear(); renderAlerts(); }
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
