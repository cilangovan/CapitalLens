// ── OVERVIEW ──────────────────────────────────────────────────
// "5 min ago" / "3 h ago" / "2 days ago"
function ovAgo(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
// A snapshot older than 12 hours is shown with a clear warning: otherwise stale numbers look live.
const OV_STALE_HOURS = 12;
function ovStaleBanner(ageMs, ts) {
  const strip = document.getElementById('stats-strip'); if (!strip) return;
  let b = document.getElementById('stale-banner');
  if (ageMs === null || ageMs < OV_STALE_HOURS * 3600e3) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'stale-banner'; b.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:8px;border:1px solid rgba(245,158,11,.55);background:rgba(245,158,11,.12);color:var(--text);font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap'; strip.parentNode.insertBefore(b, strip); }
  const priv = typeof zkToolsOpen === 'function';
  b.innerHTML = `<span>⚠ These numbers are from <b>${ts}</b> (${ovAgo(ageMs)}), not live.</span>` +
    (priv ? `<button onclick="zkToolsOpen()" style="background:var(--accent);color:#fff;border:0;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer">Refresh now</button>` : `<span class="w-dim">The scheduled update will refresh them.</span>`);
}

// Headline numbers, defined the way Trading 212 defines them (its own account figures, stored in the snapshot as raw.account):
//   Investments = cost basis + unrealised result · Cost basis = money put into the shares you hold · Unrealised result = T212's own P&L,
//   shown as a % of cost basis · Cash = free cash · Total = whole account value. Older snapshots without raw.account fall back to the
//   previous calculation and say so (never a silent different definition).
function ovHeadline(snap) {
  snap = snap || {};
  const a = snap.raw && snap.raw.account, has = !!(a && a.invested != null && Number.isFinite(+a.invested));
  const cash = +snap.cash || 0, total = +snap.total_value || 0;
  if (has) {
    const cost = +a.invested, res = +a.ppl || 0;
    const reserved = (+a.blocked || 0) + (+a.pieCash || 0);   // cash held for pending limit orders (+ pie cash) — not "free"
    return { exact: true, total, investments: cost + res, cost, result: res, pct: cost ? res / cost * 100 : 0, cash, reserved };
  }
  const inv = +snap.invested || 0, ppl = +snap.total_ppl || (total - inv);
  return { exact: false, total, investments: inv, cost: null, result: ppl, pct: inv ? ppl / inv * 100 : 0, cash, reserved: null };
}

// Bars that show how Trading 212's figures add up: Total = Investments + Cash + Reserved; Investments = Cost basis + Unrealised result.
function ovFormulaHtml(H) {
  if (!H || !H.exact || !(H.total > 0)) return '<div class="muted" style="font-size:12px">Needs a fresh Refresh: this snapshot has no Trading 212 account breakdown, so the figures above are estimates.</div>';
  const g = n => '£' + (+n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pc = n => Math.max(0, Math.min(100, n / H.total * 100)).toFixed(2);
  const reserved = H.reserved || 0, other = Math.max(0, H.total - H.investments - H.cash - reserved);
  const seg = (n, c, l) => n > 0 ? `<span style="display:block;width:${pc(n)}%;background:${c};min-width:2px" title="${l} ${g(n)}"></span>` : '';
  const row = (c, l, v) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;padding:3px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c};margin-right:6px"></i>${l}</span><b>${g(v)}</b></div>`;
  return `<div style="display:flex;height:22px;border-radius:5px;overflow:hidden;background:var(--border,#2a3441);margin:6px 0 8px">${seg(H.investments, '#14b8a6', 'Investments')}${seg(H.cash, '#64748b', 'Cash')}${seg(reserved, '#f59e0b', 'Reserved')}${seg(other, '#a855f7', 'Other')}</div>
    ${row('#14b8a6', 'Investments', H.investments)}${row('#64748b', 'Cash (free)', H.cash)}${reserved > 0 ? row('#f59e0b', 'Reserved (pending orders / pie cash)', reserved) : ''}${other > 0.005 ? row('#a855f7', 'Other, not itemised', other) : ''}
    <div style="border-top:1px solid var(--border,#2a3441);margin:8px 0;padding-top:8px;font-size:13px">
      <div>Investments = cost basis ${g(H.cost)} ${H.result < 0 ? '−' : '+'} unrealised ${g(Math.abs(H.result))}</div>
      <div>Unrealised % = ${g(H.result)} ÷ ${g(H.cost)} = <b>${H.pct.toFixed(2)}%</b></div></div>`;
}

async function loadOverview() {
  const [snaps, , alerts] = await Promise.all([
    api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'),
    api('positions','?select=*&order=gain_pct.desc&limit=1'),
    api('alerts','?select=*&order=created_at.desc&limit=5'),
  ]);

  const snap = snaps[0] || {};
  const H = ovHeadline(snap), tv = H.total, cash = H.cash, ppl = H.result, pplPct = H.pct;
  const ts = snap.created_at ? new Date(snap.created_at).toLocaleString('en-GB') : '—';
  const ageMs = snap.created_at ? Date.now() - new Date(snap.created_at).getTime() : null;
  document.getElementById('last-updated').textContent = `Updated: ${ts}${ageMs !== null && ageMs >= 0 ? ' (' + ovAgo(ageMs) + ')' : ''}`;
  ovStaleBanner(ageMs, ts);

  const allPos = await api('positions', `?snapshot_id=eq.${snap.id}&select=gain_pct,ppl`).catch(()=>[]);
  const winners = allPos.filter(p => (p.gain_pct||0) > 0).length;
  const losers  = allPos.filter(p => (p.gain_pct||0) < 0).length;
  const alertCount = alerts.length;

  document.getElementById('stats-strip').innerHTML = `
    <div class="stat-card"><div class="label">Total Value</div><div class="value">${fmtGbp(tv)}</div><div class="sub">account incl. cash</div></div>
    <div class="stat-card"><div class="label">Investments</div><div class="value">${fmtGbp(H.investments)}</div><div class="sub">${H.exact ? 'value of your shares' : 'total − free cash (estimate)'}</div></div>
    ${H.exact ? `<div class="stat-card"><div class="label">Cost basis</div><div class="value">${fmtGbp(H.cost)}</div><div class="sub">money put into them</div></div>` : ''}
    <div class="stat-card"><div class="label">Cash</div><div class="value">${fmtGbp(cash)}</div><div class="sub">free cash</div></div>
    ${H.exact && H.reserved > 0 ? `<div class="stat-card"><div class="label">Reserved</div><div class="value">${fmtGbp(H.reserved)}</div><div class="sub">held for pending orders</div></div>` : ''}
    <div class="stat-card"><div class="label">Unrealised P&amp;L</div><div class="value ${clr(ppl)}">${fmtGbp(ppl)}</div><div class="sub ${clr(pplPct)}">${IS_GUEST ? '' : fmt(pplPct)+'%' + (H.exact ? ' of cost' : '')}</div></div>
    <div class="stat-card"><div class="label">Winners</div><div class="value green">${winners}</div></div>
    <div class="stat-card"><div class="label">Losers</div><div class="value red">${losers}</div></div>
    <div class="stat-card"><div class="label">Positions</div><div class="value">${allPos.length}</div></div>
    <div class="stat-card"><div class="label">Alerts</div><div class="value yellow">${alertCount}</div></div>
  `;

  const strip = document.getElementById('stats-strip');
  let fx = document.getElementById('ov-formula');
  if (!fx) { strip.insertAdjacentHTML('afterend', '<div class="card" id="ov-formula"><h3>How the numbers add up</h3><div id="ov-formula-body"></div></div>'); fx = document.getElementById('ov-formula'); }
  document.getElementById('ov-formula-body').innerHTML = ovFormulaHtml(H);

  const alertsHtml = alerts.length
    ? alerts.map(a => {
        const cls = (a.alert_type||a.type) === 'buy' ? 'buy' : (a.alert_type||a.type) === 'sell' ? 'sell' : '';
        return `<div class="alert-item ${cls}"><div class="a-title">${a.title||''}</div><div class="a-body">${a.body||''}</div><div class="a-time">${a.created_at ? new Date(a.created_at).toLocaleString('en-GB') : ''}</div></div>`;
      }).join('')
    : '<div class="loading">No recent alerts</div>';
  document.getElementById('active-alerts').innerHTML = alertsHtml;

  await loadOverviewCharts();
  loadSectorMap().catch(e => {
    const el = document.getElementById('sector-map');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Sector map error: ${e.message}</div>`;
  });
  loadInvestLine().catch(e => { const el = document.getElementById('ov-line-body'); if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Line chart error: ${esc(e.message)}</div>`; });
  loadCountryDecline().catch(e => { const el = document.getElementById('ov-decline-body'); if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Decline chart error: ${esc(e.message)}</div>`; });
  loadCountryMap().catch(e => {
    const el = document.getElementById('country-map');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Country map error: ${e.message}</div>`;
  });
}

// ── GAIN CHART PERIOD FILTER ──────────────────────────────────
const PERIODS = [
  { key:'1D', label:'1D', days:1 },
  { key:'1W', label:'1W', days:7 },
  { key:'1M', label:'1M', days:30 },
  { key:'3M', label:'3M', days:90 },
  { key:'1Y', label:'1Y', days:365 },
  { key:'ALL', label:'All', days:null },
];
let _gainPeriod = 'ALL';
let _allSnapshots = null;
let _latestPositions = null;
let _latestSnap = null;

async function loadOverviewCharts() {
  if (IS_GUEST) {
    document.getElementById('gain-bar').parentElement.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view holdings chart</div>';
    document.getElementById('pie-doughnut').parentElement.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view pie breakdown</div>';
    return;
  }
  _latestSnap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!_latestSnap) return;
  _latestPositions = await api('positions', `?snapshot_id=eq.${_latestSnap.id}&select=*&order=gain_pct.desc`);
  // full history (live 45 days + archive) for 3M/6M/1Y comparisons
  _allSnapshots = await api('portfolio_snapshots_all','?select=id,created_at&order=created_at.asc').catch(()=>[]);

  // set ALL active on load
  setGainPeriodStyle('ALL');
  await renderGainChart('ALL');
  renderPieChart(_latestPositions);
}

function setGainPeriodStyle(key) {
  PERIODS.forEach(p => {
    const btn = document.getElementById(`pf-${p.key}`);
    if (!btn) return;
    btn.style.background   = p.key === key ? 'var(--accent)' : 'var(--bg3)';
    btn.style.color        = p.key === key ? '#fff' : 'var(--muted)';
    btn.style.borderColor  = p.key === key ? 'var(--accent)' : 'var(--border)';
  });
}

async function setGainPeriod(key) {
  _gainPeriod = key;
  setGainPeriodStyle(key);
  await renderGainChart(key);
}

async function renderGainChart(periodKey) {
  const period = PERIODS.find(p => p.key === periodKey) || PERIODS[PERIODS.length-1];
  let labels, data, colors;

  if (!period.days) {
    // ALL-TIME
    labels = _latestPositions.map(p => p.display || p.ticker || '?');
    data   = _latestPositions.map(p => +(p.gain_pct || 0).toFixed(2));
    colors = data.map(v => v >= 0 ? 'rgba(34,197,94,.7)' : 'rgba(239,68,68,.7)');
  } else {
    const cutoff = new Date(Date.now() - period.days * 86400000);
    let baseSnap = null;
    if (_allSnapshots && _allSnapshots.length) {
      const before = _allSnapshots.filter(s => new Date(s.created_at) <= cutoff);
      const after  = _allSnapshots.filter(s => new Date(s.created_at) > cutoff && s.id !== _latestSnap.id);
      baseSnap = before.length ? before[before.length-1] : (after.length ? after[0] : null);
    }

    if (!baseSnap) {
      labels = ['No data yet for this period']; data = [0]; colors = ['transparent'];
    } else {
      const basePositions = await api('positions_all', `?snapshot_id=eq.${baseSnap.id}&select=ticker,display,current_price`).catch(()=>[]);
      const baseMap = {};
      basePositions.forEach(p => { baseMap[p.display || p.ticker] = p.current_price; });

      const computed = _latestPositions.map(p => {
        const sym = p.display || p.ticker || '?';
        const basePrice = baseMap[sym];
        const curPrice  = p.current_price;
        const pctChange = (basePrice && curPrice) ? ((curPrice - basePrice) / basePrice * 100) : null;
        return { sym, pctChange };
      }).filter(p => p.pctChange !== null).sort((a,b) => b.pctChange - a.pctChange);

      if (!computed.length) {
        labels = ['No matching data']; data = [0]; colors = ['transparent'];
      } else {
        labels = computed.map(p => p.sym);
        data   = computed.map(p => +p.pctChange.toFixed(2));
        colors = data.map(v => v >= 0 ? 'rgba(34,197,94,.7)' : 'rgba(239,68,68,.7)');
      }
    }
  }

  const ctx1 = document.getElementById('gain-bar').getContext('2d');
  if (ctx1._chart) ctx1._chart.destroy();
  ctx1._chart = new Chart(ctx1, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 3 }] },
    options: {
      plugins:{ legend:{display:false} },
      scales:{
        x:{ ticks:{color:'#8892a4',font:{size:9}}, grid:{color:'#2d3353'} },
        y:{ ticks:{color:'#8892a4', callback: v => v+'%'}, grid:{color:'#2d3353'} }
      },
      responsive:true
    }
  });
}

function renderPieChart(positions) {
  const pieMap = {};
  positions.forEach(p => {
    const pie = p.pie || 'Solo';
    pieMap[pie] = (pieMap[pie] || 0) + (p.ppl != null ? +p.ppl : 0);
  });
  const pienames = Object.keys(pieMap);
  const COLORS = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ef4444','#06b6d4','#a78bfa','#ec4899','#84cc16'];
  const ctx2 = document.getElementById('pie-doughnut').getContext('2d');
  if (ctx2._chart) ctx2._chart.destroy();
  ctx2._chart = new Chart(ctx2, {
    type: 'doughnut',
    data: { labels: pienames, datasets: [{ data: pienames.map(k => pieMap[k]), backgroundColor: COLORS }] },
    options: { plugins:{ legend:{ position:'right', labels:{ color:'#e2e8f0', font:{size:11} } } }, responsive:true }
  });
}

// ── SECTOR MAP ────────────────────────────────────────────────
async function loadSectorMap() {
  const el = document.getElementById('sector-map');
  if (!el) return;
  if (IS_GUEST) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">🔒 Sign in to view sector map</div>';
    return;
  }

  const SECTOR_COLORS = {
    'Technology':       { bg:'rgba(99,102,241,.18)',  border:'#6366f1', text:'#a5b4fc' },
    'Commodities':      { bg:'rgba(245,158,11,.15)',  border:'#f59e0b', text:'#fcd34d' },
    'Broad Market':     { bg:'rgba(34,197,94,.12)',   border:'#22c55e', text:'#86efac' },
    'Emerging Markets': { bg:'rgba(6,182,212,.13)',   border:'#06b6d4', text:'#67e8f9' },
    'Country / Regional':{ bg:'rgba(167,139,250,.13)', border:'#a78bfa', text:'#c4b5fd'},
    'Income':           { bg:'rgba(236,72,153,.12)',  border:'#ec4899', text:'#f9a8d4' },
    'Thematic / Factor':{ bg:'rgba(20,184,166,.12)',  border:'#14b8a6', text:'#5eead4' },
  };

  // Pie colours are derived from the pie name (no user pie names stored in code)
  const pieColor = name => {
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360},65%,60%)`;
  };

  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) { el.innerHTML = '<div style="color:var(--muted)">No snapshot yet</div>'; return; }
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*&order=gain_pct.desc`);

  const seen = new Set();
  const pos = positions.filter(p => { if(seen.has(p.ticker)) return false; seen.add(p.ticker); return true; });
  // Sector per instrument comes from the database (RLS: only instruments the user holds)
  const sectorOf = {};
  try { (await api('instrument_exposure', '?select=ticker,sector')).forEach(r => { sectorOf[r.ticker] = r.sector; }); } catch (e) {}

  const sectors = {};
  pos.forEach(p => {
    const sector = sectorOf[p.ticker] || 'Other';
    const pie = p.pie || 'Solo';
    if (!sectors[sector]) sectors[sector] = {};
    if (!sectors[sector][pie]) sectors[sector][pie] = [];
    sectors[sector][pie].push(p);
  });

  const SECTOR_ORDER = ['Technology','Broad Market','Thematic / Factor','Country / Regional','Emerging Markets','Income','Commodities','Other'];
  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">`;

  for (const sName of SECTOR_ORDER) {
    if (!sectors[sName]) continue;
    const sc = SECTOR_COLORS[sName] || { bg:'rgba(100,116,139,.12)', border:'#475569', text:'#94a3b8' };
    const pies = sectors[sName];
    let piecols = '';
    for (const [pieName, holdings] of Object.entries(pies)) {
      const pc = pieColor(pieName);
      const chips = holdings.map(h => {
        const gp = h.gain_pct != null ? +h.gain_pct : null;
        const gpColor = gp == null ? '#475569' : gp >= 0 ? '#22c55e' : '#ef4444';
        const gpStr = gp == null ? '' : `${gp >= 0 ? '+' : ''}${gp.toFixed(1)}%`;
        const sym = (h.display || h.ticker || '').replace(/_EQ$/, '');
        return `<div style="display:inline-flex;align-items:center;gap:5px;background:#0f1117;border:1px solid ${sc.border}44;border-radius:6px;padding:4px 8px;font-size:11px;cursor:default" title="${pieName}">
          <span style="font-weight:700;color:${sc.text}">${sym}</span>
          ${gpStr ? `<span style="font-size:10px;color:${gpColor}">${gpStr}</span>` : ''}
        </div>`;
      }).join('');
      piecols += `<div style="display:flex;flex-direction:column;gap:4px;min-width:0">
        <div style="font-size:9px;font-weight:700;color:${pc};text-transform:uppercase;letter-spacing:.06em;padding-left:2px">${pieName}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>
      </div>`;
    }
    const totalHoldings = Object.values(pies).flat().length;
    html += `<div data-sub="sector:${sName}" style="border:1px solid ${sc.border}55;border-radius:10px;background:${sc.bg};overflow:hidden">
      <div data-sub-head style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid ${sc.border}33">
        <div style="font-size:12px;font-weight:700;color:${sc.text}"><span class="sub-chev">▾</span>${sName}</div>
        <div style="font-size:10px;color:#334155">${totalHoldings} holding${totalHoldings!==1?'s':''} · ${Object.keys(pies).length} pie${Object.keys(pies).length!==1?'s':''}</div>
      </div>
      <div data-sub-body style="display:flex;flex-wrap:wrap;gap:12px;padding:10px 12px">${piecols}</div>
    </div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
}

// ── MARKET DECLINE BY COUNTRY (your holdings, price change between two saved snapshots) ──
const OV_RANGES = [['1D', 1], ['1W', 7], ['1M', 30], ['3M', 91], ['1Y', 365]];
// Pick the newest snapshot that is at least ~80% of the span old; null if saved history is too short (never fake a span).
function ovPickThen(snaps, days, nowMs) {
  const list = (snaps || []).filter(x => x && x.created_at).map(x => ({ id: x.id, t: new Date(x.created_at).getTime() })).sort((a, b) => b.t - a.t);
  if (list.length < 2) return { then: null, oldestDays: 0 };
  const latest = list[0], oldest = list[list.length - 1], oldestDays = (latest.t - oldest.t) / 864e5;
  const then = list.find(x => (latest.t - x.t) / 864e5 >= days * 0.8);
  return { then: then || null, oldestDays, latest };
}
// Per-country price change: each holding's price move, weighted by value at the start and by its country weight (ETFs are split by their
// country weights; holdings with no country data are grouped as "Unclassified", not hidden).
function ovCountryDecline(posNow, posThen, weights) {
  const then = {}; (posThen || []).forEach(p => { then[p.ticker] = p; });
  const agg = {};
  (posNow || []).forEach(p => {
    const q = then[p.ticker], pn = +p.current_price, pt = q && +q.current_price, qty = q && +q.quantity;
    if (!q || !(pn > 0) || !(pt > 0) || !(qty > 0)) return;
    const base = pt * qty, r = pn / pt - 1, w = (weights && weights[p.ticker]) || [{ country: 'Unclassified', flag: '🏳️', pct: 100 }];
    w.forEach(c => { const k = c.country, f = (+c.pct || 0) / 100; const a = agg[k] = agg[k] || { country: k, flag: c.flag || '', num: 0, den: 0 }; a.num += f * base * r; a.den += f * base; });
  });
  return Object.values(agg).filter(a => a.den > 0).map(a => ({ country: a.country, flag: a.flag, pct: a.num / a.den * 100, weight: a.den })).sort((a, b) => a.pct - b.pct);
}
function ovDeclineBars(rows) {
  if (!rows || !rows.length) return '<div style="color:var(--muted);font-size:13px">No holdings with a price at both dates.</div>';
  const mx = Math.max(0.01, ...rows.map(r => Math.abs(r.pct)));
  return rows.map(r => { const w = Math.max(2, Math.round(Math.abs(r.pct) / mx * 46)), neg = r.pct < 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:13px"><span style="width:118px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.flag)} ${esc(r.country)}</span>`
      + `<span style="flex:1;display:flex;align-items:center;height:18px"><span style="width:50%;display:flex;justify-content:flex-end">${neg ? `<span style="width:${w * 2}%;height:14px;background:var(--red,#f87171);border-radius:3px 0 0 3px"></span>` : ''}</span>`
      + `<span style="width:50%">${neg ? '' : `<span style="display:block;width:${w * 2}%;height:14px;background:var(--green,#4ade80);border-radius:0 3px 3px 0"></span>`}</span></span>`
      + `<b style="width:62px;flex:none;text-align:right;color:${neg ? 'var(--red,#f87171)' : 'var(--green,#4ade80)'}">${r.pct > 0 ? '+' : ''}${r.pct.toFixed(2)}%</b></div>`; }).join('');
}
// ── INVESTMENTS VALUE LINE (Trading 212 definition: cost basis + unrealised result, from each snapshot's account data) ──
// Snapshots saved before the account data was kept are left out (a different definition would bend the line); the card says how many points it has.
function ovLinePoints(snaps, days, nowMs) {
  const pts = (snaps || []).map(x => { const a = x && x.raw && x.raw.account, t = new Date(x && x.created_at).getTime();
    return (a && a.invested != null && Number.isFinite(+a.invested) && Number.isFinite(t)) ? { t, v: +a.invested + (+a.ppl || 0) } : null; }).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!pts.length) return { points: [], n: 0 };
  const end = pts[pts.length - 1].t, cut = end - days * 864e5, inRange = pts.filter(p => p.t >= cut);
  if (inRange.length < 2) return { points: inRange, n: inRange.length, spanDays: 0, available: (end - pts[0].t) / 864e5 };
  const a = inRange[0], b = inRange[inRange.length - 1];
  return { points: inRange, n: inRange.length, spanDays: (b.t - a.t) / 864e5, change: b.v - a.v, pct: a.v ? (b.v - a.v) / a.v * 100 : 0, from: a, to: b, available: (end - pts[0].t) / 864e5 };
}
function ovLineSvg(points) {
  if (!points || points.length < 2) return '';
  const W = 340, H = 110, P = 6, t0 = points[0].t, t1 = points[points.length - 1].t, vs = points.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.1 || 1;
  const x = p => P + (t1 === t0 ? 0 : (p.t - t0) / (t1 - t0)) * (W - 2 * P), y = p => H - P - (p.v - (lo - pad)) / (hi - lo + 2 * pad) * (H - 2 * P);
  const up = points[points.length - 1].v >= points[0].v;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Investments value over time"><polyline fill="none" stroke="${up ? '#4ade80' : '#f87171'}" stroke-width="2" stroke-linejoin="round" points="${points.map(p => x(p).toFixed(1) + ',' + y(p).toFixed(1)).join(' ')}"/></svg>`;
}

async function loadCountryDecline(range) {
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) return;
  let card = document.getElementById('ov-decline');
  if (!card) {
    const anchor = document.getElementById('ov-formula') || document.getElementById('stats-strip'); if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', '<div class="card" id="ov-decline"><h3>Market decline by country</h3><div id="ov-decline-btns" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0"></div><div id="ov-decline-body"><div class="loading busy">Loading…</div></div><div class="muted" style="font-size:11px;margin-top:6px">Your holdings by country, price change between saved snapshots (not index data). Funds are split by their country weights; holdings with no country data are grouped as Unclassified.</div></div>');
    card = document.getElementById('ov-decline');
    document.getElementById('ov-decline-btns').addEventListener('click', e => { const b = e.target.closest('[data-ovr]'); if (b) loadCountryDecline(b.dataset.ovr).catch(() => {}); });
  }
  range = range || '1W'; const days = (OV_RANGES.find(r => r[0] === range) || OV_RANGES[1])[1];
  document.getElementById('ov-decline-btns').innerHTML = OV_RANGES.map(([k]) => `<button type="button" data-ovr="${k}" style="min-height:40px;min-width:48px;border-radius:8px;border:1px solid var(--border,#2d3353);background:${k === range ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${k}</button>`).join('');
  const body = document.getElementById('ov-decline-body');
  const snaps = await api('portfolio_snapshots', '?select=id,created_at&order=created_at.desc&limit=400');
  const pick = ovPickThen(snaps, days, Date.now());
  if (!pick.then) { body.innerHTML = `<div style="color:var(--muted);font-size:13px">Not enough saved history for ${esc(range)} yet: the oldest snapshot is ${pick.oldestDays.toFixed(1)} days older than the latest. Pick a shorter span.</div>`; return; }
  const [posNow, posThen] = await Promise.all([api('positions', `?snapshot_id=eq.${pick.latest.id}&select=ticker,current_price,quantity`), api('positions', `?snapshot_id=eq.${pick.then.id}&select=ticker,current_price,quantity`)]);
  const weights = {}; try { (await api('instrument_country_weights', '?select=ticker,country,flag,pct')).forEach(r => { (weights[r.ticker] = weights[r.ticker] || []).push(r); }); } catch (e) {}
  const span = (pick.latest.t - pick.then.t) / 864e5;
  body.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px">Latest vs ${span.toFixed(1)} days earlier (${esc(new Date(pick.then.t).toLocaleDateString('en-GB'))})</div>` + ovDeclineBars(ovCountryDecline(posNow, posThen, weights));
}

async function loadInvestLine(range) {
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) return;
  let card = document.getElementById('ov-line');
  if (!card) {
    const anchor = document.getElementById('stats-strip'); if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', '<div class="card" id="ov-line"><h3>Investments value over time</h3><div id="ov-line-btns" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0"></div><div id="ov-line-body"><div class="loading busy">Loading…</div></div><div class="muted" style="font-size:11px;margin-top:6px">Investments value as Trading 212 defines it (cost basis + unrealised result), from your saved snapshots. It moves when you buy or sell, so a rise is not always performance.</div></div>');
    document.getElementById('ov-line-btns').addEventListener('click', e => { const b = e.target.closest('[data-ovl]'); if (b) loadInvestLine(b.dataset.ovl).catch(() => {}); });
  }
  range = range || '1W'; const days = (OV_RANGES.find(r => r[0] === range) || OV_RANGES[1])[1];
  document.getElementById('ov-line-btns').innerHTML = OV_RANGES.map(([k]) => `<button type="button" data-ovl="${k}" style="min-height:40px;min-width:48px;border-radius:8px;border:1px solid var(--border,#2d3353);background:${k === range ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${k}</button>`).join('');
  const snaps = await api('portfolio_snapshots', '?select=created_at,raw&order=created_at.desc&limit=400');
  const L = ovLinePoints(snaps, days, Date.now()), body = document.getElementById('ov-line-body');
  if (L.n < 2) { body.innerHTML = `<div style="color:var(--muted);font-size:13px">Not enough saved points for ${esc(range)} yet (${L.n} with Trading 212 account data${L.available ? `, covering ${L.available.toFixed(1)} days` : ''}). Press Refresh on different days to build the line.</div>`; return; }
  const g = x => '£' + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), up = L.change >= 0;
  body.innerHTML = `<div style="font-size:20px;font-weight:700">${g(L.to.v)}</div><div style="font-size:13px;color:${up ? 'var(--green,#4ade80)' : 'var(--red,#f87171)'}">${up ? '+' : '−'}${g(L.change)} (${up ? '+' : ''}${L.pct.toFixed(2)}%) over ${L.spanDays.toFixed(1)} days · ${L.n} saved points</div>${ovLineSvg(L.points)}`
    + `<div class="muted" style="font-size:11px">${esc(new Date(L.from.t).toLocaleString('en-GB'))} → ${esc(new Date(L.to.t).toLocaleString('en-GB'))}</div>`;
}

// ── COUNTRY MAP ───────────────────────────────────────────────
async function loadCountryMap() {
  const el = document.getElementById('country-map');
  if (!el) return;
  if (IS_GUEST) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">🔒 Sign in to view country map</div>';
    return;
  }

  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) { el.innerHTML = '<div style="color:var(--muted)">No snapshot yet</div>'; return; }
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*&order=gain_pct.desc`);
  const exposure = {};
  try { (await api('instrument_exposure', '?select=ticker,display_name')).forEach(r => { exposure[r.ticker] = r.display_name; }); } catch (e) {}
  // Country weights come from the database (RLS: only instruments the user holds)
  const weights = {};
  try { (await api('instrument_country_weights', '?select=ticker,country,flag,pct,note&order=pct.desc')).forEach(r => { (weights[r.ticker] = weights[r.ticker] || []).push(r); }); } catch (e) {}

  const posMap = {};
  positions.forEach(p => { posMap[p.ticker] = p; });

  const countryAgg = {};
  for (const [fullTicker, rows] of Object.entries(weights)) {
    const pos = posMap[fullTicker];
    if (!pos) continue;
    const etfTicker = pos.display || fullTicker;
    const gainPct = pos.gain_pct != null ? +pos.gain_pct : null;
    for (const c of rows) {
      c.name = c.country; c.pct = +c.pct;
      if (!countryAgg[c.name]) countryAgg[c.name] = { flag:c.flag, etfs:[], gainSum:0, gainCount:0 };
      countryAgg[c.name].etfs.push({ ticker:etfTicker, full:fullTicker, label:exposure[fullTicker] || etfTicker, pct:c.pct, note:c.note, gain:gainPct });
      if (gainPct != null) {
        countryAgg[c.name].gainSum += gainPct * (c.pct / 100);
        countryAgg[c.name].gainCount++;
      }
    }
  }

  const sorted = Object.entries(countryAgg).sort(([,a],[,b]) => {
    const ag = a.gainCount ? a.gainSum / a.gainCount : -999;
    const bg = b.gainCount ? b.gainSum / b.gainCount : -999;
    return bg - ag;
  });

  if (!sorted.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No matching ETFs in portfolio</div>'; return; }

  const perfColor = g => g >= 10 ? '#22c55e' : g >= 3 ? '#86efac' : g >= 0 ? '#a3e635' : g >= -5 ? '#f97316' : '#ef4444';
  const perfBg    = g => g >= 10 ? 'rgba(34,197,94,.15)' : g >= 3 ? 'rgba(34,197,94,.08)' : g >= 0 ? 'rgba(163,230,53,.07)' : g >= -5 ? 'rgba(249,115,22,.1)' : 'rgba(239,68,68,.12)';
  const perfLabel = g => g >= 10 ? 'Strong ▲' : g >= 3 ? 'Positive ▲' : g >= 0 ? 'Flat →' : g >= -5 ? 'Weak ▼' : 'Down ▼';

  let html = `<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">`;
  for (const [country, data] of sorted) {
    const avgGain = data.gainCount ? data.gainSum / data.gainCount : null;
    const pc = avgGain != null ? perfColor(avgGain) : '#475569';
    const bg = avgGain != null ? perfBg(avgGain) : 'rgba(71,85,105,.1)';
    const lbl = avgGain != null ? perfLabel(avgGain) : '—';
    const gainStr = avgGain != null ? `${avgGain >= 0 ? '+' : ''}${avgGain.toFixed(1)}%` : '';

    const etfChips = data.etfs.map(e => {
      const gc = e.gain != null ? perfColor(e.gain) : '#475569';
      const gs = e.gain != null ? `${e.gain >= 0 ? '+' : ''}${e.gain.toFixed(1)}%` : '';
      return `<div style="display:inline-flex;align-items:center;gap:4px;background:#0f1117;border:1px solid ${pc}33;border-radius:5px;padding:3px 7px;font-size:10px" title="${e.label} — ${e.note}">
        <span style="color:#a5b4fc;font-weight:700">${e.ticker}</span>
        <span style="color:#334155">${e.pct < 100 ? e.pct+'%' : ''}</span>
        ${gs ? `<span style="color:${gc}">${gs}</span>` : ''}
      </div>`;
    }).join('');

    html += `<div data-sub="country:${country}" style="border:1px solid ${pc}44;border-radius:9px;background:${bg};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px">
        <div style="font-size:22px;line-height:1">${data.flag}</div>
        <div style="flex:1">
          <div data-sub-head style="font-size:13px;font-weight:700;color:#e2e8f0"><span class="sub-chev">▾</span>${country}</div>
          <div data-sub-body style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${etfChips}</div>
        </div>
        <div style="text-align:right;min-width:70px">
          <div style="font-size:14px;font-weight:800;color:${pc}">${gainStr}</div>
          <div style="font-size:9px;color:${pc};opacity:.7">${lbl}</div>
        </div>
      </div>
    </div>`;
  }
  html += `</div>`;
  el.innerHTML = html;
}
