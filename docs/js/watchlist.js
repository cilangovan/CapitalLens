// ── WATCHLIST ─────────────────────────────────────────────────
// Search any stock/ETF on any exchange worldwide (Yahoo Finance) → ☆ bookmark → this week's call:
// ENTER / ACCUMULATE / HOLD / AVOID, price points with £ per step, RSI, volume, quality.
// ✕ removes it and stops all tracking. Writes go through the worker (/watchlist/*).

const WL = { items: [], analysis: {}, open: new Set(), pending: new Set(), searchTimer: null, poll: null };
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
    <div class="w-search card">
      <input id="w-q" type="search" autocomplete="off" placeholder="🔍 Search any stock or ETF worldwide — name or symbol (e.g. Toyota, Rolls-Royce, 0700.HK)" oninput="wlSearch(this.value)">
      <div id="w-results"></div>
    </div>
    <div id="w-summary"></div>
    <div id="w-list"><div class="loading">Loading…</div></div>`;
  await wlRefresh();
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
function wlSearch(q) {
  clearTimeout(WL.searchTimer);
  const box = document.getElementById('w-results');
  q = q.trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  WL.searchTimer = setTimeout(async () => {
    box.innerHTML = '<div class="w-dim" style="padding:8px">Searching markets…</div>';
    try {
      const r = await fetch(`${PROXY}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: SESSION_TOKEN, q }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (document.getElementById('w-q').value.trim() !== q) return;   // a newer search is running
      const held = new Set(WL.items.map(i => i.ticker));
      const rows = d.results || [];
      box.innerHTML = (d.note ? `<div class="w-dim" style="padding:6px 4px;color:var(--yellow)">${_wesc(d.note)}</div>` : '') +
        (rows.length ? rows.slice(0, 15).map(x => `
        <div class="w-res">
          <div><b>${_wesc(x.name)}</b> <span class="w-dim">${_wesc(x.symbol)}</span><br>
            <span class="w-chip">${_wesc(x.exchange)}</span><span class="w-chip">${_wesc(x.type)}</span>
            ${x.t212_ticker ? '<span class="w-chip t212">✓ On Trading 212</span>' : '<span class="w-chip">T212: check app</span>'}</div>
          ${held.has(x.symbol)
            ? `<button class="w-star on" disabled>★ Watching</button>`
            : `<button class="w-star" onclick="wlAdd('${_wesc(x.symbol)}', this)">☆ Watch</button>`}
        </div>`).join('')
        : '<div class="w-dim" style="padding:8px">No stocks or ETFs found.</div>');
    } catch (e) {
      box.innerHTML = `<div style="color:var(--red);padding:8px">Search failed: ${_wesc(e.message)}${/session/i.test(e.message) ? ' — sign in again' : ''}</div>`;
    }
  }, 350);
}

async function wlPost(route, ticker) {
  const r = await fetch(`${PROXY}/watchlist/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: SESSION_TOKEN, symbol: ticker }),
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
  if (!WL.items.length) {
    sum.innerHTML = '';
    list.innerHTML = '<div class="loading">Your watchlist is empty — search above and tap ☆ Watch.</div>';
    return;
  }
  const counts = {};
  let spend = 0, budget = null;
  WL.items.forEach(i => {
    const a = WL.analysis[i.ticker];
    if (a?.verdict) counts[a.verdict] = (counts[a.verdict] || 0) + 1;
    if (a?.data?.budget) { budget = a.data.budget; if (['ENTER','ACCUMULATE'].includes(a.verdict)) spend += a.data.budget.this_stock || 0; }
  });
  sum.innerHTML = `<div class="w-summary">
    ${Object.keys(VERDICT).map(v => `<span class="w-pill ${VERDICT[v].cls}">${VERDICT[v].label.split(' ')[1]} ${counts[v] || 0}</span>`).join('')}
    ${budget ? `<span class="w-dim">· Watchlist budget this week £${Math.round(budget.watchlist_pool)} of £${Math.round(budget.weekly_budget)} · suggested buys £${spend}</span>` : ''}
  </div>`;
  const order = { ENTER: 0, ACCUMULATE: 1, HOLD: 2, AVOID: 3 };
  const items = [...WL.items].sort((a, b) => (order[WL.analysis[a.ticker]?.verdict] ?? 4) - (order[WL.analysis[b.ticker]?.verdict] ?? 4));
  list.innerHTML = items.map(wlCard).join('');
}

function wlCard(i) {
  const row = WL.analysis[i.ticker];
  const pending = WL.pending.has(i.ticker) || !row;
  const head = `<div class="w-head" onclick="wlToggle('${_wesc(i.ticker)}')">
      <div class="w-title"><b>${_wesc(i.name || wSym(i.ticker))}</b> <span class="w-dim">${_wesc(wSym(i.ticker))} · ${_wesc(i.exchange || '')}</span>
        ${i.t212_ticker ? '<span class="w-chip t212">✓ T212</span>' : '<span class="w-chip">not on T212</span>'}</div>
      <button class="w-x" title="Remove & stop tracking" onclick="wlRemove(event,'${_wesc(i.ticker)}')">✕</button>
    </div>`;
  if (pending) return `<div class="w-card" data-t="${_wesc(i.ticker)}">${head}<div class="w-dim w-pad">⏳ Analysing… (about a minute)</div></div>`;
  const a = row.data || {};
  if (row.status !== 'ok') return `<div class="w-card muted" data-t="${_wesc(i.ticker)}">${head}
      <div class="w-pad"><span class="w-pill v-none">❔ DATA UNVERIFIED</span>
      <div class="w-dim" style="margin-top:6px">${_wesc(a.reason || 'Analysis failed')}. No verdict without verified prices.</div></div></div>`;

  const v = VERDICT[row.verdict] || VERDICT.HOLD;
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
      ${entries ? `<table class="w-table"><thead><tr><th>Price point</th><th>Price</th><th>vs now</th><th>Buy</th></tr></thead><tbody>${entries}</tbody></table>
        <div class="w-dim w-small">How much: £${a.budget?.this_stock ?? 0} ${_wesc(a.budget?.basis || '')} — from the £${Math.round(a.budget?.watchlist_pool || 0)} watchlist share of this week's £${Math.round(a.budget?.weekly_budget || 0)} budget.</div>`
        : `<div class="w-dim w-small">No buy levels this week.</div>`}
      <div class="w-more" onclick="wlToggle('${_wesc(i.ticker)}')">${open ? '▲ Less' : '▼ Details: volume, quality, levels'}</div>
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

function wlToggle(t) { WL.open.has(t) ? WL.open.delete(t) : WL.open.add(t); renderWatchlist(); }
