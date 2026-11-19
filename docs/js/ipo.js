// ── IPO WATCH ─────────────────────────────────────────────────
// Works like the stock watchlist: NOTHING is listed until you bookmark it. Search the public IPO calendar (table ipo_calendar,
// shared, no customer data) by company, ticker, exchange or country, bookmark (☆) what you want, and it appears under "My IPO list"
// (stored encrypted per user in the private app); ✕ removes it. Each card: where it lists, status, rating (with its source), opens / closes / listing day.
// Clicks use one delegated listener (no inline handlers), so it works under the strict CSP of the private app too.
(function (root) {
  'use strict';
  const MARKETS = [['ALL', '🌐', 'All countries'], ['US', '🇺🇸', 'US'], ['UK', '🇬🇧', 'UK'], ['IN', '🇮🇳', 'India'], ['HK', '🇭🇰', 'HK'], ['OTHER', '🌍', 'Other']];
  const FLAG = { US: '🇺🇸', UK: '🇬🇧', IN: '🇮🇳', HK: '🇭🇰', EU: '🇪🇺', JP: '🇯🇵', CN: '🇨🇳', SG: '🇸🇬', AU: '🇦🇺', OTHER: '🌍' };
  const CCY = { USD: '$', GBP: '£', EUR: '€', INR: '₹', HKD: 'HK$', JPY: '¥', CNY: '¥', SGD: 'S$', AUD: 'A$' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PHASE = { open: ['Open', 'g', 0], closed: ['Closed · awaiting listing', 'y', 1], upcoming: ['Upcoming', 'b', 2], priced: ['Priced', 'b', 3], filed: ['Filed', '', 4],
                  rumoured: ['Rumoured', '', 5], listed: ['Listed', 'dim', 6], postponed: ['Postponed', 'r', 7], withdrawn: ['Withdrawn', 'r', 7] };
  const RATING = { Subscribe: 'g', Neutral: 'y', Avoid: 'r', 'Not rated': 'dim' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const ID_RE = /^[A-Z]{2,5}:[A-Z0-9_.\-]{1,40}$/;
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d);

  const fmtDate = (d, today) => { if (!isDate(d)) return 'TBC'; const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1, day = +d.slice(8, 10);
    return `${day} ${MON[m]}${y !== +String(today).slice(0, 4) ? ' ' + y : ''}`; };
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const fmtNum = n => n >= 100 ? n.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(+n.toFixed(2));
  function fmtPrice(lo, hi, ccy) {
    lo = num(lo); hi = num(hi); if (lo === null && hi === null) return 'Price TBC';
    const s = CCY[ccy] !== undefined ? CCY[ccy] : (ccy ? ccy + ' ' : '');
    if (lo === null || hi === null || lo === hi) return `${s}${fmtNum(lo === null ? hi : lo)}${lo === hi ? ' fixed' : ''}`;
    return `${s}${fmtNum(lo)}–${fmtNum(hi)}`;
  }
  function fmtSize(usd) { usd = num(usd); if (usd === null) return null; return usd >= 1e9 ? `$${+(usd / 1e9).toFixed(1)}bn` : `$${Math.round(usd / 1e6)}m`; }

  // effective phase: stored status, refined by the dates
  function phaseOf(r, today) {
    const s = r.status || 'upcoming';
    if (!['upcoming', 'filed', 'open'].includes(s)) return s;
    const a = isDate(r.start_date) ? r.start_date.slice(0, 10) : null, b = isDate(r.end_date) ? r.end_date.slice(0, 10) : null;
    if (a && b && a <= today && today <= b) return 'open';
    if (b && b < today) return 'closed';
    return s === 'open' ? 'upcoming' : s;
  }
  const marketOf = r => (['US', 'UK', 'IN', 'HK'].includes(r.market) ? r.market : 'OTHER');

  const COUNTRY = { US: 'United States USA', UK: 'United Kingdom Britain England', IN: 'India', HK: 'Hong Kong', EU: 'Europe European Union', JP: 'Japan', CN: 'China', SG: 'Singapore', AU: 'Australia', OTHER: 'Other' };
  const phased = (rows, today) => (rows || []).map(r => Object.assign({}, r, { _phase: phaseOf(r, today) }));
  function sortRows(list) {
    const key = r => (isDate(r.start_date) ? r.start_date : isDate(r.listing_date) ? r.listing_date : '9999');
    return list.sort((x, y) => (PHASE[x._phase] || PHASE.rumoured)[2] - (PHASE[y._phase] || PHASE.rumoured)[2]
      || (x._phase === 'listed' ? (key(y) > key(x) ? 1 : -1) : (key(x) > key(y) ? 1 : key(x) < key(y) ? -1 : 0)));
  }
  const norm = f => ({ q: String((f && f.q) || '').slice(0, 60), country: (f && f.country) || 'ALL', exchange: (f && f.exchange) || 'ALL' });
  const isActive = f => { f = norm(f); return !!f.q.trim() || f.country !== 'ALL' || f.exchange !== 'ALL'; };
  const exchanges = rows => [...new Set((rows || []).map(r => (r.exchange || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // Search the calendar. Nothing is returned (and nothing is shown) until a query or a filter is set.
  function search(rows, f, today) {
    f = norm(f); if (!isActive(f)) return [];
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = phased(rows, today).filter(r => {
      if (f.country !== 'ALL' && marketOf(r) !== f.country) return false;
      if (f.exchange !== 'ALL' && (r.exchange || '') !== f.exchange) return false;
      const hay = [r.name, r.ticker, r.sector, r.exchange, r.market, COUNTRY[r.market] || ''].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
    return sortRows(list);
  }
  const mine = (rows, watched, today) => sortRows(phased(rows, today).filter(r => !!(watched && watched.has(r.id))));

  // inList = the card sits in "My IPO list" (shows the ✕). Search results show a Bookmark button instead.
  function card(r, today, watched, inList) {
    const [label, tone] = PHASE[r._phase] || PHASE.rumoured, rate = RATING[r.rating] !== undefined ? r.rating : 'Not rated';
    const size = fmtSize(r.deal_size_usd), url = /^https?:\/\//.test(r.source_url || '') ? r.source_url : null;
    const on = !!(watched && watched.has(r.id)), okId = ID_RE.test(r.id || '');
    const btn = !inList && watched && okId ? `<button class="ipo-watch${on ? ' on' : ''}" data-ipo-watch="${esc(r.id)}" aria-pressed="${on}">${on ? '★ In my list · tap to remove' : '☆ Bookmark'}</button>` : '';
    const x = inList && watched && okId ? `<button class="w-x ipo-x" data-ipo-watch="${esc(r.id)}" title="Remove from my list" aria-label="Remove ${esc(r.name)} from my list">✕</button>` : '';
    const ticker = r.ticker ? ` <span class="w-dim">${esc(r.ticker)}</span>` : '';
    return `<div class="ipo-card ipo-${esc(tone || 'n')}">
      <div class="ipo-top"><div class="ipo-name"><b>${esc(r.name)}</b>${ticker}</div>
        <span class="ipo-pill ${esc(tone)}">${esc(label)}</span>${x}</div>
      <div class="ipo-chips"><span class="w-chip">${FLAG[r.market] || '🌍'} ${esc(r.exchange || 'Exchange TBC')}</span>${r.sector ? `<span class="w-chip">${esc(r.sector)}</span>` : ''}
        <span class="ipo-pill ${RATING[rate]}" title="${esc(r.rating_source ? 'Rating source: ' + r.rating_source : 'No rating source yet')}">★ ${esc(rate)}</span></div>
      <div class="ipo-dates">
        <div><span class="w-dim">Opens</span><b>${esc(fmtDate(r.start_date, today))}</b></div>
        <div><span class="w-dim">Closes</span><b>${esc(fmtDate(r.end_date, today))}</b></div>
        <div><span class="w-dim">Lists</span><b>${esc(fmtDate(r.listing_date, today))}</b></div></div>
      <div class="ipo-meta">${esc(fmtPrice(r.price_low, r.price_high, r.currency))}${size ? ` · ${esc(size)}` : ''}</div>
      ${r.note ? `<div class="ipo-note w-dim">${esc(r.note)}</div>` : ''}
      ${btn}
      <div class="ipo-src w-dim">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_name || 'Source')}</a>` : esc(r.source_name || '')}${r.as_of ? ` · as of ${esc(fmtDate(r.as_of, today))}` : ''}</div>
    </div>`;
  }

  function controls(rows, f) {
    f = norm(f);
    const chips = MARKETS.map(([k, ic, lb]) => `<button class="w-cat${f.country === k ? ' active' : ''}" data-ipo-co="${k}">${ic} ${lb}</button>`).join('');
    const ex = exchanges(rows).map(e => `<option value="${esc(e)}"${f.exchange === e ? ' selected' : ''}>${esc(e)}</option>`).join('');
    return `<div class="w-search"><input type="search" data-ipo-q placeholder="🔍 Search IPOs — company, ticker, exchange or country" value="${esc(f.q)}" autocomplete="off" maxlength="60" aria-label="Search IPOs"></div>
      <div class="ipo-filters"><div class="w-cats">${chips}</div>
        <label class="ipo-ex"><span class="w-dim">Exchange</span><select data-ipo-ex aria-label="Filter by exchange"><option value="ALL">All exchanges</option>${ex}</select></label></div>`;
  }
  function body(rows, f, today, watched) {
    watched = watched || null;
    let out = '';
    if (watched) {
      const m = mine(rows, watched, today);
      out += `<div class="ipo-sec">⭐ My IPO list <span class="a-count">${m.length}</span></div>`
        + (m.length ? m.map(r => card(r, today, watched, true)).join('') : '<div class="w-dim" style="padding:6px 4px 14px">Nothing here yet. Search above, then tap ☆ Bookmark on an IPO to add it.</div>');
    }
    if (isActive(f)) {
      const res = search(rows, f, today);
      out += `<div class="ipo-sec">🔍 Search results <span class="a-count">${res.length}</span></div>`
        + (res.length ? res.map(r => card(r, today, watched, false)).join('') : '<div class="w-dim" style="padding:6px 4px">No IPO matches. Try another name, exchange or country.</div>');
    } else if (!watched) {
      out += '<div class="w-dim" style="padding:6px 4px">Search the IPO calendar by company, ticker, exchange or country. Bookmarking is available in the private app.</div>';
    }
    return out;
  }
  function html(rows, f, today, watched) {
    return `${controls(rows, f)}<div id="ipo-body">${body(rows, f, today, watched)}</div>
      <div class="w-dim w-small">Opens/closes = subscription window (US: roadshow launch / expected pricing). Ratings are third-party and show their source; “Not rated” means no source rates it. Information only, not advice.</div>`;
  }

  const S = { f: { q: '', country: 'ALL', exchange: 'ALL' }, rows: [], loaded: false, error: null, watched: null, msg: '', busy: new Set() };
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const msgHtml = () => (S.msg ? `<div style="color:var(--red);padding:6px 2px;font-size:12px">${esc(S.msg)}</div>` : '');
  function paint() {          // everything (controls too): after loading and when a country chip is tapped
    const el = typeof document !== 'undefined' && document.getElementById('ipo-content');
    if (!el) return;
    el.innerHTML = S.error ? `<div style="color:var(--red);padding:8px">Could not load the IPO calendar: ${esc(S.error)}</div>` : msgHtml() + html(S.rows, S.f, todayIso(), S.watched);
  }
  function paintBody() {      // only the results, so the search box keeps focus while typing
    const b = typeof document !== 'undefined' && document.getElementById('ipo-body');
    if (!b) return paint();
    b.innerHTML = msgHtml() + body(S.rows, S.f, todayIso(), S.watched);
  }
  async function loadIpo() {
    const el = document.getElementById('ipo-content');
    if (!el) return;
    try {
      const r = await fetch(`${PROXY}/ipo_calendar?select=*&limit=500`);
      if (!r.ok) throw new Error(`${r.status}`);
      S.rows = await r.json(); S.error = null;
    } catch (e) { S.error = e.message; }
    try {                                   // per-user list (encrypted in the private app); where it is not offered, search works but there is nothing to bookmark into
      const w = await fetch(`${PROXY}/ipo_watch?select=id`);
      S.watched = w.ok ? new Set((await w.json()).map(x => x.id)) : null;
    } catch (e) { S.watched = null; }
    S.loaded = true; paint();
  }
  // Bookmark / remove one IPO. The change shows at once and is undone with a message if saving fails.
  async function toggleWatch(id) {
    if (!S.watched || !ID_RE.test(id) || S.busy.has(id)) return;
    const was = S.watched.has(id);
    S.busy.add(id); S.msg = ''; was ? S.watched.delete(id) : S.watched.add(id); paintBody();
    try {
      const r = await fetch(`${PROXY}/ipo/${was ? 'unwatch' : 'watch'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!r.ok) throw new Error(`${r.status}`);
    } catch (e) { was ? S.watched.add(id) : S.watched.delete(id); S.msg = `Could not ${was ? 'remove' : 'save'} that IPO (${e.message}). Try again.`; }
    S.busy.delete(id); paintBody();
  }
  if (typeof document !== 'undefined') {
    const tgt = e => (e.target && e.target.closest ? e.target : null);
    document.addEventListener('click', e => {
      const t = tgt(e); if (!t) return;
      const w = t.closest('[data-ipo-watch]'); if (w) { toggleWatch(w.getAttribute('data-ipo-watch')); return; }
      const b = t.closest('[data-ipo-co]');
      if (b && MARKETS.some(m => m[0] === b.getAttribute('data-ipo-co'))) { S.f.country = b.getAttribute('data-ipo-co'); S.msg = ''; paint(); }
    });
    document.addEventListener('input', e => { const t = tgt(e); if (t && t.matches('[data-ipo-q]')) { S.f.q = String(t.value || '').slice(0, 60); paintBody(); } });
    document.addEventListener('change', e => { const t = tgt(e); if (t && t.matches('[data-ipo-ex]')) { S.f.exchange = String(t.value || 'ALL'); paintBody(); } });
    root.loadIpo = loadIpo;
  }
  root.IPO = { html, search, mine, exchanges, isActive, phaseOf, fmtDate, fmtPrice, fmtSize, toggleWatch, _state: S };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.IPO;
})(typeof window !== 'undefined' ? window : globalThis);
