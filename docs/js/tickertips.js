// Global instrument tooltip: hover (desktop) or tap (phone) any ticker label on any dashboard
// to see the country flag + full name + what it is. All names/flags come from the database
// (instrument_exposure); RLS only returns instruments the signed-in user holds or watches.
// Nothing about any holding is stored in this file.
(function () {
  'use strict';
  let map = null, loading = null, tip = null, cur = null;

  function aliases(t) {
    const a = new Set([t]);
    const base = t.replace(/_EQ$/, '');
    a.add(base);
    a.add(base.replace(/_US$/, ''));
    return a;
  }

  async function load() {
    if (map) return map;
    if (loading) return loading;
    loading = (async () => {
      const m = {};
      try {
        const rows = await api('instrument_exposure', '?select=ticker,display_name,flag,exposure');
        rows.forEach(r => aliases(r.ticker).forEach(k => { m[k] = r; }));
        if (rows.length) map = m;
      } catch (e) { /* not signed in yet: try again next time */ }
      loading = null;
      return m;
    })();
    return loading;
  }

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'tt-global';
    tip.style.cssText = 'position:fixed;z-index:99999;display:none;pointer-events:none;max-width:260px;' +
      'background:#0f1117;border:1px solid #2d3353;border-radius:8px;padding:8px 10px;font-size:12px;' +
      'line-height:1.4;color:#e2e8f0;box-shadow:0 6px 20px rgba(0,0,0,.5)';
    document.body.appendChild(tip);
    return tip;
  }

  function fill(r, sym, note) {
    const t = ensureTip();
    t.textContent = '';
    const h = document.createElement('div');
    h.style.fontWeight = '700';
    h.textContent = ((r.flag || '') + ' ' + r.display_name).trim();
    t.appendChild(h);
    const parts = [sym, r.exposure].filter(Boolean).join(' · ');
    if (parts) { const d = document.createElement('div'); d.style.cssText = 'color:#94a3b8;font-size:11px'; d.textContent = parts; t.appendChild(d); }
    if (note) { const d = document.createElement('div'); d.style.cssText = 'color:#64748b;font-size:11px'; d.textContent = note; t.appendChild(d); }
  }

  function place(x, y) {
    const t = ensureTip();
    t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    let left = x + 14, top = y + 16;
    if (left + w > innerWidth - 6) left = Math.max(6, x - w - 14);
    if (top + h > innerHeight - 6) top = Math.max(6, y - h - 14);
    t.style.left = left + 'px'; t.style.top = top + 'px';
  }

  function hide() { if (tip) tip.style.display = 'none'; cur = null; }

  function candidate(el) {
    if (!el || el.nodeType !== 1 || el.closest('#tt-global,#rad-tooltip,[data-sym],input,textarea,select')) return null;
    if (el.children.length) return null;                 // leaf elements only
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 20) return null;
    return txt;
  }

  async function show(e) {
    const el = e.target;
    const txt = candidate(el);
    if (!txt) { if (cur) hide(); return; }
    const m = map || await load();
    const r = m[txt];
    if (!r) { if (cur) hide(); return; }
    if (cur !== el) {
      cur = el;
      let note = el.getAttribute('data-ttnote') || '';
      if (!note && el.title) { note = el.title; el.setAttribute('data-ttnote', note); }
      if (el.title) el.removeAttribute('title');           // avoid a second native tooltip
      fill(r, txt, note);
    }
    place(e.clientX, e.clientY);
  }

  document.addEventListener('mouseover', e => { if (e.pointerType !== 'touch') show(e); });
  document.addEventListener('mousemove', e => { if (cur) place(e.clientX, e.clientY); });
  document.addEventListener('mouseout', e => { if (e.target === cur) hide(); });
  document.addEventListener('click', e => {
    if (cur && e.target !== cur) hide();
    else if (!cur) show(e);                                // tap on phones
  });
  window.addEventListener('scroll', hide, true);
})();
