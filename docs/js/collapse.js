// Collapsible dashboard sections: click (or tap) any card heading to fold/unfold that card.
// State is saved to the database per user (table user_ui_prefs, own row only) so it follows your account across
// devices and logins. A copy is cached in this browser (keyed by user id) for instant display and as a fallback.
(function () {
  'use strict';
  const LEGACY_KEY = 'cl_collapsed';
  let saved = {}, uid = null, loadedFor = null, loadingFor = null, saveTimer = null;

  const dbMode = () => {
    try { return typeof SESSION_TOKEN !== 'undefined' && !!SESSION_TOKEN && typeof PROXY === 'string' && PROXY.indexOf('/rest/v1') > 0 && typeof SUPABASE_KEY !== 'undefined'; }
    catch (e) { return false; }
  };
  const uidFromToken = () => {
    try { return JSON.parse(atob(SESSION_TOKEN.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || null; } catch (e) { return null; }
  };
  const cacheKey = () => (uid ? LEGACY_KEY + ':' + uid : LEGACY_KEY);
  const readCache = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
  const dbHeaders = extra => Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN }, extra || {});

  const persist = () => {
    try { localStorage.setItem(cacheKey(), JSON.stringify(saved)); } catch (e) {}
    if (!dbMode() || !uid || loadedFor !== uid) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!dbMode() || loadedFor !== uid) return;
      fetch(PROXY + '/user_ui_prefs', { method: 'POST',
        headers: dbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify({ user_id: uid, prefs: saved, updated_at: new Date().toISOString() }) }).catch(() => {});
    }, 700);
  };

  // Browser-only mode (single-user page without a database sign-in)
  if (!dbMode()) saved = readCache(LEGACY_KEY);

  function headOf(card) {
    const h = card.querySelector('h3');
    if (!h || h.closest('.card') !== card || h.closest('.pb-m-box,[role=dialog]')) return null;
    let head = h;
    while (head.parentElement && head.parentElement !== card) head = head.parentElement;
    if (head.parentElement !== card) return null;
    return { h, head };
  }
  function keyOf(card, h) {
    const tab = (card.closest('.tab') || {}).id || '';
    return tab + '|' + (h.textContent || '').trim().slice(0, 60);
  }
  function setup() {
    document.querySelectorAll('.card').forEach(card => {
      const x = headOf(card);
      if (!x) return;
      if (!x.head.classList.contains('coll-head')) {
        x.head.classList.add('coll-head');
        x.h.setAttribute('role', 'button'); x.h.tabIndex = 0;
        // only apply the remembered state when the card is first seen
        if (saved[keyOf(card, x.h)]) card.classList.add('coll');
      }
      x.h.setAttribute('aria-expanded', card.classList.contains('coll') ? 'false' : 'true');
    });
  }
  function toggle(h) {
    const card = h.closest('.card');
    if (!card || !headOf(card)) return;
    const on = card.classList.toggle('coll');
    h.setAttribute('aria-expanded', on ? 'false' : 'true');
    const k = keyOf(card, h);
    if (on) saved[k] = 1; else delete saved[k];
    persist();
    if (!on) window.dispatchEvent(new Event('resize'));   // let charts re-measure
  }
  document.addEventListener('click', e => {
    const h = e.target.closest && e.target.closest('.card h3[role=button]');
    if (h && !e.target.closest('button,a,input,select')) toggle(h);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.card h3[role=button]')) { e.preventDefault(); toggle(e.target); }
  });
  // Sub-sections inside a card (e.g. each sector or country box): click the small header to fold the box.
  function subKey(box) { return 'sub|' + (box.closest('.tab') || {}).id + '|' + box.getAttribute('data-sub'); }
  function subSetup() {
    document.querySelectorAll('[data-sub]:not([data-sub-ready])').forEach(box => {
      box.setAttribute('data-sub-ready', '1');
      const h = box.querySelector('[data-sub-head]');
      if (h) { h.setAttribute('role', 'button'); h.tabIndex = 0; }
      if (saved[subKey(box)]) box.classList.add('sub-closed');
    });
  }
  function subToggle(h) {
    const box = h.closest('[data-sub]'); if (!box) return;
    const on = box.classList.toggle('sub-closed');
    if (on) saved[subKey(box)] = 1; else delete saved[subKey(box)];
    persist();
  }
  document.addEventListener('click', e => {
    const h = e.target.closest && e.target.closest('[data-sub-head]');
    if (h && !e.target.closest('a,button,input,select')) subToggle(h);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-sub-head]')) { e.preventDefault(); subToggle(e.target); }
  });

  // ── Older open/close widgets (Positions pies, Profit Booking holdings, Strategy rows): remember them too ──
  const OPEN = (saved.o = saved.o || {});
  const txt = (el, n) => ((el && el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, n || 40);
  function restoreOpen() {
    document.querySelectorAll('.pie-header:not([data-oready])').forEach(h => {
      h.setAttribute('data-oready', '1');
      const k = 'pie|' + txt(h.querySelector('.pie-name'), 40), b = h.nextElementSibling;
      if (b && OPEN[k] !== undefined) b.classList.toggle('open', !!OPEN[k]);
    });
    document.querySelectorAll('.pb-hold-head:not([data-oready])').forEach(h => {
      h.setAttribute('data-oready', '1');
      const k = 'pb|' + txt(h.firstElementChild, 30), b = h.nextElementSibling;
      if (b && OPEN[k] !== undefined) {
        b.classList.toggle('open', !!OPEN[k]);
        const c = h.querySelector('[id^=pb-chev-]'); if (c) c.textContent = OPEN[k] ? '▲' : '▼';
      }
    });
    document.querySelectorAll('[id^=vb-][id]:not([data-oready]), [id^=inst-collapse-][id]:not([data-oready])').forEach(b => {
      if (/-chevron$/.test(b.id)) return;
      b.setAttribute('data-oready', '1');
      const k = 'vb|' + b.id;
      if (OPEN[k] !== undefined) {
        b.style.display = OPEN[k] ? 'block' : 'none';
        const c = document.getElementById(b.id + '-chevron'); if (c) c.textContent = OPEN[k] ? '▲' : '▼';
      }
    });
  }
  function wrap(name, after) {
    const f = window[name]; if (typeof f !== 'function') return;
    window[name] = function () { const r = f.apply(this, arguments); try { after.apply(this, arguments); persist(); } catch (e) {} return r; };
  }
  wrap('togglePie', header => { OPEN['pie|' + txt(header.querySelector('.pie-name'), 40)] = header.nextElementSibling.classList.contains('open') ? 1 : 0; });
  wrap('pbToggle', i => { const b = document.getElementById('pb-body-' + i), h = b && b.previousElementSibling;
    if (h) OPEN['pb|' + txt(h.firstElementChild, 30)] = b.classList.contains('open') ? 1 : 0; });
  wrap('toggleVB', id => { const b = document.getElementById(id); if (b) OPEN['vb|' + id] = b.style.display !== 'none' ? 1 : 0; });

  // Re-apply the saved state to everything already on screen (used when the database copy arrives)
  function applyAll() {
    document.querySelectorAll('.card.coll').forEach(c => c.classList.remove('coll'));
    document.querySelectorAll('.coll-head').forEach(h => h.classList.remove('coll-head'));
    document.querySelectorAll('.sub-closed').forEach(b => b.classList.remove('sub-closed'));
    document.querySelectorAll('[data-sub-ready],[data-oready]').forEach(e => { e.removeAttribute('data-sub-ready'); e.removeAttribute('data-oready'); });
    setup(); subSetup(); restoreOpen();
    if (window.ClAppearance) window.ClAppearance.adopt(saved.__appearance);   // theme / font / size follow the account
  }
  window.ClPrefs = { set(k, v) { saved[k] = v; persist(); }, get(k) { return saved[k]; }, ready() { return !dbMode() || (!!uid && loadedFor === uid); } };   // other modules (appearance.js) keep their per-user choices in the same row
  function replaceSaved(obj) {
    Object.keys(OPEN).forEach(k => delete OPEN[k]);
    Object.keys(saved).forEach(k => { if (k !== 'o') delete saved[k]; });
    Object.keys(obj).forEach(k => { if (k !== 'o') saved[k] = obj[k]; });
    Object.assign(OPEN, obj.o || {});
  }
  async function loadFromDb(u) {
    const cached = readCache(cacheKey());
    if (Object.keys(cached).length) { replaceSaved(cached); applyAll(); }      // instant, from this browser's copy
    try {
      const r = await fetch(PROXY + '/user_ui_prefs?select=prefs', { headers: dbHeaders() });
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      if (rows.length) { replaceSaved(rows[0].prefs || {}); applyAll(); loadedFor = u; }
      else {                                                                    // first time: adopt earlier browser-only settings
        const old = Object.keys(cached).length ? cached : readCache(LEGACY_KEY);
        if (Object.keys(old).length) { replaceSaved(old); applyAll(); }
        loadedFor = u; persist();
      }
    } catch (e) { setTimeout(() => { if (loadingFor === u && loadedFor !== u) loadingFor = null; }, 10000); }   // retry later
  }
  setInterval(() => {
    if (dbMode()) {
      const u = uidFromToken();
      if (u && loadingFor !== u) { uid = u; loadingFor = u; loadedFor = null; loadFromDb(u); }
    } else if (uid) {                                                           // signed out: drop this user's state from memory
      uid = null; loadedFor = null; loadingFor = null; replaceSaved({}); applyAll();
    }
  }, 600);

  let t = null;
  new MutationObserver(() => { if (!t) t = requestAnimationFrame(() => { t = null; setup(); subSetup(); restoreOpen(); }); })
    .observe(document.documentElement, { childList: true, subtree: true });

  const css = document.createElement('style');
  css.textContent =
    '.card h3[role=button]{cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}' +
    '.card h3[role=button]::before{content:"\\25BE";display:inline-block;width:14px;margin-right:4px;transition:transform .15s;color:var(--muted)}' +
    '.card.coll h3[role=button]::before{transform:rotate(-90deg)}' +
    '[data-sub-head]{cursor:pointer;user-select:none}.sub-chev{display:inline-block;width:14px;color:var(--muted);transition:transform .15s}' +
    '.sub-closed .sub-chev{transform:rotate(-90deg)}.sub-closed [data-sub-body]{display:none!important}.sub-closed [data-sub-head]{border-bottom-color:transparent!important}' +
    '.card.coll>*:not(.coll-head){display:none!important}' +
    '.card.coll .coll-head h3,.card.coll>h3{margin-bottom:0}';
  document.head.appendChild(css);
  setup(); subSetup(); restoreOpen();
})();
