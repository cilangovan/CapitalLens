// ── MARKET SIGNALS (Alerts tab): 100-day and 200-day average crosses and new 52-week highs, for your holdings and your watchlist ──
// Source: Yahoo daily closes (1 year) through your worker / relay, fetched when you open the Alerts tab. This is a screening aid on daily closes,
// not a real-time feed: nothing is pushed while the app is closed, and nothing here is a recommendation.
// A "cross" = the close moved from one side of the average to the other versus the session before. A "52-week high" = the close is above every close of the previous year.
// Three views, per stock, using that stock's own exchange clock (UK and US open and close at different times):
//   Live        today's session while it is running (price as of when the tab was opened)
//   Pre Market  what was already true at today's open = the last completed close before today's session
//   Post Market today's completed session, once that market has closed
(function (root) {
  'use strict';
  const SMAS = [100, 200], HI_WIN = 251, MIN_PRIOR = 200, MAX_SYMBOLS = 80, CACHE_MS = 10 * 60 * 1000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const num = v => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
  const r4 = x => Math.round(x * 10000) / 10000;

  function sma(c, n, i) { if (i + 1 < n || i >= c.length) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += c[j]; return s / n; }
  // events on bar i of the close series c (dates d). Needs the bar before it, and enough history for the average / the year: never guesses.
  function eventsAt(c, d, i) {
    const out = []; if (!(i >= 1) || i >= c.length) return out;
    for (const n of SMAS) {
      const a = sma(c, n, i), b = sma(c, n, i - 1); if (a == null || b == null) continue;
      if (c[i - 1] <= b && c[i] > a) out.push({ kind: 'sma' + n, dir: 'up', level: r4(a), price: c[i], date: d[i] });
      else if (c[i - 1] >= b && c[i] < a) out.push({ kind: 'sma' + n, dir: 'down', level: r4(a), price: c[i], date: d[i] });
    }
    const from = Math.max(0, i - HI_WIN);
    if (i - from >= MIN_PRIOR) { let mx = -Infinity; for (let j = from; j < i; j++) if (c[j] > mx) mx = c[j]; if (c[i] > mx) out.push({ kind: 'high52', dir: 'up', level: c[i], price: c[i], date: d[i] }); }
    return out;
  }

  // points: [[unixSeconds, close], …] ascending (as returned by the chart route); meta: { gmtoffset, session: { start, end }, currency }
  function analyse(points, meta, nowMs) {
    const now = (nowMs == null ? Date.now() : nowMs) / 1000, m = meta || {}, off = num(m.gmtoffset) || 0;
    const empty = { bars: 0, open: false, doneToday: false, asOf: null, price: null, ccy: typeof m.currency === 'string' ? m.currency : null, pre: [], live: [], post: [] };
    const pts = (Array.isArray(points) ? points : []).map(p => [num(p && p[0]), num(p && p[1])]).filter(p => p[0] !== null && p[1] !== null && p[1] > 0).sort((a, b) => a[0] - b[0]);
    if (!pts.length) return empty;
    const dateOf = t => new Date((t + off) * 1000).toISOString().slice(0, 10), today = dateOf(now), bars = [];
    for (const [t, c] of pts) { const d = dateOf(t); if (bars.length && bars[bars.length - 1].d === d) bars[bars.length - 1] = { t, c, d }; else bars.push({ t, c, d }); }   // one bar per exchange day
    const ses = m.session && num(m.session.start) !== null && num(m.session.end) !== null ? m.session : null, open = !!ses && now >= Number(ses.start) && now <= Number(ses.end), n = bars.length;
    const liveBar = open && bars[n - 1].d === today, comp = liveBar ? bars.slice(0, -1) : bars, cc = comp.map(b => b.c), cd = comp.map(b => b.d);
    const doneToday = comp.length > 0 && cd[cd.length - 1] === today;
    return { bars: n, open: liveBar, doneToday, asOf: bars[n - 1].t, price: bars[n - 1].c, ccy: empty.ccy,
      pre: doneToday ? eventsAt(cc, cd, comp.length - 2) : eventsAt(cc, cd, comp.length - 1),     // what was true at today's open
      post: doneToday ? eventsAt(cc, cd, comp.length - 1) : [],                                   // today's completed session
      live: liveBar ? eventsAt(bars.map(b => b.c), bars.map(b => b.d), n - 1) : [] };             // today's session in progress
  }

  // inputs: [{ symbol (Yahoo), name, src: 'holding' | 'watch' }]; o.chart(symbol) → { points, meta } (throws when unavailable); o.onProgress(done, total)
  const CACHE = new Map();
  async function scan(inputs, o) {
    o = o || {}; const now = o.now == null ? Date.now() : o.now, seen = new Map();
    for (const x of inputs || []) { if (!x || !x.symbol || !/^[A-Za-z0-9.^=\-]{1,24}$/.test(x.symbol)) continue; const k = x.symbol.toUpperCase(), prev = seen.get(k);
      if (prev) { if (x.src === 'holding') prev.src = 'holding'; } else seen.set(k, { symbol: x.symbol, name: x.name || x.symbol, src: x.src === 'holding' ? 'holding' : 'watch' }); }
    const list = [...seen.values()].slice(0, MAX_SYMBOLS), rows = [], failed = []; let next = 0, done = 0;
    const work = async () => {
      while (next < list.length) {
        const x = list[next++], k = x.symbol.toUpperCase(), hit = CACHE.get(k);
        try {
          let d = hit && now - hit.at < CACHE_MS && !o.fresh ? hit.d : null;
          if (!d) { d = await o.chart(x.symbol); CACHE.set(k, { at: now, d }); }
          const a = analyse(d && d.points, d && d.meta, now); if (a.bars < 2) throw new Error('no data'); rows.push({ symbol: x.symbol, name: x.name, src: x.src, a });
        } catch (e) { failed.push(x.symbol); }
        done++; if (o.onProgress) try { o.onProgress(done, list.length); } catch (e) { /* display only */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.concurrency || 5, list.length) }, work));
    return { rows, failed, total: list.length, at: now, clipped: (inputs || []).length > list.length && seen.size > MAX_SYMBOLS };
  }
  function clearCache() { CACHE.clear(); }

  // rows → { sma100: [...], sma200: [...], high52: [...] } for one view ('live' | 'pre' | 'post'): up before down, then by name
  function group(rows, view) {
    const g = { sma100: [], sma200: [], high52: [] };
    for (const r of rows || []) { if (!r || !r.a) continue;
      for (const e of r.a[view] || []) if (g[e.kind]) g[e.kind].push({ symbol: r.symbol, name: r.name, src: r.src, dir: e.dir, level: e.level, price: e.price, date: e.date, ccy: r.a.ccy }); }
    for (const k in g) g[k].sort((x, y) => (x.dir === y.dir ? 0 : x.dir === 'up' ? -1 : 1) || String(x.name).localeCompare(String(y.name)));
    return g;
  }
  const SYM = { GBP: '£', USD: '$', EUR: '€', INR: '₹', JPY: '¥', CNY: '¥', CHF: 'CHF ', CAD: 'C$', AUD: 'A$', TWD: 'NT$', PLN: 'zł ' };
  const money = (v, ccy) => { const n = num(v); if (n === null) return 'n/a'; const s = Math.abs(n) < 1 ? 4 : 2; return (SYM[ccy] != null ? SYM[ccy] : ccy ? ccy + ' ' : '') + n.toLocaleString('en-GB', { minimumFractionDigits: s, maximumFractionDigits: s }); };
  const SHOW = 3;

  // one view of the three cards. o.expanded: Set of group keys shown in full; o.empty: text for "nothing"
  function html(g, o) {
    o = o || {}; const open = o.expanded || new Set();
    const grp = (key, title, label) => { const rows = g[key]; if (!rows.length) return '';
      const row = (r, i) => `<div class="sg-row"${i >= SHOW && !open.has(key) ? ' hidden' : ''}><span class="sg-name"><span class="sg-arr ${r.dir}" aria-label="${r.dir === 'up' ? 'up' : 'down'}">${r.dir === 'up' ? '▲' : '▼'}</span> ${esc(r.name)}${r.src === 'holding' ? '<span class="sg-tag">Holding</span>' : '<span class="sg-tag">Watchlist</span>'}</span>
        <span class="sg-val">${esc(label)} <b>${esc(money(r.level, r.ccy))}</b></span></div>`;
      return `<div class="sg-grp"><div class="sg-ghead"><span>${esc(title)}</span><small>${rows.length} stock${rows.length === 1 ? '' : 's'}</small></div>
        <div class="sg-list">${rows.map(row).join('')}${rows.length > SHOW && !open.has(key) ? `<button type="button" class="sg-more" data-al-more="${key}">View more (${rows.length - SHOW})</button>` : ''}</div></div>`; };
    const sm = grp('sma100', '100 SMA triggered', 'Crossed') + grp('sma200', '200 SMA triggered', 'Crossed'), hi = grp('high52', '52 Week High', 'New high of');
    const card = (title, sub, body) => body ? `<div class="sg-card"><div class="sg-banner">${esc(title)} <span>· ${esc(sub)}</span></div>${body}</div>` : '';
    const out = card('Major Movement', 'SMA Crossover', sm) + card('Major Movement', '52 Week Breakout', hi);
    return out || `<div class="sg-empty">${esc(o.empty || 'Nothing to show.')}</div>`;
  }

  root.Signals = { SMAS, SHOW, analyse, eventsAt, scan, clearCache, group, html, money };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Signals;
})(typeof window !== 'undefined' ? window : globalThis);
