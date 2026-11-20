// ── WATCHLIST ─────────────────────────────────────────────────
// Three sections: 📈 Stocks (Yahoo, any exchange) · 🛢 Commodities (T212 ETCs + market futures)
// · ₿ Crypto (Yahoo coins + T212 crypto ETPs). ☆ bookmark → this week's call:
// ENTER / ACCUMULATE / HOLD / AVOID, price points with £ per step, RSI, volume, quality.
// ✕ removes it and stops all tracking. Writes go through the worker (/watchlist/*).

const WL = { cat: 'stock', arrange: false, items: [], analysis: {}, open: new Set(), pending: new Set(), searchTimer: null, poll: null,
             expanded: new Set((() => { try { return JSON.parse(localStorage.getItem('wl_expanded') || '[]'); } catch (e) { return []; } })()) };
function wlSaveExpanded() { try { localStorage.setItem('wl_expanded', JSON.stringify([...WL.expanded])); } catch (e) {} }

// ── CARD ORDER (⇅ Arrange) ──
// You choose the order of the cards inside each section. It is saved per user: encrypted with the rest of your watchlist in the private app,
// in the database on the legacy page (POST /watchlist/order). Cards you never arranged stay in the automatic order (this week's call) after the ones you did.
// The demo has no writable store (501), so there the order is kept in this browser only.
const WL_LOCAL_ORDER = 'wl_order_local';
const WL_VERDICT_RANK = { ENTER: 0, ACCUMULATE: 1, HOLD: 2, AVOID: 3 };
function wlLocalOrder() { try { return JSON.parse(localStorage.getItem(WL_LOCAL_ORDER) || '{}') || {}; } catch (e) { return {}; } }
// items: the cards of one section; analysis: {ticker: {verdict}}. Arranged cards first (by sort_order), then the rest by this week's call.
function wlSorted(items, analysis) {
  const has = i => Number.isFinite(i.sort_order), rank = i => WL_VERDICT_RANK[(analysis[i.ticker] || {}).verdict] ?? 4;
  return [...items].sort((a, b) => has(a) && has(b) ? a.sort_order - b.sort_order || a.ticker.localeCompare(b.ticker) : has(a) ? -1 : has(b) ? 1 : rank(a) - rank(b));
}
// Move one card up (-1) or down (+1): returns the new ticker order, or null when it is already at that end.
function wlMoved(order, ticker, dir) {
  const k = order.indexOf(ticker), n = k + dir; if (k < 0 || n < 0 || n >= order.length) return null;
  const o = [...order]; [o[k], o[n]] = [o[n], o[k]]; return o;
}
function wlApplyLocalOrder() { const lo = wlLocalOrder(); WL.items.forEach(i => { if (!Number.isFinite(i.sort_order) && Number.isFinite(lo[i.ticker])) i.sort_order = lo[i.ticker]; }); }
async function wlSaveOrder(cat, order) {
  try {
    const r = await fetch(`${PROXY}/watchlist/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: SESSION_TOKEN, category: cat, order }) });
    if (r.status === 501) {                                    // demo: no writable store, keep it in this browser
      const lo = wlLocalOrder(); WL.items.filter(i => wCat(i) === cat).forEach(i => { delete lo[i.ticker]; }); order.forEach((t, k) => { lo[t] = k; });
      try { localStorage.setItem(WL_LOCAL_ORDER, JSON.stringify(lo)); } catch (e) {} return;
    }
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  } catch (e) { wlNote(`Couldn't save the order: ${e.message}${/session/i.test(e.message) ? ' — sign in again' : ''}`, true); }
}
function wlMove(ev, ticker, dir) {
  ev.stopPropagation();
  const mine = WL.items.filter(i => wCat(i) === WL.cat), order = wlSorted(mine, WL.analysis).map(i => i.ticker), next = wlMoved(order, ticker, dir); if (!next) return;
  next.forEach((t, k) => { mine.find(i => i.ticker === t).sort_order = k; });
  renderWatchlist();
  const b = document.querySelector(`.w-card[data-t="${CSS.escape(ticker)}"] .w-mv [data-dir="${dir}"]`); if (b) { b.focus(); b.scrollIntoView({ block: 'nearest' }); }
  clearTimeout(WL.orderTimer); const cat = WL.cat; WL.orderTimer = setTimeout(() => wlSaveOrder(cat, next), 400);   // several taps in a row save once
}
// ── DRAG TO REORDER (⠿ handle on every card) ──
// Press the ⠿ handle, drag the card up or down, let go. Mouse and touch both work (the handle has touch-action:none, so the page does not scroll under your finger).
// While dragging every card folds to its headline so a long list is easy to cross, and the list scrolls itself near the screen edge. The new order is saved like ▲ ▼.
const WLD = { el: null, grab: 0, y: 0, raf: 0, pid: null, start: '' };
const wlDomOrder = () => [...document.querySelectorAll('#w-list .w-card[data-t]')].map(c => c.dataset.t);
function wlDragStep() {
  const el = WLD.el; if (!el) return; const list = el.parentElement, y = WLD.y;
  const others = [...list.querySelectorAll('.w-card[data-t]')].filter(c => c !== el); let before = null;
  for (const c of others) { const r = c.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = c; break; } }
  if (before !== el.nextElementSibling) list.insertBefore(el, before);
  el.style.transform = ''; const top = el.getBoundingClientRect().top; el.style.transform = `translateY(${(y - WLD.grab - top).toFixed(1)}px)`;
}
function wlDragLoop() {
  if (!WLD.el) return; const h = window.innerHeight || 800;
  if (WLD.y < 70) window.scrollBy(0, -12); else if (WLD.y > h - 70) window.scrollBy(0, 12);
  wlDragStep(); WLD.raf = requestAnimationFrame(wlDragLoop);
}
function wlDragEnd(commit) {
  const el = WLD.el; if (!el) return; cancelAnimationFrame(WLD.raf); WLD.el = null;
  try { el.querySelector('.w-grip').releasePointerCapture(WLD.pid); } catch (e) {}
  el.style.transform = ''; el.classList.remove('dragging'); document.getElementById('w-list').classList.remove('sorting');
  const order = wlDomOrder();
  if (commit && order.join('|') !== WLD.start) {
    const mine = WL.items.filter(i => wCat(i) === WL.cat); order.forEach((t, k) => { const it = mine.find(i => i.ticker === t); if (it) it.sort_order = k; });
    clearTimeout(WL.orderTimer); const cat = WL.cat; WL.orderTimer = setTimeout(() => wlSaveOrder(cat, order), 400);
  }
  renderWatchlist();
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => {
    const g = e.target && e.target.closest && e.target.closest('.w-grip'); if (!g || WL.arrange || (e.button !== undefined && e.button > 0)) return;
    const el = g.closest('.w-card[data-t]'); if (!el) return; e.preventDefault();
    WLD.el = el; WLD.pid = e.pointerId; WLD.start = wlDomOrder().join('|'); try { g.setPointerCapture(e.pointerId); } catch (x) {}
    document.getElementById('w-list').classList.add('sorting'); el.classList.add('dragging');
    const r = el.getBoundingClientRect(); WLD.y = e.clientY; WLD.grab = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    WLD.raf = requestAnimationFrame(wlDragLoop);
  });
  document.addEventListener('pointermove', e => { if (WLD.el && e.pointerId === WLD.pid) { WLD.y = e.clientY; e.preventDefault(); } });
  document.addEventListener('pointerup', e => { if (WLD.el && e.pointerId === WLD.pid) wlDragEnd(true); });
  document.addEventListener('pointercancel', e => { if (WLD.el && e.pointerId === WLD.pid) wlDragEnd(false); });
}
function wlArrange(on) { WL.arrange = !!on; renderWatchlist(); }
function wlResetOrder() {
  WL.items.filter(i => wCat(i) === WL.cat).forEach(i => { delete i.sort_order; });
  const lo = wlLocalOrder(); WL.items.filter(i => wCat(i) === WL.cat).forEach(i => { delete lo[i.ticker]; }); try { localStorage.setItem(WL_LOCAL_ORDER, JSON.stringify(lo)); } catch (e) {}
  clearTimeout(WL.orderTimer); renderWatchlist(); wlSaveOrder(WL.cat, []);
  wlNote('Back to the automatic order (this week\'s call first).');
}
const WCATS = {
  stock:     { icon: '📈', label: 'Stocks',      key: 'watchlist_weekly_budget',
               ph: '🔍 Search any stock or ETF worldwide — name or symbol (e.g. Toyota, Rolls-Royce, 0700.HK)', picks: [] },
  commodity: { icon: '🛢', label: 'Commodities', key: 'commodity_weekly_budget',
               ph: '🔍 Search commodities — gold, silver, oil, gas, copper…',
               picks: ['Gold', 'Silver', 'Brent', 'WTI', 'Natural gas', 'Copper', 'Platinum', 'Wheat'] },
  crypto:    { icon: '₿',  label: 'Crypto',      key: 'crypto_weekly_budget',
               ph: '🔍 Search crypto — Bitcoin, Ethereum, Solana…',
               picks: ['Bitcoin', 'Ethereum', 'Solana', 'XRP', 'Cardano'] },
};
const wCat = i => i.category || 'stock';
const _wesc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const CCY = { GBP:'£', USD:'$', EUR:'€', GBX:'', GBp:'' };
const wMoney = (v, ccy) => v == null ? '—' : `${CCY[ccy] ?? ''}${Number(v).toLocaleString('en-GB', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 3 : 4 })}${CCY[ccy] === undefined ? ' ' + ccy : ''}`;
const wGbp = (v, a) => (a.ccy !== 'GBP' && a.per_gbp && v != null) ? ` <span class="w-dim">≈ £${(v / a.per_gbp).toFixed(2)}</span>` : '';
const wPct = v => v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const wSym = t => t || '';

async function loadWatchlist() {
  const el = document.getElementById('watchlist-content');
  if (IS_GUEST) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to use the watchlist</div>'; return; }
  el.innerHTML = `
    <div class="w-cats" id="w-cats"></div>
    <div class="w-search card">
      <input id="w-q" type="search" autocomplete="off" oninput="wlSearch(this.value)">
      <div id="w-picks" class="w-picks"></div>
      <div id="w-results"></div>
    </div>
    <div id="w-summary"></div>
    <div id="w-list"><div class="loading busy">Loading…</div></div>`;
  wlSetCat(WL.cat, true);
  await wlRefresh();
}

function wlSetCat(cat, silent) {
  WL.cat = cat;
  const c = WCATS[cat];
  const q = document.getElementById('w-q');
  q.placeholder = c.ph; q.value = '';
  document.getElementById('w-results').innerHTML = '';
  document.getElementById('w-picks').innerHTML = c.picks.map(p =>
    `<button class="w-pick" onclick="wlPick('${p}')">${p}</button>`).join('');
  if (!silent) renderWatchlist(); else wlRenderCats();
}

function wlRenderCats() {
  const n = c => WL.items.filter(i => wCat(i) === c).length;
  document.getElementById('w-cats').innerHTML = Object.entries(WCATS).map(([k, c]) =>
    `<button class="w-cat${WL.cat === k ? ' active' : ''}" onclick="wlSetCat('${k}')">${c.icon} ${c.label} <span class="a-count">${n(k)}</span></button>`).join('');
}

async function wlFetch(path) {
  const r = await fetch(`${PROXY}/${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function wlRefresh() {
  const [items, an] = await Promise.all([
    wlFetch('watchlist?select=*&order=added_at.desc'),
    wlFetch('watchlist_analysis?select=*'),
  ]);
  WL.items = items; wlApplyLocalOrder();
  WL.analysis = Object.fromEntries(an.map(a => [a.ticker, a]));
  // a freshly added stock is pending until an analysis newer than its add time lands
  WL.items.forEach(i => {
    const a = WL.analysis[i.ticker];
    if (a && new Date(a.updated_at) >= new Date(i.added_at)) WL.pending.delete(i.ticker);
  });
  renderWatchlist();
  wlSchedulePoll();
}

function wlSchedulePoll() {
  clearTimeout(WL.poll);
  if (WL.pending.size) WL.poll = setTimeout(() => wlRefresh().catch(() => {}), 15000);
}

// ── search ────────────────────────────────────────────────────
function wlPick(p) { document.getElementById('w-q').value = p; wlSearch(p); }
function wlSearch(q) {
  clearTimeout(WL.searchTimer);
  const box = document.getElementById('w-results');
  q = q.trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  WL.searchTimer = setTimeout(async () => {
    box.innerHTML = '<div class="w-dim" style="padding:8px">Searching markets…</div>';
    try {
      const cat = WL.cat;
      const r = await fetch(`${PROXY}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: SESSION_TOKEN, q, category: cat }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (document.getElementById('w-q').value.trim() !== q || WL.cat !== cat) return;   // stale
      const held = new Set(WL.items.map(i => i.ticker));
      const rows = d.results || [];
      const row = x => `
        <div class="w-res">
          <div><b>${_wesc(x.name)}</b> <span class="w-dim">${_wesc(x.symbol)}</span><br>
            <span class="w-chip">${_wesc(x.exchange)}</span><span class="w-chip">${_wesc(x.type)}</span>
            ${x.currency ? `<span class="w-chip">${_wesc(x.currency)}</span>` : ''}
            ${x.t212_ticker ? '<span class="w-chip t212">✓ On Trading 212</span>' : (cat === 'stock' ? '<span class="w-chip">T212: check app</span>' : '')}
            ${x.leveraged ? '<span class="w-chip warn">⚠ Leveraged/short — high risk</span>' : ''}
            ${x.miners ? '<span class="w-chip">Company shares, not the asset</span>' : ''}</div>
          ${held.has(x.symbol)
            ? `<button class="w-star on" disabled>★ Watching</button>`
            : `<button class="w-star" onclick="wlAdd('${_wesc(x.symbol)}', this)">☆ Watch</button>`}
        </div>`;
      const t212 = rows.filter(x => x.group === 't212'), mkt = rows.filter(x => x.group !== 't212');
      const head = t => `<div class="w-group">${t}</div>`;
      let html = d.note ? `<div class="w-dim" style="padding:6px 4px;color:var(--yellow)">${_wesc(d.note)}</div>` : '';
      if (cat === 'stock') html += rows.slice(0, 15).map(row).join('');
      else {
        if (t212.length) html += head(cat === 'crypto' ? '✓ Buy on Trading 212 — crypto ETPs' : '✓ Buy on Trading 212 — ETCs') + t212.slice(0, 10).map(row).join('');
        if (mkt.length)  html += head(cat === 'crypto' ? '₿ Coin prices (Yahoo Finance)' : '📊 Market price — futures (Yahoo Finance, for reference)') + mkt.slice(0, 8).map(row).join('');
      }
      box.innerHTML = rows.length ? html : html + '<div class="w-dim" style="padding:8px">Nothing found.</div>';
    } catch (e) {
      box.innerHTML = `<div style="color:var(--red);padding:8px">Search failed: ${_wesc(e.message)}${/session/i.test(e.message) ? ' — sign in again' : ''}</div>`;
    }
  }, 350);
}

async function wlPost(route, ticker) {
  const r = await fetch(`${PROXY}/watchlist/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: SESSION_TOKEN, symbol: ticker, category: WL.cat }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

async function wlAdd(ticker, btn) {
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const d = await wlPost('add', ticker);
    btn.textContent = '★ Watching'; btn.classList.add('on');
    WL.pending.add(ticker);
    await wlRefresh();
    if (!d.analysis_queued) wlNote('Added. Analysis will appear after the next daily run (08:40).');
  } catch (e) {
    btn.disabled = false; btn.textContent = '☆ Watch';
    wlNote(`Couldn't add: ${e.message}${/session/i.test(e.message) ? ' — sign in again' : ''}`, true);
  }
}

async function wlRemove(ev, ticker) {
  ev.stopPropagation();
  const name = (WL.items.find(i => i.ticker === ticker) || {}).name || wSym(ticker);
  if (!confirm(`Remove ${name} from your watchlist? It will stop being tracked.`)) return;
  const card = document.querySelector(`.w-card[data-t="${CSS.escape(ticker)}"]`);
  card?.classList.add('leaving');
  try {
    await wlPost('remove', ticker);
    WL.items = WL.items.filter(i => i.ticker !== ticker); delete WL.analysis[ticker]; WL.pending.delete(ticker);
    setTimeout(renderWatchlist, 200);
    wlNote(`${name} removed — no longer tracked.`);
  } catch (e) { card?.classList.remove('leaving'); wlNote(`Couldn't remove: ${e.message}`, true); }
}

function wlNote(msg, err) {
  let t = document.getElementById('alerts-toast');
  if (!t) { t = document.createElement('div'); t.id = 'alerts-toast'; document.body.appendChild(t); }
  t.className = 'show' + (err ? ' err' : ''); t.textContent = msg;
  clearTimeout(wlNote._t); wlNote._t = setTimeout(() => t.className = '', 5000);
}

// ── render ────────────────────────────────────────────────────
const VERDICT = {
  ENTER:      { cls: 'v-enter', label: '🟢 ENTER',      sub: 'Buy this week' },
  ACCUMULATE: { cls: 'v-acc',   label: '🔵 ACCUMULATE', sub: 'Buy in steps' },
  HOLD:       { cls: 'v-hold',  label: '🟡 HOLD',       sub: 'Wait for the price points' },
  AVOID:      { cls: 'v-avoid', label: '🔴 AVOID',      sub: 'Not this week' },
};

function renderWatchlist() {
  const list = document.getElementById('w-list');
  const sum = document.getElementById('w-summary');
  if (!list) return;
  wlRenderCats();
  const C = WCATS[WL.cat];
  const mine = WL.items.filter(i => wCat(i) === WL.cat);
  if (!mine.length) {
    sum.innerHTML = '';
    list.innerHTML = `<div class="loading">No ${C.label.toLowerCase()} on your watchlist yet — search above${C.picks.length ? ' or tap a quick pick' : ''}, then ☆ Watch.</div>`;
    return;
  }
  const counts = {};
  let spend = 0, budget = null;
  mine.forEach(i => {
    const a = WL.analysis[i.ticker];
    if (a?.verdict) counts[a.verdict] = (counts[a.verdict] || 0) + 1;
    if (a?.data?.budget) { budget = a.data.budget; if (['ENTER','ACCUMULATE'].includes(a.verdict)) spend += a.data.budget.this_stock || 0; }
  });
  const allOpen = mine.every(i => WL.expanded.has(i.ticker));
  sum.innerHTML = `<div class="w-summary">
    ${WL.arrange ? '' : `<button class="w-pick" onclick="wlExpandAll(${!allOpen})">${allOpen ? '▴ Collapse all' : '▾ Expand all'}</button>`}
    <button class="w-pick${WL.arrange ? ' on' : ''}" onclick="wlArrange(${!WL.arrange})" aria-pressed="${WL.arrange}">${WL.arrange ? '✓ Done' : '⇅ Arrange'}</button>
    ${WL.arrange && mine.some(i => Number.isFinite(i.sort_order)) ? '<button class="w-pick" onclick="wlResetOrder()">↺ Automatic order</button>' : ''}
    ${Object.keys(VERDICT).map(v => `<span class="w-pill ${VERDICT[v].cls}">${VERDICT[v].label.split(' ')[1]} ${counts[v] || 0}</span>`).join('')}
  </div>
  <div class="w-budget">
    <label>💷 ${C.label} budget per week £<input id="w-budget" type="number" min="0" step="5" inputmode="decimal"
      value="${budget ? Math.round(budget.watchlist_pool) : ''}" placeholder="e.g. 100"></label>
    <button onclick="wlSaveBudget()">Save</button>
    ${budget ? `<span class="w-dim">${budget.pool_source === 'your setting' ? 'your setting' : 'default: ' + _wesc(budget.pool_source || '')} · suggested buys this week £${spend}</span>` : ''}
  </div>`;
  const items = wlSorted(mine, WL.analysis);
  list.innerHTML = (WL.arrange ? '<div class="w-dim w-small" style="margin:0 0 8px">Tap ▲ ▼ to move a card. Your order is saved to your login.</div>' : '') + items.map((i, k) => wlCard(i, k, items.length)).join('');
}

function wlCard(i, pos, total) {
  const row = WL.analysis[i.ticker];
  const pending = WL.pending.has(i.ticker) || !row;
  const a = (row && row.data) || {};
  const ok = row && row.status === 'ok' && !pending;
  const v = ok ? (VERDICT[row.verdict] || VERDICT.HOLD) : null;
  const exp = WL.expanded.has(i.ticker) && !WL.arrange;
  const t = _wesc(i.ticker);
  if (WL.arrange) {                                            // Arrange mode: compact rows with big ▲ ▼ buttons, nothing else to tap by accident
    const nm = _wesc(i.name || wSym(i.ticker));
    return `<div class="w-card collapsed ${v ? v.cls : ''}" data-t="${t}"><div class="w-head w-arr"><span class="w-rank">${pos + 1}</span>
      <div class="w-title"><b>${nm}</b> <span class="w-dim">${_wesc(wSym(i.ticker))}</span></div>
      <div class="w-mv"><button type="button" data-dir="-1" onclick="wlMove(event,'${t}',-1)" aria-label="Move ${nm} up"${pos === 0 ? ' disabled' : ''}>▲</button>
      <button type="button" data-dir="1" onclick="wlMove(event,'${t}',1)" aria-label="Move ${nm} down"${pos === total - 1 ? ' disabled' : ''}>▼</button></div></div></div>`;
  }
  const head = `<div class="w-head" onclick="wlExpand('${t}')" role="button" aria-expanded="${exp}">
      <span class="w-grip" title="Drag to reorder" aria-hidden="true" onclick="event.stopPropagation()">⠿</span>
      <span class="w-chev">${exp ? '▾' : '▸'}</span>
      <div class="w-title">
        <a href="#watch/${encodeURIComponent(i.ticker)}" class="w-link" onclick="wlOpenDetail(event,'${t}')">${_wesc(i.name || wSym(i.ticker))}</a>
        <span class="w-dim">${_wesc(wSym(i.ticker))}${exp ? ' · ' + _wesc(i.exchange || '') : ''}</span>
        ${exp ? (i.t212_ticker ? '<span class="w-chip t212">✓ T212</span>'
          : (i.alternatives || []).length ? '<span class="w-chip t212">T212 via ETP/ETC</span>' : '<span class="w-chip">not on T212</span>') : ''}</div>
      <div class="w-quick">
        ${pending ? '<span class="w-dim">⏳</span>' : ok ? `<span class="w-pill sm ${v.cls}">${v.label.split(' ')[1]}</span>
          <span class="w-qp">${(typeof ddPx === 'function' ? ddPx(a.price, a) : wMoney(a.price, a.ccy))}</span>
          <span class="w-qc ${a.daily_pct < 0 ? 'red' : 'green'}">${wPct(a.daily_pct)}</span>` : '<span class="w-pill sm v-none">❔</span>'}
      </div>
      <button class="w-x" title="Remove & stop tracking" onclick="wlRemove(event,'${t}')">✕</button>
    </div>`;
  if (!exp) return `<div class="w-card collapsed ${v ? v.cls : ''}" data-t="${t}">${head}</div>`;
  if (pending) return `<div class="w-card" data-t="${t}">${head}<div class="w-dim w-pad">⏳ Analysing… (about a minute)</div></div>`;
  if (!ok) return `<div class="w-card muted" data-t="${t}">${head}
      <div class="w-pad"><span class="w-pill v-none">❔ DATA UNVERIFIED</span>
      <div class="w-dim" style="margin-top:6px">${_wesc(a.reason || 'Analysis failed')}. No verdict without verified prices.</div>${wlFiveCheck(i)}</div></div>`;

  const open = WL.open.has(i.ticker);
  const q = a.quality || {}, vol = a.volume || {};
  const rsiCls = a.rsi < 40 ? 'g' : a.rsi > 70 ? 'r' : a.rsi > 60 ? 'y' : '';
  const volCls = vol.label === 'High' ? (a.daily_pct < 0 ? 'r' : 'g') : vol.label === 'Low' ? 'y' : '';
  const qCls = q.label === 'Good' ? 'g' : q.label === 'Weak' ? 'r' : 'y';
  const entries = (a.entries || []).map(e => `<tr><td>${_wesc(e.label)}</td><td>${wMoney(e.price, a.ccy)}${wGbp(e.price, a)}</td>
      <td class="${e.pct_from_now < 0 ? 'red' : ''}">${e.pct_from_now ? wPct(e.pct_from_now) : 'now'}</td><td><b>£${e.amount_gbp}</b></td></tr>`).join('');
  return `<div class="w-card ${v.cls}" data-t="${_wesc(i.ticker)}">${head}
    <div class="w-pad">
      <div class="w-top">
        <div><span class="w-pill ${v.cls}">${v.label}</span> <span class="w-dim">${v.sub}</span></div>
        <div class="w-price">${wMoney(a.price, a.ccy)}${wGbp(a.price, a)} <span class="${a.daily_pct < 0 ? 'red' : 'green'}">${wPct(a.daily_pct)}</span></div>
      </div>
      <div class="w-chips">
        <span class="w-tag ${rsiCls}">RSI ${a.rsi ?? '—'} · ${_wesc(a.rsi_label)}</span>
        <span class="w-tag ${volCls}">Volume ${_wesc(vol.label)}${vol.ratio ? ` · ${vol.ratio}× avg` : ''}</span>
        <span class="w-tag ${qCls}">Quality ${_wesc(q.label)}</span>
        ${wlAnalystChip(a)}
      </div>
      <div class="w-why">${(a.why || []).map(w => `<div>• ${_wesc(w)}</div>`).join('')}</div>
      ${(i.alternatives || []).length ? `<div class="w-alts">🛒 On Trading 212: ${(i.alternatives).map(x =>
          `<span class="w-chip t212" title="${_wesc(x.name)}">${_wesc((x.symbol || '').replace(/\.L$/, ''))} · ${_wesc(x.currency || '')}</span>`).join('')}
          <span class="w-dim">— the price points above are for the underlying; the ETP/ETC moves with it.</span></div>` : ''}
      ${entries ? `<table class="w-table"><thead><tr><th>Price point</th><th>Price</th><th>vs now</th><th>Buy</th></tr></thead><tbody>${entries}</tbody></table>
        <div class="w-dim w-small">How much: £${a.budget?.this_stock ?? 0} ${_wesc(a.budget?.basis || '')} — from your £${Math.round(a.budget?.watchlist_pool || 0)}/week ${_wesc(C_label(i))} budget, shared across the ones worth buying.</div>`
        : `<div class="w-dim w-small">No buy levels this week.</div>`}
      <div class="w-actions-row"><span class="w-more" onclick="wlToggle('${_wesc(i.ticker)}')">${open ? '▲ Less' : '▼ Details: volume, quality, levels'}</span>
        <a class="w-more" href="#watch/${encodeURIComponent(i.ticker)}" onclick="wlOpenDetail(event,'${_wesc(i.ticker)}')">📈 Chart, profile & insights →</a></div>
      ${open ? `<div class="w-details">
        <div><b>Volume:</b> ${_wesc(vol.note)}${vol.partial_excluded ? ' <span class="w-dim">(today\'s unfinished session excluded)</span>' : ''}</div>
        <div><b>Quality checks</b>${(q.reasons || []).map(r => `<div class="w-dim">${_wesc(r)}</div>`).join('')}</div>
        <table class="w-table small"><tbody>
          <tr><td>20 / 50 / 200-day average</td><td>${wMoney(a.ma20, a.ccy)} · ${wMoney(a.ma50, a.ccy)} · ${wMoney(a.ma200, a.ccy)}</td></tr>
          <tr><td>52-week range</td><td>${wMoney(a.low52, a.ccy)} – ${wMoney(a.high52, a.ccy)} (now at ${a.range_pos}%)</td></tr>
          <tr><td>Drawdown from 20-day high</td><td>${wPct(a.drawdown20)}</td></tr>
          ${a.analyst?.target ? `<tr><td>Analyst target (${a.analyst.count})</td><td>${wMoney(a.analyst.target, a.ccy)} (${wPct(a.analyst.upside)})</td></tr>` : ''}
          ${a.take_profit ? `<tr><td>Take-profit reference</td><td>${wMoney(a.take_profit, a.ccy)}</td></tr>` : ''}
          <tr><td>Rethink if it closes below</td><td>${wMoney(a.invalidation, a.ccy)}</td></tr>
        </tbody></table>
        <div class="w-dim w-small">Source: Yahoo Finance daily data (${_wesc(a.symbol)}), close ${_wesc(a.as_of)} · updated ${new Date(row.updated_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })} · not financial advice.</div>
      </div>` : ''}
      ${wlFiveCheck(i)}
    </div></div>`;
}

// 5-check review box (same one as on the Strategy tab): the owner's prompt for this stock, opened in ChatGPT / Claude / Grok or copied.
function wlFiveCheck(i) { return typeof FiveCheck !== 'undefined' ? FiveCheck.html(i.name || wSym(i.ticker), wSym(i.ticker), 'wl') : ''; }

// Analyst view as a chip: Yahoo's recommendation and analyst count, or an honest "no coverage" (never an invented rating).
function wlAnalystChip(a) {
  const an = (a && a.analyst) || {}, n = +an.count || 0, rec = String(an.rec || 'none').toLowerCase();
  if (rec === 'none' || !n) return '<span class="w-tag" title="Source: Yahoo Finance analyst data">Analysts: no coverage</span>';
  const label = rec.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const cls = (rec === 'strong_buy' || rec === 'buy') ? 'g' : (['sell', 'underperform', 'strong_sell'].includes(rec) ? 'r' : 'y');
  return `<span class="w-tag ${cls}" title="Source: Yahoo Finance analyst data">Analysts: ${_wesc(label)} (${n})</span>`;
}

async function wlSaveBudget() {
  const v = document.getElementById('w-budget').value;
  try {
    const r = await fetch(`${PROXY}/settings/set`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SESSION_TOKEN, key: WCATS[WL.cat].key, value: v }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    WL.items.filter(i => wCat(i) === WL.cat).forEach(i => { WL.pending.add(i.ticker); i.added_at = new Date().toISOString(); });
    renderWatchlist(); wlSchedulePoll();
    wlNote(`${WCATS[WL.cat].label} budget £${d.value}/week saved — re-sizing your plans (about a minute).`);
  } catch (e) { wlNote(`Couldn't save: ${e.message}`, true); }
}

function C_label(i) { return WCATS[wCat(i)].label.toLowerCase(); }

function wlExpand(t) { WL.expanded.has(t) ? WL.expanded.delete(t) : WL.expanded.add(t); wlSaveExpanded(); renderWatchlist(); }
function wlExpandAll(on) {
  WL.items.filter(i => wCat(i) === WL.cat).forEach(i => on ? WL.expanded.add(i.ticker) : WL.expanded.delete(i.ticker));
  wlSaveExpanded(); renderWatchlist();
}

function wlToggle(t) { WL.open.has(t) ? WL.open.delete(t) : WL.open.add(t); renderWatchlist(); }
