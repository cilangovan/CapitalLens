// ── IPO WATCH ─────────────────────────────────────────────────
// Public IPO calendar across markets (table ipo_calendar, shared, no customer data). Sits under the Watchlist tab as a
// collapsible card. Each row: where it lists, status, rating (with its source), subscription opens / closes, listing day.
// Clicks use one delegated listener (no inline handlers), so it works under the strict CSP of the private app too.
(function (root) {
  'use strict';
  const MARKETS = [['ALL', '🌐', 'All'], ['US', '🇺🇸', 'US'], ['UK', '🇬🇧', 'UK'], ['IN', '🇮🇳', 'India'], ['HK', '🇭🇰', 'HK'], ['OTHER', '🌍', 'Other']];
  const FLAG = { US: '🇺🇸', UK: '🇬🇧', IN: '🇮🇳', HK: '🇭🇰', EU: '🇪🇺', JP: '🇯🇵', CN: '🇨🇳', SG: '🇸🇬', AU: '🇦🇺', OTHER: '🌍' };
  const CCY = { USD: '$', GBP: '£', EUR: '€', INR: '₹', HKD: 'HK$', JPY: '¥', CNY: '¥', SGD: 'S$', AUD: 'A$' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PHASE = { open: ['Open', 'g', 0], closed: ['Closed · awaiting listing', 'y', 1], upcoming: ['Upcoming', 'b', 2], priced: ['Priced', 'b', 3], filed: ['Filed', '', 4],
                  rumoured: ['Rumoured', '', 5], listed: ['Listed', 'dim', 6], postponed: ['Postponed', 'r', 7], withdrawn: ['Withdrawn', 'r', 7] };
  const RATING = { Subscribe: 'g', Neutral: 'y', Avoid: 'r', 'Not rated': 'dim' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
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

  function select(rows, market, today) {
    const list = (rows || []).filter(r => market === 'ALL' || marketOf(r) === market).map(r => Object.assign({}, r, { _phase: phaseOf(r, today) }));
    const key = r => (isDate(r.start_date) ? r.start_date : isDate(r.listing_date) ? r.listing_date : '9999');
    return list.sort((x, y) => (PHASE[x._phase] || PHASE.rumoured)[2] - (PHASE[y._phase] || PHASE.rumoured)[2]
      || (x._phase === 'listed' ? (key(y) > key(x) ? 1 : -1) : (key(x) > key(y) ? 1 : key(x) < key(y) ? -1 : 0)));
  }

  function card(r, today) {
    const [label, tone] = PHASE[r._phase] || PHASE.rumoured, rate = RATING[r.rating] !== undefined ? r.rating : 'Not rated';
    const size = fmtSize(r.deal_size_usd), url = /^https?:\/\//.test(r.source_url || '') ? r.source_url : null;
    const ticker = r.ticker ? ` <span class="w-dim">${esc(r.ticker)}</span>` : '';
    return `<div class="ipo-card ipo-${esc(tone || 'n')}">
      <div class="ipo-top"><div class="ipo-name"><b>${esc(r.name)}</b>${ticker}</div>
        <span class="ipo-pill ${esc(tone)}">${esc(label)}</span></div>
      <div class="ipo-chips"><span class="w-chip">${FLAG[r.market] || '🌍'} ${esc(r.exchange || 'Exchange TBC')}</span>${r.sector ? `<span class="w-chip">${esc(r.sector)}</span>` : ''}
        <span class="ipo-pill ${RATING[rate]}" title="${esc(r.rating_source ? 'Rating source: ' + r.rating_source : 'No rating source yet')}">★ ${esc(rate)}</span></div>
      <div class="ipo-dates">
        <div><span class="w-dim">Opens</span><b>${esc(fmtDate(r.start_date, today))}</b></div>
        <div><span class="w-dim">Closes</span><b>${esc(fmtDate(r.end_date, today))}</b></div>
        <div><span class="w-dim">Lists</span><b>${esc(fmtDate(r.listing_date, today))}</b></div></div>
      <div class="ipo-meta">${esc(fmtPrice(r.price_low, r.price_high, r.currency))}${size ? ` · ${esc(size)}` : ''}</div>
      ${r.note ? `<div class="ipo-note w-dim">${esc(r.note)}</div>` : ''}
      <div class="ipo-src w-dim">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.source_name || 'Source')}</a>` : esc(r.source_name || '')}${r.as_of ? ` · as of ${esc(fmtDate(r.as_of, today))}` : ''}</div>
    </div>`;
  }

  function html(rows, market, today) {
    const count = m => select(rows, m, today).length;
    const tabs = MARKETS.map(([k, ic, lb]) => `<button class="w-cat${market === k ? ' active' : ''}" data-ipo-mkt="${k}">${ic} ${lb} <span class="a-count">${count(k)}</span></button>`).join('');
    const list = select(rows, market, today);
    const body = list.length ? list.map(r => card(r, today)).join('')
      : `<div class="w-dim" style="padding:12px 4px">No IPOs tracked for this market yet.</div>`;
    return `<div class="w-cats">${tabs}</div>${body}
      <div class="w-dim w-small">Opens/closes = subscription window (US: roadshow launch / expected pricing). Ratings are third-party and show their source; “Not rated” means no source rates it. Information only, not advice.</div>`;
  }

  const S = { market: 'ALL', rows: [], loaded: false, error: null };
  const todayIso = () => new Date().toISOString().slice(0, 10);
  function paint() {
    const el = typeof document !== 'undefined' && document.getElementById('ipo-content');
    if (!el) return;
    el.innerHTML = S.error ? `<div style="color:var(--red);padding:8px">Could not load IPOs: ${esc(S.error)}</div>` : html(S.rows, S.market, todayIso());
  }
  async function loadIpo() {
    const el = document.getElementById('ipo-content');
    if (!el) return;
    try {
      const r = await fetch(`${PROXY}/ipo_calendar?select=*&limit=500`);
      if (!r.ok) throw new Error(`${r.status}`);
      S.rows = await r.json(); S.error = null;
    } catch (e) { S.error = e.message; }
    S.loaded = true; paint();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-ipo-mkt]');
      if (b && MARKETS.some(m => m[0] === b.getAttribute('data-ipo-mkt'))) { S.market = b.getAttribute('data-ipo-mkt'); paint(); }
    });
    root.loadIpo = loadIpo;
  }
  root.IPO = { html, select, phaseOf, fmtDate, fmtPrice, fmtSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.IPO;
})(typeof window !== 'undefined' ? window : globalThis);
