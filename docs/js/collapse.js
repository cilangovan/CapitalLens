// Collapsible dashboard sections: click (or tap) any card heading to fold/unfold that card.
// State is remembered per browser (heading text + tab), no account data involved.
(function () {
  'use strict';
  const KEY = 'cl_collapsed';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };

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
  let t = null;
  new MutationObserver(() => { if (!t) t = requestAnimationFrame(() => { t = null; setup(); subSetup(); }); })
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
  setup(); subSetup();
})();
