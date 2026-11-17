// ── POSITIONS DRILL-DOWN ──────────────────────────────────────
// Pop-up per pie / whole account / single holding, like the Trading 212 pie screen:
// value · last 24h · rate of return · chart 1D 1W 1M 3M 1Y MAX · holdings.
//   1D           → your intraday portfolio snapshots (actual Trading 212 values)
//   1W … MAX     → pie_history: holdings rebuilt from your Trading 212 trade history, valued at daily closes
//   Rate of return (all-time) = T212 return ÷ invested, exactly as the app shows it.

const PD = { key: null, ticker: null, tab: 'overview', range: '1d', hist: {}, intraday: null, snap: null, meta: {} };
const PD_RANGES = [['1d', '1D'], ['1w', '1W'], ['1m', '1M'], ['3m', '3M'], ['1y', '1Y'], ['max', 'MAX']];
const PD_DAYS = { '1w': 7, '1m': 30, '3m': 91, '1y': 365 };
const PDC = { up: '#0ca30c', down: '#e66767', grid: '#2d3353', ink: '#8892a4' };   // validated (dark surface)
const pdEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pdGbp = (v, sign) => v == null || isNaN(v) ? '—' : `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pdPct = v => v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
const pdArrow = v => v == null ? '' : v >= 0 ? '↗' : '↘';
const pdName = t => (PD.meta[t]?.name && PD.meta[t].name !== t.split('_')[0] ? PD.meta[t].name : t.replace(/_US_EQ$/, '').replace(/[a-z]?_EQ$/, ''));

// ── data ──────────────────────────────────────────────────────
function pdSum(inst) { const r = inst.result || {}; return { value: +r.priceAvgValue || 0, invested: +r.priceAvgInvestedValue || 0, result: +r.priceAvgResult || 0 }; }

// live numbers for '__ALL__' (whole account) | '__DIRECT__' (outside pies) | pie name, optionally one ticker.
// src = snapshot-like {pies, total_value, cash, total_ppl}; direct holdings need PD.positions (latest snapshot only).
function pdLive(src, key, ticker) {
  const pies = src?.pies || [];
  const pieAcc = { value: 0, invested: 0, result: 0, holdings: [] };
  const pps = {};                                    // £ per share from the pie, for valuing direct shares
  pies.forEach(p => (p.instruments || []).forEach(i => {
    const s = pdSum(i), q = +i.qty || 0;
    if (q > 0 && s.value > 0) pps[i.ticker] = { pps: s.value / q, ipps: s.invested / q };
    if (s.value <= 0 && q <= 0) return;
    if (key !== '__ALL__' && key !== p.name) return;
    if (ticker && i.ticker !== ticker) return;
    pieAcc.value += s.value; pieAcc.invested += s.invested; pieAcc.result += s.result;
    pieAcc.holdings.push({ ticker: i.ticker, pie: p.name, key: p.name, qty: q, ...s });
  }));
  if (key !== '__ALL__' && key !== '__DIRECT__') return pieAcc;

  // direct holdings (shares held outside any pie): positions qty − pie qty, valued at the pie's £/share
  const direct = [];
  if (src === PD.snapObj && PD.positions) {
    const pieQty = {};
    pies.forEach(p => (p.instruments || []).forEach(i => { pieQty[i.ticker] = (pieQty[i.ticker] || 0) + (+i.qty || 0); }));
    const dh = PD.hist['__DIRECT__']?.series?.tickers || {};
    PD.positions.forEach(ps => {
      const dq = (+ps.quantity || 0) - (pieQty[ps.ticker] || 0);
      if (dq <= 1e-6 || (ticker && ps.ticker !== ticker)) return;
      let v = pps[ps.ticker] ? dq * pps[ps.ticker].pps : null;
      if (v == null) { const t = dh[ps.ticker]; v = t?.value?.length ? t.value[t.value.length - 1] : null; }
      // T212 P&L for the whole position − the pie's part = the direct shares' P&L
      const pieRes = pies.reduce((a, p) => a + (p.instruments || []).filter(i => i.ticker === ps.ticker).reduce((b, i) => b + pdSum(i).result, 0), 0);
      const res = ps.ppl != null && v != null ? +ps.ppl - pieRes : null;
      direct.push({ ticker: ps.ticker, pie: 'Direct', key: '__DIRECT__', qty: dq, value: v, invested: res == null ? null : v - res, result: res });
    });
  }
  // T212 account split: holdings = invested + P&L (total − free cash would also count blocked/pie cash)
  const a = src?.acc, hasAcc = !!(a && a.invested != null) || (src && src.total_value != null);
  const accR = !hasAcc ? null : a && a.invested != null ? +a.ppl || 0 : +src.total_ppl || 0;
  const accV = !hasAcc ? null : a && a.invested != null ? +a.invested + accR : +src.total_value - (+src.cash || 0);
  if (key === '__ALL__') {
    if (ticker || !hasAcc) {                         // one instrument: pie part + direct part
      const sum = k => direct.reduce((a, d) => a + (d[k] || 0), 0);
      const known = direct.every(d => d.result != null);
      return { value: pieAcc.value + sum('value'), invested: known ? pieAcc.invested + sum('invested') : null,
               result: known ? pieAcc.result + sum('result') : null, holdings: [...pieAcc.holdings, ...direct] };
    }
    return { value: accV, invested: accV - accR, result: accR, holdings: [...pieAcc.holdings, ...direct] };
  }
  // __DIRECT__ = account − pies (keeps T212's own P&L for the direct shares)
  const allPies = pdLive({ pies }, '__ALL__', null);
  if (!hasAcc) return { value: direct.reduce((a, d) => a + (d.value || 0), 0), invested: 0, result: 0, holdings: direct };
  const dv = accV - allPies.value, dr = accR - allPies.result;
  if (ticker) { const d = direct[0]; return { value: d?.value || 0, invested: d?.invested ?? null, result: d?.result ?? null, holdings: direct }; }
  return { value: dv, invested: dv - dr, result: dr, holdings: direct };
}

async function pdLoadSnapshotData() {
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();
  const [latest, intra] = await Promise.all([
    api('portfolio_snapshots', '?select=id,created_at,raw,total_value,cash,total_ppl&order=created_at.desc&limit=1'),
    fetch(`${PROXY}/portfolio_snapshots_all?select=created_at,total_value,cash,total_ppl,acc:raw->account,pies:raw->pies&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc`).then(r => r.ok ? r.json() : []),
  ]);
  PD.snap = latest[0] || null;
  PD.snapObj = PD.snap ? { pies: PD.snap.raw?.pies || [], total_value: PD.snap.total_value, cash: PD.snap.cash, total_ppl: PD.snap.total_ppl, acc: PD.snap.raw?.account } : null;
  PD.meta = PD.snap?.raw?.instrument_meta || {};
  PD.intraday = intra || [];
  PD.positions = PD.snap ? await api('positions', `?snapshot_id=eq.${PD.snap.id}&select=ticker,quantity,ppl`).catch(() => []) : [];
}

async function pdHist(key) {
  if (PD.hist[key] !== undefined) return PD.hist[key];
  const r = await fetch(`${PROXY}/pie_history?pie=eq.${encodeURIComponent(key)}&select=updated_at,series`);
  const rows = r.ok ? await r.json() : [];
  return (PD.hist[key] = rows[0] || null);
}

// last-24h change in profit (£) — deposits don't count, like T212's "last 24h"
function pdLast24(key, ticker) {
  const pts = (PD.intraday || []).map(s => ({ t: Date.parse(s.created_at), ...pdLive(s, key, ticker) }));
  if (pts.length < 2) return null;
  const now = pts[pts.length - 1], target = now.t - 24 * 3600e3;
  let base = pts[0];
  for (const p of pts) { if (p.t <= target) base = p; else break; }
  const d = now.result - base.result;
  return { gbp: d, pct: base.value ? d / base.value * 100 : null, since: base.t };
}

// ── open / close ──────────────────────────────────────────────
async function pdOpen(key, ticker = null, ev) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  PD.key = key; PD.ticker = ticker; PD.tab = 'overview'; PD.range = '1d';
  let el = document.getElementById('pd');
  if (!el) { el = document.createElement('div'); el.id = 'pd'; document.body.appendChild(el); }
  el.className = 'show'; document.body.style.overflow = 'hidden';
  el.innerHTML = '<div class="dd-panel"><div class="loading">Loading…</div></div>';
  try { history.pushState({ pd: key }, '', `#positions/${encodeURIComponent(ticker || key)}`); } catch (e) {}
  try { await Promise.all([PD.snap ? null : pdLoadSnapshotData(), pdHist(key), key === '__ALL__' ? pdHist('__DIRECT__') : null]); }
  catch (e) { el.innerHTML = `<div class="dd-panel"><div class="w-dim">Couldn't load: ${pdEsc(e.message)}</div></div>`; return; }
  pdRender();
}
function pdClose() {
  const el = document.getElementById('pd'); if (el) el.className = '';
  document.body.style.overflow = ''; PD.key = null;
  if (location.hash.startsWith('#positions/')) try { history.back(); } catch (e) {}
}
window.addEventListener('popstate', () => { if (PD.key && !location.hash.startsWith('#positions/')) { PD.key = null; const el = document.getElementById('pd'); if (el) el.className = ''; document.body.style.overflow = ''; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PD.key) pdClose(); });

// ── render ────────────────────────────────────────────────────
function pdTitle() {
  if (PD.ticker) return pdName(PD.ticker);
  return PD.key === '__ALL__' ? 'All positions' : PD.key === '__DIRECT__' ? 'Direct holdings' : PD.key;
}

function pdRender() {
  const el = document.getElementById('pd');
  const live = pdLive(PD.snapObj, PD.key, PD.ticker);
  const l24 = pdLast24(PD.key, PD.ticker);
  const ror = live.invested ? live.result / live.invested * 100 : null;
  const h = PD.hist[PD.key];
  const ver = (h?.series?.verification || []).filter(v => !PD.ticker || v.ticker === PD.ticker);
  const bad = ver.filter(v => !v.ok), exc = (h?.series?.excluded || []).filter(v => !PD.ticker || v.ticker === PD.ticker);
  const approx = ver.filter(v => v.ok && v.split === 'apportioned');

  el.innerHTML = `<div class="dd-panel pd-panel" role="dialog" aria-label="${pdEsc(pdTitle())}">
    <div class="dd-top">
      <button class="dd-back" style="display:block" onclick="${PD.ticker ? `pdOpen('${pdEsc(PD.key)}')` : 'pdClose()'}" aria-label="Back">←</button>
      <div class="dd-title" style="text-align:center"><div class="dd-name">${pdEsc(pdTitle())}</div>
        ${PD.ticker ? `<div class="w-dim">${pdEsc(PD.ticker.replace(/_EQ$/, ''))} · ${pdEsc(PD.key === '__DIRECT__' ? 'held directly (outside pies)' : PD.key)}</div>` : ''}</div>
      <button class="dd-back" style="display:block;visibility:hidden">·</button>
    </div>
    ${PD.ticker ? '' : `<div class="pd-tabs">${[['overview', 'Overview'], ['holdings', 'Holdings']].map(([k, l]) =>
      `<button class="${PD.tab === k ? 'active' : ''}" onclick="PD.tab='${k}'; pdRender()">${l}</button>`).join('')}</div>`}
    ${PD.tab === 'holdings' && !PD.ticker ? pdHoldings(live) : `
    <div class="pd-value">${pdGbp(live.value)}</div>
    <div class="pd-kpis">
      <div><div class="pd-k">LAST 24H</div><div class="pd-v ${l24 ? (l24.gbp >= 0 ? 'green' : 'red') : ''}">${l24 ? `${pdArrow(l24.gbp)} ${pdGbp(Math.abs(l24.gbp))}` : '—'}</div>
        ${l24?.pct != null ? `<div class="w-dim w-small">${pdPct(l24.pct)}</div>` : ''}</div>
      <div><div class="pd-k">RATE OF RETURN</div><div class="pd-v ${ror == null ? '' : ror >= 0 ? 'green' : 'red'}">${ror == null ? '—' : `${pdArrow(ror)} ${Math.abs(ror).toFixed(1)}%`}</div>
        <div class="w-dim w-small">${pdGbp(live.result, true)} on ${pdGbp(live.invested)}</div></div>
    </div>
    <div class="dd-card pd-chartcard">
      <div id="pd-chart" class="dd-chart"></div>
      <div class="dd-ranges pd-ranges">${PD_RANGES.map(([k, l]) => `<button class="${PD.range === k ? 'active' : ''}" onclick="PD.range='${k}'; pdRender()">${l}</button>`).join('')}</div>
      <div id="pd-period" class="pd-period"></div>
    </div>
    <div class="pd-verify ${bad.length || exc.length ? 'warn' : 'ok'}">${h ? (bad.length || exc.length
      ? `⚠ ${bad.length + exc.length} holding${bad.length + exc.length > 1 ? 's' : ''} couldn't be fully matched to Trading 212 — ${[...bad.map(v => `${pdName(v.ticker)}: ${v.issue}`), ...exc.map(v => `${pdName(v.ticker)}: ${v.reason}`)].map(pdEsc).join('; ')}`
      : `✓ Rebuilt from your Trading 212 trades — share counts match Trading 212${ver.length ? ` for all ${ver.length} holding${ver.length > 1 ? 's' : ''}` : ''}${approx.length ? `. ${approx.map(v => pdName(v.ticker)).join(', ')}: shares were moved between pie and direct holdings, so the daily pie/direct split is approximate` : ''}`)
      : 'History not built yet — runs after the daily Trading 212 sync.'}</div>
    ${PD.ticker ? pdHoldingFacts(live) : ''}`}
    <div class="w-dim w-small dd-foot">1D from your portfolio snapshots (every ~15–45 min in market hours). Longer ranges: holdings rebuilt from your Trading 212 order history, valued at daily closing prices${h ? ` · built ${new Date(h.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.</div>
  </div>`;
  if (PD.tab === 'overview' || PD.ticker) pdDraw(live);
}

function pdHoldings(live) {
  const tot = live.value || 1;
  const rows = [...live.holdings].sort((a, b) => b.value - a.value);
  const l24 = t => PD.key === '__ALL__' || PD.key === '__DIRECT__' ? null : pdLast24(PD.key, t);
  return `<div class="pd-hold">${rows.map(hd => {
    const r = hd.invested ? hd.result / hd.invested * 100 : null, d = l24(hd.ticker);
    const ret = hd.result == null ? '<span class="w-dim">return in Direct total</span>' : `${pdGbp(hd.result, true)} (${pdPct(r)})`;
    return `<div class="pd-hrow" onclick="pdOpen('${pdEsc(hd.key || PD.key)}','${pdEsc(hd.ticker)}')">
      <div><b>${pdEsc(pdName(hd.ticker))}</b><div class="w-dim w-small">${pdEsc(hd.ticker.replace(/_EQ$/, ''))}${PD.key === '__ALL__' ? ' · ' + pdEsc(hd.pie) : ''} · ${hd.value != null ? (hd.value / tot * 100).toFixed(1) + '%' : '—'}</div></div>
      <div style="text-align:right"><b>${pdGbp(hd.value)}</b>
        <div class="w-small ${r == null ? '' : r >= 0 ? 'green' : 'red'}">${ret}</div>
        ${d ? `<div class="w-small w-dim">24h ${pdGbp(d.gbp, true)}</div>` : ''}</div>
      <span class="w-chev">›</span></div>`; }).join('') || '<div class="w-dim">No holdings.</div>'}</div>`;
}

function pdHoldingFacts(live) {
  const hd = live.holdings[0]; if (!hd) return '';
  return `<div class="dd-card dd-stats">${[
    ['Shares held', hd.qty.toLocaleString('en-GB', { maximumFractionDigits: 6 })],
    ['Invested', pdGbp(hd.invested)], ['Value', pdGbp(hd.value)], ['Return', `${pdGbp(hd.result, true)} (${pdPct(hd.invested ? hd.result / hd.invested * 100 : null)})`],
  ].map(([k, v]) => `<div class="dd-stat"><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
}

// ── chart series for the selected range ───────────────────────
function pdSeries(live) {
  if (PD.range === '1d') {
    // intraday: whole account / pies / pie holdings from snapshots (direct single holdings have no intraday split)
    if (PD.key === '__DIRECT__' && PD.ticker) return { pts: [], daily: false, nointraday: true };
    const pts = (PD.intraday || []).map(s => { const x = pdLive(s, PD.key, PD.ticker); return { t: Date.parse(s.created_at) / 1000, v: x.value, p: x.result, inv: x.invested }; })
      .filter(p => p.v > 0 || p.inv > 0);
    const cut = Date.now() / 1000 - 24 * 3600;
    const inRange = pts.filter(p => p.t >= cut);
    return { pts: inRange.length >= 2 ? inRange : pts.slice(-Math.max(2, pts.length)), daily: false };
  }
  const s = PD.hist[PD.key]?.series; if (!s?.dates?.length) return { pts: [], daily: true };
  const T = PD.ticker ? s.tickers?.[PD.ticker] : null;
  const val = PD.ticker ? T?.value : s.value, inv = PD.ticker ? T?.invested : s.invested;
  if (!val) return { pts: [], daily: true, missing: true };
  let pts = s.dates.map((d, i) => ({ t: Date.parse(d + 'T16:30:00Z') / 1000, v: val[i], inv: inv[i], p: val[i] != null ? val[i] - inv[i] : null }))
    .filter(p => p.v != null);
  // today's point = live Trading 212 value
  const today = new Date().toISOString().slice(0, 10);
  pts = pts.filter(p => new Date(p.t * 1000).toISOString().slice(0, 10) < today);
  // live point: keep the history's own profit basis (value − net invested) so the line doesn't jump
  const lastH = pts[pts.length - 1];
  if (live.value != null) pts.push({ t: Date.now() / 1000, v: live.value, inv: lastH ? lastH.inv : live.invested, p: live.value - (lastH ? lastH.inv : live.invested), live: true });
  if (PD_DAYS[PD.range]) { const cut = Date.now() / 1000 - PD_DAYS[PD.range] * 86400; const k = pts.findIndex(p => p.t >= cut); pts = pts.slice(Math.max(0, k - 1)); }
  // drop leading zero-value stretch (before the first buy)
  const first = pts.findIndex(p => p.v > 0); if (first > 0) pts = pts.slice(first - 1 >= 0 ? first : 0);
  return { pts, daily: true };
}

// profit over the period: Δ(value − invested); return % ≈ Modified Dietz (start value + half the net money added)
function pdPeriod(pts) {
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const dp = b.p - a.p, flow = (b.inv ?? 0) - (a.inv ?? 0);
  const base = a.v + Math.max(0, flow) / 2 || b.inv;
  return { gbp: dp, pct: base ? dp / base * 100 : null, flow, from: a.t, to: b.t };
}

function pdDraw(live) {
  const box = document.getElementById('pd-chart'), per = document.getElementById('pd-period');
  if (!box) return;
  const { pts, missing } = pdSeries(live);
  if (pts.length < 2) {
    const why = missing ? "This holding's price history couldn't be matched — see the note below."
      : PD.range === '1d' ? (PD.key === '__DIRECT__' && PD.ticker ? 'Intraday isn\'t tracked for single direct holdings — pick 1W or longer.' : 'Not enough snapshots in the last 24 hours yet.')
      : 'No history for this range yet — it appears after the Trading 212 sync and history build.';
    box.innerHTML = `<div class="w-dim dd-chart-msg">${why}</div>`;
    per.innerHTML = ''; return;
  }
  const P = pdPeriod(pts), up = (P?.gbp ?? 0) >= 0, col = up ? PDC.up : PDC.down;
  per.innerHTML = P ? `<span class="w-dim">${PD_RANGES.find(r => r[0] === PD.range)[1]} profit</span>
    <b class="${up ? 'green' : 'red'}">${pdGbp(P.gbp, true)}</b> <span class="${up ? 'green' : 'red'}">(${pdPct(P.pct)})</span>
    ${Math.abs(P.flow) >= 0.01 ? `<span class="w-dim"> · net added ${pdGbp(P.flow, true)}</span>` : ''}` : '';
  const W = Math.max(300, box.clientWidth || 600), H = Math.min(280, Math.max(190, W * 0.5)), m = { l: 8, r: 8, t: 14, b: 22 };
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)); const pad = (hi - lo) * 0.1 || hi * 0.01 || 1; lo -= pad; hi += pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = t => m.l + (W - m.l - m.r) * (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0));
  const Y = v => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${X(t1).toFixed(1)},${H - m.b}L${X(t0).toFixed(1)},${H - m.b}Z`;
  const fmtT = (t, long) => new Date(t * 1000).toLocaleString('en-GB', PD.range === '1d' ? { hour: '2-digit', minute: '2-digit', ...(long ? { weekday: 'short' } : {}) }
    : PD.range === '1y' || PD.range === 'max' ? { month: 'short', year: '2-digit', ...(long ? { day: 'numeric' } : {}) } : { day: 'numeric', month: 'short' });
  const ticks = [t0, t0 + (t1 - t0) / 2, t1];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${pdEsc(pdTitle())} value, ${PD.range}: from ${pdGbp(pts[0].v)} to ${pdGbp(pts[pts.length - 1].v)}">
    <defs><linearGradient id="pdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${m.l}" x2="${W - m.r}" y1="${Y(pts[0].v)}" y2="${Y(pts[0].v)}" stroke="${PDC.ink}" stroke-dasharray="2 4" opacity=".6"/>
    <path d="${area}" fill="url(#pdg)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    ${ticks.map((t, i) => `<text x="${X(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}" fill="${PDC.ink}" font-size="11">${fmtT(t)}</text>`).join('')}
    <text x="${W - m.r}" y="${m.t - 2}" text-anchor="end" fill="${PDC.ink}" font-size="10">high ${pdGbp(hi - pad)}</text>
    <g id="pd-x" style="display:none"><line id="pd-xl" y1="${m.t}" y2="${H - m.b}" stroke="${PDC.ink}"/><circle id="pd-xd" r="4.5" fill="${col}" stroke="#1a1d27" stroke-width="2"/></g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="pd-hit"/>
  </svg><div id="pd-tip" class="dd-tip"></div>`;
  const svg = box.querySelector('svg'), hit = box.querySelector('#pd-hit'), g = box.querySelector('#pd-x'), tip = box.querySelector('#pd-tip');
  const move = e => {
    const r = svg.getBoundingClientRect(), x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * W / r.width;
    let i = 0, best = Infinity; pts.forEach((p, k) => { const dd = Math.abs(X(p.t) - x); if (dd < best) { best = dd; i = k; } });
    const p = pts[i]; g.style.display = '';
    ['x1', 'x2'].forEach(a => box.querySelector('#pd-xl').setAttribute(a, X(p.t)));
    box.querySelector('#pd-xd').setAttribute('cx', X(p.t)); box.querySelector('#pd-xd').setAttribute('cy', Y(p.v));
    const dp = p.p - pts[0].p;
    tip.style.display = 'block';
    tip.innerHTML = `<b>${pdGbp(p.v)}</b><br><span class="${dp >= 0 ? 'green' : 'red'}">${pdGbp(dp, true)}</span> <span class="w-dim">profit since start</span><br><span class="w-dim">${p.live ? 'Now (live)' : fmtT(p.t, true)}</span>`;
    tip.style.left = `${Math.min(r.width - 160, Math.max(0, X(p.t) * r.width / W - 75))}px`;
  };
  const leave = () => { g.style.display = 'none'; tip.style.display = 'none'; };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true });
  hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
}
window.addEventListener('resize', () => { if (PD.key && (PD.tab === 'overview' || PD.ticker)) pdDraw(pdLive(PD.snapObj, PD.key, PD.ticker)); });
