// ── WATCHLIST ─────────────────────────────────────────────────
// Three sections: 📈 Stocks (Yahoo, any exchange) · 🛢 Commodities (T212 ETCs + market futures)
// · ₿ Crypto (Yahoo coins + T212 crypto ETPs). ☆ bookmark → this week's call:
// ENTER / ACCUMULATE / HOLD / AVOID, price points with £ per step, RSI, volume, quality.
// ✕ removes it and stops all tracking. Writes go through the worker (/watchlist/*).

const WL = { cat: 'stock', items: [], analysis: {}, open: new Set(), pending: new Set(), searchTimer: null, poll: null,
             expanded: new Set((() => { try { return JSON.parse(localStorage.getItem('wl_expanded') || '[]'); } catch (e) { return []; } })()) };
function wlSaveExpanded() { try { localStorage.setItem('wl_expanded', JSON.stringify([...WL.expanded])); } catch (e) {} }
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
  WL.items = items;
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
    <button class="w-pick" onclick="wlExpandAll(${!allOpen})">${allOpen ? '▴ Collapse all' : '▾ Expand all'}</button>
    ${Object.keys(VERDICT).map(v => `<span class="w-pill ${VERDICT[v].cls}">${VERDICT[v].label.split(' ')[1]} ${counts[v] || 0}</span>`).join('')}
  </div>
  <div class="w-budget">
    <label>💷 ${C.label} budget per week £<input id="w-budget" type="number" min="0" step="5" inputmode="decimal"
      value="${budget ? Math.round(budget.watchlist_pool) : ''}" placeholder="e.g. 100"></label>
    <button onclick="wlSaveBudget()">Save</button>
    ${budget ? `<span class="w-dim">${budget.pool_source === 'your setting' ? 'your setting' : 'default: ' + _wesc(budget.pool_source || '')} · suggested buys this week £${spend}</span>` : ''}
  </div>`;
  const order = { ENTER: 0, ACCUMULATE: 1, HOLD: 2, AVOID: 3 };
  const items = [...mine].sort((a, b) => (order[WL.analysis[a.ticker]?.verdict] ?? 4) - (order[WL.analysis[b.ticker]?.verdict] ?? 4));
  list.innerHTML = items.map(wlCard).join('');
}

function wlCard(i) {
  const row = WL.analysis[i.ticker];
  const pending = WL.pending.has(i.ticker) || !row;
  const a = (row && row.data) || {};
  const ok = row && row.status === 'ok' && !pending;
  const v = ok ? (VERDICT[row.verdict] || VERDICT.HOLD) : null;
  const exp = WL.expanded.has(i.ticker);
  const t = _wesc(i.ticker);
  const head = `<div class="w-head" onclick="wlExpand('${t}')" role="button" aria-expanded="${exp}">
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
      <div class="w-dim" style="margin-top:6px">${_wesc(a.reason || 'Analysis failed')}. No verdict without verified prices.</div></div></div>`;

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
    </div></div>`;
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
