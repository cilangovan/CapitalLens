// ── WATCHLIST DRILL-DOWN ──────────────────────────────────────
// Tap a watchlist name → full detail page: live chart (1D…5Y, 50/200-day MA), day & 52-week
// ranges, key stats, analyst rating + target, trading/profitability/leverage, company profile,
// insights + score radar, and this week's plan. Live prices via the worker's /chart route
// (Yahoo Finance); everything else from the daily watchlist analysis.

const DD = { ticker: null, range: '1d', ma: new Set(), chart: null, cache: {} };
// Validated against the dark surface (dataviz validate_palette: all checks pass)
const DDC = { up: '#0ca30c', down: '#e66767', ma50: '#3987e5', ma200: '#d95926', grid: '#2d3353', ink: '#8892a4' };
const DD_RANGES = [['1d', '1D'], ['5d', '5D'], ['1mo', '1M'], ['6mo', '6M'], ['1y', '1Y'], ['5y', '5Y']];
const ddEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ddNum = (v, d = 2) => v == null || isNaN(v) ? '—' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const ddBig = v => v == null ? '—' : v >= 1e12 ? `${ddNum(v / 1e12)}T` : v >= 1e9 ? `${ddNum(v / 1e9)}B` : v >= 1e6 ? `${ddNum(v / 1e6)}M` : v >= 1e3 ? `${ddNum(v / 1e3)}K` : ddNum(v, 0);
const ddPct = (v, d = 2) => v == null || isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;

// Prices are stored in main units (GBP); London lines quoted in pence are shown in pence, like T212/MSN
function ddPx(v, a) {
  if (v == null || isNaN(v)) return '—';
  if (['GBp', 'GBX'].includes(a.quote_ccy)) return `${ddNum(v * 100)}p`;
  const sym = { GBP: '£', USD: '$', EUR: '€' }[a.ccy];
  return sym ? `${sym}${ddNum(v, v < 1 ? 4 : 2)}` : `${ddNum(v, v < 1 ? 4 : 2)} ${a.ccy || ''}`;
}
const ddMoney = (v, a) => v == null ? '—' : `${{ GBP: '£', USD: '$', EUR: '€' }[a.ccy] || ''}${ddBig(v)}${{ GBP: 1, USD: 1, EUR: 1 }[a.ccy] ? '' : ' ' + (a.ccy || '')}`;

function wlOpenDetail(ev, ticker) {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  DD.ticker = ticker; DD.range = '1d'; DD.ma.clear();
  let el = document.getElementById('dd');
  if (!el) { el = document.createElement('div'); el.id = 'dd'; document.body.appendChild(el); }
  el.className = 'show';
  document.body.style.overflow = 'hidden';
  try { history.pushState({ dd: ticker }, '', `#watch/${encodeURIComponent(ticker)}`); } catch (e) {}
  ddRender();
  ddLoadChart();
}

function ddClose() {
  const el = document.getElementById('dd');
  if (el) el.className = '';
  document.body.style.overflow = '';
  DD.ticker = null;
  if (location.hash.startsWith('#watch/')) try { history.back(); } catch (e) {}
}
window.addEventListener('popstate', () => { if (DD.ticker && !location.hash.startsWith('#watch/')) { DD.ticker = null; const el = document.getElementById('dd'); if (el) el.className = ''; document.body.style.overflow = ''; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && DD.ticker) ddClose(); });

function ddItem() { return WL.items.find(i => i.ticker === DD.ticker) || {}; }
function ddData() { const r = WL.analysis[DD.ticker]; return r && r.status === 'ok' ? r.data || {} : (r?.data || {}); }

function ddRender() {
  const el = document.getElementById('dd');
  const i = ddItem(), row = WL.analysis[DD.ticker] || {}, a = ddData();
  const st = a.stats || {}, f = a.fundamentals || {}, an = a.analyst_detail || {}, pr = a.profile || {}, ins = a.insights || {};
  const live = DD.chart?.meta || {};
  const price = live.price ?? a.price, prev = live.prev_close && DD.range === '1d' ? live.prev_close : (st.prev_close ?? null);
  const chg = price != null && prev ? price - prev : null, chgPct = chg != null ? chg / prev * 100 : a.daily_pct;
  const v = (typeof VERDICT !== 'undefined' && VERDICT[row.verdict]) || null;
  const dayLow = live.day_low ?? st.day_low, dayHigh = live.day_high ?? st.day_high;
  const lo52 = live.low52 ?? st.low52 ?? a.low52, hi52 = live.high52 ?? st.high52 ?? a.high52;
  const up = (chg ?? 0) >= 0;

  el.innerHTML = `
  <div class="dd-panel" role="dialog" aria-label="${ddEsc(i.name || DD.ticker)} details">
    <div class="dd-top">
      <button class="dd-back" onclick="ddClose()" aria-label="Back">←</button>
      <div class="dd-title">
        <div class="dd-name">${ddEsc(i.name || DD.ticker)}</div>
        <div class="w-dim">${ddEsc(DD.ticker)} · ${ddEsc(live.exchange || a.exchange || i.exchange || '')}${pr.sector ? ' · ' + ddEsc(pr.sector) : ''}
          ${i.t212_ticker ? '<span class="w-chip t212">✓ On Trading 212</span>' : (i.alternatives || []).length ? '<span class="w-chip t212">T212 via ETP/ETC</span>' : ''}</div>
      </div>
      <button class="dd-x" onclick="ddClose()" aria-label="Close">✕</button>
    </div>

    <div class="dd-quote">
      <span class="dd-price">${ddPx(price, a)}</span>
      <span class="dd-chg ${up ? 'green' : 'red'}">${chg != null ? (up ? '▲ ' : '▼ ') + ddPx(Math.abs(chg), a) + ' (' + ddPct(chgPct) + ')' : ddPct(chgPct)}</span>
      ${v ? `<span class="w-pill ${v.cls}">${v.label}</span>` : ''}
      <div class="w-dim w-small">${live.market_time ? 'Live · ' + new Date(live.market_time * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : a.as_of ? 'Close ' + ddEsc(a.as_of) : ''}</div>
    </div>

    <div class="dd-card">
      <div class="dd-chart-bar">
        <div class="dd-ranges">${DD_RANGES.map(([k, l]) => `<button class="${DD.range === k ? 'active' : ''}" onclick="ddSetRange('${k}')">${l}</button>`).join('')}</div>
        <div class="dd-ma">${['50', '200'].map(m => `<button class="${DD.ma.has(m) ? 'active' : ''}" ${['1d', '5d', '5y'].includes(DD.range) ? 'disabled title="Moving averages show on 1M, 6M and 1Y"' : ''} onclick="ddToggleMA('${m}')">${m}D MA</button>`).join('')}</div>
      </div>
      <div id="dd-chart" class="dd-chart"><div class="loading">Loading chart…</div></div>
      <div id="dd-legend" class="dd-legend"></div>
    </div>

    <div class="dd-grid2">
      <div class="dd-card">${ddRangeBar('Day range', dayLow, dayHigh, price, st.open, a)}${ddRangeBar('52-week range', lo52, hi52, price, null, a)}</div>
      <div class="dd-card dd-stats">${[
        ['Previous close', ddPx(st.prev_close, a)], ['Open', ddPx(st.open, a)],
        ['Volume', ddBig(live.volume ?? st.volume)], ['Average volume', ddBig(st.avg_volume)],
        ['Market cap', ddMoney(st.market_cap, a)], ['Shares outstanding', ddBig(st.shares_out)],
        ['P/E (trailing · forward)', `${ddNum(st.pe, 1)} · ${ddNum(st.fwd_pe, 1)}`], ['Dividend yield', st.div_yield != null ? ddPct(st.div_yield > 1 ? st.div_yield : st.div_yield * 100).replace('+', '') : '—'],
      ].map(([k, val]) => `<div class="dd-stat"><span>${k}</span><b>${val}</b></div>`).join('')}</div>
    </div>

    <div class="dd-tiles">
      <div class="dd-card dd-tile"><div class="dd-h">Analyst rating</div>${ddGauge(an)}<div class="w-dim">${an.count ? `${an.count} analyst${an.count > 1 ? 's' : ''}` : 'No analyst coverage'}</div></div>
      <div class="dd-card dd-tile"><div class="dd-h">Target price</div>
        <div class="dd-big">${ddPx(an.target_mean, a)}</div>
        <div class="${an.target_mean && price ? (an.target_mean >= price ? 'green' : 'red') : 'w-dim'}">${an.target_mean && price ? ddPct((an.target_mean / price - 1) * 100, 1) + ' vs today' : '—'}</div>
        <div class="w-dim w-small">${an.target_low ? `Range ${ddPx(an.target_low, a)} – ${ddPx(an.target_high, a)}` : ''}</div></div>
      ${ddTile('Trading', 'Volume', a.volume?.ratio != null ? `${a.volume.ratio}×` : '—', a.volume?.label || '', a.volume?.label === 'High' ? (a.daily_pct < 0 ? 'bad' : 'good') : a.volume?.label === 'Low' ? 'warn' : '')}
      ${ddTile('Profitability', 'Net margin', f.net_margin != null ? ddPct(f.net_margin * 100).replace('+', '') : '—', f.roa != null ? `ROA ${(f.roa * 100).toFixed(2)}%` : '', f.net_margin == null ? '' : f.net_margin > .1 ? 'good' : f.net_margin < .05 ? 'bad' : 'warn')}
      ${ddTile('Leverage & liquidity', 'Debt / equity', f.debt_to_equity != null ? `${f.debt_to_equity.toFixed(1)}%` : '—', f.current_ratio != null ? `Current ratio ${f.current_ratio.toFixed(2)}` : '', f.debt_to_equity == null ? '' : f.debt_to_equity < 50 ? 'good' : f.debt_to_equity > 150 ? 'bad' : 'warn')}
    </div>

    ${pr.summary || pr.industry ? `<div class="dd-card"><div class="dd-h">🏛 Company profile</div>
      <div class="dd-prof">${pr.sector ? `<div><span class="w-dim">Sector</span> <b>${ddEsc(pr.sector)}</b></div>` : ''}${pr.industry ? `<div><span class="w-dim">Industry</span> <b>${ddEsc(pr.industry)}</b></div>` : ''}
        ${pr.employees ? `<div><span class="w-dim">Employees</span> <b>${Number(pr.employees).toLocaleString('en-GB')}</b></div>` : ''}${pr.country ? `<div><span class="w-dim">Country</span> <b>${ddEsc(pr.country)}</b></div>` : ''}
        ${pr.website ? `<div><a href="${ddEsc(pr.website)}" target="_blank" rel="noopener">${ddEsc(pr.website.replace(/^https?:\/\/(www\.)?/, ''))} ↗</a></div>` : ''}</div>
      ${pr.summary ? `<p class="dd-summary" id="dd-sum">${ddEsc(pr.summary)}</p><span class="w-more" onclick="ddToggleSummary(this)">More</span>` : ''}</div>` : ''}

    <div class="dd-card"><div class="dd-h">💡 Insights</div>
      <div class="dd-ins">
        <ul class="dd-ins-list">${(ins.items || []).map(x => `<li class="${x.good ? 'good' : 'bad'}"><span aria-hidden="true">${x.good ? '✓' : '!'}</span>${ddEsc(x.text)}<span class="sr">${x.good ? ' (positive)' : ' (caution)'}</span></li>`).join('') || '<li class="w-dim">Not enough data for insights.</li>'}</ul>
        ${ddRadar(ins.scores || {})}
      </div>
      <div class="w-dim w-small">Rule-based from Yahoo Finance fundamentals and prices — each area scored 0–6.</div>
    </div>

    ${ddPlan(i, row, a)}
    <div class="w-dim w-small dd-foot">Sources: live chart from Yahoo Finance via your worker; fundamentals, analyst and profile data from the daily watchlist analysis (updated ${row.updated_at ? new Date(row.updated_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}). Not financial advice.</div>
  </div>`;
  ddDrawChart();
}

function ddTile(h, label, val, sub, tone) {
  return `<div class="dd-card dd-tile"><div class="dd-h">${h}</div><div class="w-dim w-small">${label}</div>
    <div class="dd-big ${tone ? 'tone-' + tone : ''}">${val}</div><div class="w-dim w-small">${ddEsc(sub)}</div></div>`;
}

function ddRangeBar(label, lo, hi, cur, open, a) {
  if (lo == null || hi == null || hi <= lo) return `<div class="dd-range"><div class="dd-h">${label}</div><div class="w-dim">—</div></div>`;
  const pos = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
  return `<div class="dd-range"><div class="dd-h">${label}</div>
    <div class="dd-rvals"><span>${ddPx(lo, a)}</span><span>${ddPx(hi, a)}</span></div>
    <div class="dd-rbar" role="img" aria-label="${label}: low ${ddPx(lo, a)}, high ${ddPx(hi, a)}, now ${ddPx(cur, a)}">
      ${open != null ? `<i class="dd-open" style="left:${pos(open)}%" title="Open ${ddPx(open, a)}"></i>` : ''}
      ${cur != null ? `<i class="dd-now" style="left:${pos(cur)}%"></i>` : ''}</div>
    ${open != null ? `<div class="w-dim w-small" style="padding-left:calc(${pos(open)}% - 14px)">▲ Open ${ddPx(open, a)}</div>` : `<div class="w-dim w-small">Now at ${Math.round(pos(cur))}% of the range</div>`}</div>`;
}

function ddGauge(an) {
  if (!an.mean) return '<div class="dd-big w-dim">—</div>';
  // 1 = Strong buy (right) … 5 = Strong sell (left)
  const t = Math.max(0, Math.min(1, (5 - an.mean) / 4)), ang = Math.PI * (1 - t);
  const cx = 60, cy = 56, r = 44, x = cx + r * 0.82 * Math.cos(ang), y = cy - r * 0.82 * Math.sin(ang);
  const arc = (a0, a1, col) => { const p = a => [cx + r * Math.cos(a), cy - r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `<path d="M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}" stroke="${col}" stroke-width="7" fill="none"/>`; };
  return `<div class="dd-gauge"><svg viewBox="0 0 120 66" width="120" height="66" role="img" aria-label="Analyst consensus ${an.label}">
      ${arc(Math.PI, Math.PI * 0.62, DDC.down)}${arc(Math.PI * 0.6, Math.PI * 0.4, '#8892a4')}${arc(Math.PI * 0.38, 0, DDC.up)}
      <line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e2e8f0" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#e2e8f0"/></svg>
    <div class="dd-big ${an.mean <= 2.5 ? 'green' : an.mean >= 3.5 ? 'red' : ''}">${ddEsc(an.label)}</div></div>`;
}

function ddRadar(sc) {
  const axes = [['valuation', 'Valuation'], ['earnings', 'Earnings'], ['growth', 'Growth'], ['performance', 'Performance'], ['health', 'Health']];
  if (!axes.some(([k]) => sc[k] != null)) return '';
  const cx = 130, cy = 112, R = 72, pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / axes.length; return [cx + R * v / 6 * Math.cos(a), cy + R * v / 6 * Math.sin(a)]; };
  const rings = [2, 4, 6].map(v => `<polygon points="${axes.map((_, i) => pt(i, v).join(',')).join(' ')}" fill="none" stroke="${DDC.grid}"/>`).join('');
  const spokes = axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 6)[0]}" y2="${pt(i, 6)[1]}" stroke="${DDC.grid}"/>`).join('');
  const poly = axes.map(([k], i) => pt(i, sc[k] ?? 0).join(',')).join(' ');
  const dots = axes.map(([k], i) => sc[k] == null ? '' : `<circle cx="${pt(i, sc[k])[0]}" cy="${pt(i, sc[k])[1]}" r="4" fill="#3987e5" stroke="#1a1d27" stroke-width="2"/>`).join('');
  const labels = axes.map(([k, l], i) => { const [x, y] = pt(i, 7.9); return `<text x="${x}" y="${y}" text-anchor="middle" fill="#8892a4" font-size="11">${l}</text><text x="${x}" y="${y + 13}" text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="600">${sc[k] ?? '–'}/6</text>`; }).join('');
  return `<svg class="dd-radar" viewBox="0 0 260 236" role="img" aria-label="Scores: ${axes.map(([k, l]) => `${l} ${sc[k] ?? 'n/a'} of 6`).join(', ')}">
    ${rings}${spokes}<polygon points="${poly}" fill="rgba(57,135,229,.28)" stroke="#3987e5" stroke-width="2"/>${dots}${labels}</svg>`;
}

function ddPlan(i, row, a) {
  if (!row.verdict) return '';
  const v = VERDICT[row.verdict] || VERDICT.HOLD;   // unknown verdict → neutral, never crash
  const steps = (a.entries || []).map(e => `<tr><td>${ddEsc(e.label)}</td><td>${ddPx(e.price, a)}</td><td>${e.pct_from_now ? ddPct(e.pct_from_now, 1) : 'now'}</td><td><b>£${e.amount_gbp}</b></td></tr>`).join('');
  return `<div class="dd-card"><div class="dd-h">📅 This week's plan</div>
    <div><span class="w-pill ${v.cls}">${v.label}</span> <span class="w-dim">${v.sub}</span></div>
    <div class="w-why">${(a.why || []).map(w => `<div>• ${ddEsc(w)}</div>`).join('')}</div>
    ${steps ? `<table class="w-table"><thead><tr><th>Price point</th><th>Price</th><th>vs now</th><th>Buy</th></tr></thead><tbody>${steps}</tbody></table>` : ''}
    <div class="w-dim w-small">RSI ${a.rsi ?? '—'} (${ddEsc(a.rsi_label || '')}) · Volume ${ddEsc(a.volume?.label || '—')} · Quality ${ddEsc(a.quality?.label || '—')} · Rethink below ${ddPx(a.invalidation, a)}</div></div>`;
}

// ── chart data ────────────────────────────────────────────────
function ddSetRange(r) { DD.range = r; if (['1d', '5d', '5y'].includes(r)) DD.ma.clear(); ddLoadChart(); }
function ddToggleSummary(btn) { document.getElementById('dd-sum').classList.toggle('open'); btn.textContent = btn.textContent === 'More' ? 'Less' : 'More'; }
function ddToggleMA(m) { DD.ma.has(m) ? DD.ma.delete(m) : DD.ma.add(m); ddRender(); }

async function ddLoadChart() {
  const key = `${DD.ticker}|${DD.range}`, ticker = DD.ticker;
  const hit = DD.cache[key];
  if (hit && Date.now() - hit.at < (DD.range === '1d' ? 60e3 : 900e3)) { DD.chart = hit.data; return ddRender(); }
  DD.chart = null; ddRender();
  try {
    const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SESSION_TOKEN, symbol: ticker, range: DD.range }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.points?.length) throw new Error(d.error || `HTTP ${r.status}`);
    DD.cache[key] = { at: Date.now(), data: d };
    if (DD.ticker === ticker) { DD.chart = d; ddRender(); }
  } catch (e) {
    if (DD.ticker !== ticker) return;
    // fallback: stored daily closes
    const h = ddData().history;
    const n = { '1mo': 22, '6mo': 126, '1y': 252, '5y': 260 }[DD.range];
    if (h?.closes?.length && n) {
      const k = Math.max(0, h.closes.length - n);
      DD.chart = { fallback: `Live chart unavailable (${e.message}) — showing stored daily closes.`, meta: {},
        points: h.dates.slice(k).map((d, j) => [Date.parse(d) / 1000, h.closes[k + j]]) };
    } else {
      DD.chart = { error: `Live chart unavailable (${e.message}).${h?.closes?.length ? ' Try 1M, 6M or 1Y for stored daily closes.' : ''}`, meta: {}, points: [] };
    }
    ddRender();
  }
}

function ddMA(points, n) {
  // moving average from the stored daily history, aligned to each point's date
  const h = ddData().history; if (!h?.closes?.length) return null;
  const idx = {}; h.dates.forEach((d, i) => idx[d] = i);
  return points.map(([t]) => {
    const i = idx[new Date(t * 1000).toISOString().slice(0, 10)];
    if (i == null || i + 1 < n) return null;
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += h.closes[j];
    return s / n;
  });
}

// ── chart drawing (SVG, 2px line, crosshair + tooltip) ────────
function ddDrawChart() {
  const box = document.getElementById('dd-chart'), leg = document.getElementById('dd-legend');
  if (!box) return;
  const c = DD.chart, a = ddData();
  if (!c) { box.innerHTML = '<div class="loading">Loading chart…</div>'; return; }
  if (c.error) { box.innerHTML = `<div class="w-dim dd-chart-msg">${ddEsc(c.error)}</div>`; leg.innerHTML = ''; return; }
  const P = c.points, W = Math.max(300, box.clientWidth || 600), H = Math.min(300, Math.max(200, W * 0.42));
  const m = { l: 52, r: 12, t: 12, b: 26 };
  const base = DD.range === '1d' && c.meta?.prev_close ? c.meta.prev_close : P[0][1];
  const series = [];
  if (DD.ma.has('50')) series.push({ key: '50D MA', col: DDC.ma50, vals: ddMA(P, 50) });
  if (DD.ma.has('200')) series.push({ key: '200D MA', col: DDC.ma200, vals: ddMA(P, 200) });
  const all = P.map(p => p[1]).concat(DD.range === '1d' && c.meta?.prev_close ? [c.meta.prev_close] : []);
  series.forEach(s => (s.vals || []).forEach(v => v != null && all.push(v)));
  let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.08 || hi * 0.01; lo -= pad; hi += pad;
  const X = i => m.l + (W - m.l - m.r) * (P.length === 1 ? 0.5 : i / (P.length - 1));
  const Y = v => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const up = P[P.length - 1][1] >= base, col = up ? DDC.up : DDC.down;
  const tz = c.meta?.timezone;
  const fmtT = (t, long) => new Date(t * 1000).toLocaleString('en-GB', Object.assign({ timeZone: tz || undefined },
    DD.range === '1d' ? { hour: '2-digit', minute: '2-digit' } : DD.range === '5d' ? (long ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { weekday: 'short' })
      : DD.range === '5y' ? { month: 'short', year: 'numeric' } : long ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }));
  const ticks = 4, grid = Array.from({ length: ticks + 1 }, (_, k) => lo + (hi - lo) * k / ticks);
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(P.length - 1).toFixed(1)},${H - m.b}L${X(0).toFixed(1)},${H - m.b}Z`;
  const xt = [0, Math.floor(P.length / 3), Math.floor(2 * P.length / 3), P.length - 1].filter((v, i, s) => s.indexOf(v) === i);
  const maPaths = series.map(s => { if (!s.vals) return ''; let d = '', pen = false;
    s.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.col}" stroke-width="2" stroke-dasharray="6 4"/>`; }).join('');
  box.innerHTML = `${c.fallback ? `<div class="w-dim w-small" style="color:var(--yellow)">${ddEsc(c.fallback)}</div>` : ''}
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Price chart ${DD.range}, from ${ddPx(P[0][1], a)} to ${ddPx(P[P.length - 1][1], a)}">
    <defs><linearGradient id="ddg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${DDC.grid}" stroke-width="1"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="${DDC.ink}" font-size="11">${ddPx(v, a)}</text>`).join('')}
    ${xt.map(i => `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === P.length - 1 ? 'end' : 'middle'}" fill="${DDC.ink}" font-size="11">${fmtT(P[i][0])}</text>`).join('')}
    ${DD.range === '1d' && c.meta?.prev_close ? `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(c.meta.prev_close)}" y2="${Y(c.meta.prev_close)}" stroke="${DDC.ink}" stroke-dasharray="2 4"/>
      <text x="${W - m.r - 2}" y="${Y(c.meta.prev_close) - 5}" text-anchor="end" fill="${DDC.ink}" font-size="10">Prev close ${ddPx(c.meta.prev_close, a)}</text>` : ''}
    <path d="${area}" fill="url(#ddg)"/>${maPaths}
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <g id="dd-x" style="display:none"><line id="dd-xl" y1="${m.t}" y2="${H - m.b}" stroke="${DDC.ink}" stroke-width="1"/><circle id="dd-xd" r="4.5" fill="${col}" stroke="#1a1d27" stroke-width="2"/></g>
    <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" id="dd-hit"/>
  </svg><div id="dd-tip" class="dd-tip"></div>`;
  leg.innerHTML = series.length ? `<span><i style="background:${col}"></i>Price</span>` + series.map(s => `<span><i class="dash" style="border-color:${s.col}"></i>${s.key}</span>`).join('') : '';
  const svg = box.querySelector('svg'), hit = box.querySelector('#dd-hit'), g = box.querySelector('#dd-x'), tip = box.querySelector('#dd-tip');
  const move = e => {
    const r = svg.getBoundingClientRect(), x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * W / r.width;
    const i = Math.max(0, Math.min(P.length - 1, Math.round((x - m.l) / (W - m.l - m.r) * (P.length - 1))));
    const v = P[i][1]; g.style.display = '';
    box.querySelector('#dd-xl').setAttribute('x1', X(i)); box.querySelector('#dd-xl').setAttribute('x2', X(i));
    box.querySelector('#dd-xd').setAttribute('cx', X(i)); box.querySelector('#dd-xd').setAttribute('cy', Y(v));
    tip.style.display = 'block';
    tip.innerHTML = `<b>${ddPx(v, a)}</b> <span class="${v >= base ? 'green' : 'red'}">${ddPct((v / base - 1) * 100)}</span><br><span class="w-dim">${fmtT(P[i][0], true)}</span>` +
      series.map(s => s.vals?.[i] != null ? `<br><span class="w-dim">${s.key}</span> ${ddPx(s.vals[i], a)}` : '').join('');
    const px = X(i) * r.width / W; tip.style.left = `${Math.min(r.width - 150, Math.max(0, px - 70))}px`;
  };
  const leave = () => { g.style.display = 'none'; tip.style.display = 'none'; };
  hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true });
  hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', () => setTimeout(leave, 1500));
}
window.addEventListener('resize', () => { if (DD.ticker) ddDrawChart(); });
