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
    api('portfolio_snapshots','?select=*&order=created_at.desc&limit=48'),
    api('positions','?select=*&order=gain_pct.desc&limit=1'),
    api('alerts','?select=*&order=created_at.desc&limit=5'),
  ]);

  const snap = snaps[0] || {};
  const H = ovHeadline(snap), tv = H.total, cash = H.cash, ppl = H.result, pplPct = H.pct;
  const ts = snap.created_at ? new Date(snap.created_at).toLocaleString('en-GB') : '—';
  const ageMs = snap.created_at ? Date.now() - new Date(snap.created_at).getTime() : null;
  document.getElementById('last-updated').textContent = `Updated: ${ts}${ageMs !== null && ageMs >= 0 ? ' (' + ovAgo(ageMs) + ')' : ''}`;
  ovStaleBanner(ageMs, ts);

  // Last 24H: find the snapshot closest to 24h ago and compare total_value.
  // Uses the same definition as Trading 212: full account value change (shares + cash).
  // Deposits/withdrawals in that window skew the number just like T212's own figure.
  const ov24h = (() => {
    if (snaps.length < 2 || !snap.created_at) return null;
    const nowMs = new Date(snap.created_at).getTime();
    const target = nowMs - 24 * 3600e3;
    // pick the snapshot closest to 24h ago (but no newer than snap)
    let best = null, bestDiff = Infinity;
    for (let i = 1; i < snaps.length; i++) {
      const t = new Date(snaps[i].created_at).getTime();
      const diff = Math.abs(t - target);
      if (diff < bestDiff) { bestDiff = diff; best = snaps[i]; }
    }
    if (!best || bestDiff > 36 * 3600e3) return null;   // nothing within 36h of the target
    const cur = +snap.total_value || 0, prev = +best.total_value || 0;
    if (!cur || !prev) return null;
    const change = cur - prev, pct = prev ? change / prev * 100 : 0;
    const ageH = (nowMs - new Date(best.created_at).getTime()) / 3600e3;
    return { change, pct, ageH };
  })();

  const allPos = await api('positions', `?snapshot_id=eq.${snap.id}&select=gain_pct,ppl`).catch(()=>[]);
  const winners = allPos.filter(p => (p.gain_pct||0) > 0).length;
  const losers  = allPos.filter(p => (p.gain_pct||0) < 0).length;
  const alertCount = alerts.length;

  const last24Card = ov24h
    ? `<div class="stat-card"><div class="label">Last ${ov24h.ageH < 25 ? '24H' : Math.round(ov24h.ageH) + 'H'}</div><div class="value ${clr(ov24h.change)}">${fmtGbp(ov24h.change)}</div><div class="sub ${clr(ov24h.pct)}">${ov24h.pct >= 0 ? '+' : ''}${ov24h.pct.toFixed(2)}%</div></div>`
    : '';

  document.getElementById('stats-strip').innerHTML = `
    <div class="stat-card"><div class="label">Total Value</div><div class="value">${fmtGbp(tv)}</div><div class="sub">account incl. cash</div></div>
    ${last24Card}
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

  // Alert list lives only on the Alerts dashboard; Overview keeps just the count tile.

  await loadOverviewCharts();
  loadMarketMood().catch(e => { const el = document.getElementById('mood-body'); if (el) el.innerHTML = '<div style="color:var(--red);font-size:12px">Mood error: ' + esc(e.message) + '</div>'; });
  loadSectorMap().catch(e => {
    const el = document.getElementById('sector-map');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Sector map error: ${esc(e.message)}</div>`;
  });
  loadInvestLine().catch(e => { const el = document.getElementById('ov-line-body'); if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Line chart error: ${esc(e.message)}</div>`; });
  loadMarketsHeld().catch(e => { const el = document.getElementById('ov-markets-body'); if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Markets error: ${esc(e.message)}</div>`; });
  loadCountryDecline().catch(e => { const el = document.getElementById('ov-decline-body'); if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Decline chart error: ${esc(e.message)}</div>`; });
  loadCountryMap().catch(e => {
    const el = document.getElementById('country-map');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:12px">Country map error: ${esc(e.message)}</div>`;
  });
}

// ── GAIN CHART PERIOD FILTER ──────────────────────────────────
const PERIODS = [
  { key:'1D', label:'1D', days:1 },
  { key:'1W', label:'1W', days:7 },
  { key:'1M', label:'1M', days:30 },
  { key:'3M', label:'3M', days:90 },
  { key:'6M', label:'6M', days:182 },
  { key:'9M', label:'9M', days:273 },
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
        x:{ ticks:{color:clv('--muted'),font:{size:9}}, grid:{color:clv('--border')} },
        y:{ ticks:{color:clv('--muted'), callback: v => v+'%'}, grid:{color:clv('--border')} }
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
    options: { plugins:{ legend:{ position:'right', labels:{ color:clv('--text'), font:{size:11} } } }, responsive:true }
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
        return `<div style="display:inline-flex;align-items:center;gap:5px;background:var(--bg);border:1px solid ${sc.border}44;border-radius:6px;padding:4px 8px;font-size:11px;cursor:default" title="${pieName}">
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

// ── MARKET DECLINE BY COUNTRY (your holdings, price change between two saved snapshots) ── (your holdings, price change between two saved snapshots) ──
const OV_RANGES = [['1D', 1], ['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['9M', 273], ['1Y', 365]]; // every graph offers the same spans
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
const OV_NOT_COUNTRY = new Set(['Silver', 'Gold', 'Other', 'Unclassified']);
function ovSplitDecline(rows) { return { countries: (rows || []).filter(r => !OV_NOT_COUNTRY.has(r.country)), other: (rows || []).filter(r => OV_NOT_COUNTRY.has(r.country)) }; }
function ovDeclineSections(rows) { const x = ovSplitDecline(rows); return ovDeclineBars(x.countries) + (x.other.length ? '<div class="muted" style="font-size:12px;margin:10px 0 2px">Not countries (commodities, other, unclassified)</div>' + ovDeclineBars(x.other) : ''); }
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
    return (a && a.invested != null && Number.isFinite(+a.invested) && Number.isFinite(t)) ? { t, v: +a.invested + (+a.ppl || 0), inv: +a.invested } : null; }).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!pts.length) return { points: [], n: 0 };
  const end = pts[pts.length - 1].t, cut = end - days * 864e5, inRange = pts.filter(p => p.t >= cut);
  if (inRange.length < 2) return { points: inRange, n: inRange.length, spanDays: 0, available: (end - pts[0].t) / 864e5 };
  const a = inRange[0], b = inRange[inRange.length - 1];
  return { points: inRange, n: inRange.length, spanDays: (b.t - a.t) / 864e5, change: b.v - a.v, pct: a.v ? (b.v - a.v) / a.v * 100 : 0, from: a, to: b, available: (end - pts[0].t) / 864e5,
    flow: a.inv != null && b.inv != null ? b.inv - a.inv : null }; // flow = change in cost basis (money added by buys / removed by sells); change - flow = change in the unrealised result
}
// Geometry for the line (pure, tested). Rules that keep a small move from looking like a crash:
//  - the vertical range is never tighter than 2% of the value (a £45 wobble on £4,800 stays a wobble) and has labelled min / mid / max lines;
//  - a gap with no snapshots (overnight, app closed) is drawn dashed, never as a steep solid slope;
//  - a jump in cost basis (a buy or sell) is marked, because it moves the line without being performance.
const OV_LN = { W: 340, H: 150, L: 52, R: 8, T: 10, B: 20 };
function ovLineLayout(points) {
  if (!points || points.length < 2) return null;
  const { W, H, L, R, T, B } = OV_LN, t0 = points[0].t, t1 = points[points.length - 1].t, vs = points.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs); const minSpan = Math.max(1, Math.abs(hi) * 0.02);
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = t => L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const dts = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b), med = dts[Math.floor(dts.length / 2)] || 0, gapMs = Math.max(2 * 36e5, 4 * med);
  const segs = [[]], gaps = []; points.forEach((p, i) => { if (i && p.t - points[i - 1].t > gapMs) { gaps.push([i - 1, i]); segs.push([]); } segs[segs.length - 1].push(i); });
  const marks = []; points.forEach((p, i) => { if (!i || p.inv == null || points[i - 1].inv == null) return; const d = p.inv - points[i - 1].inv; if (Math.abs(d) >= Math.max(5, Math.abs(points[i - 1].inv) * 0.002)) marks.push({ i, d }); });
  return { W, H, L, R, T, B, t0, t1, lo, hi, x, y, xs: points.map(p => x(p.t)), segs, gaps, marks, gapMs };
}
function ovLineSvg(points, lay) {
  lay = lay || ovLineLayout(points); if (!lay) return '';
  const { W, H, L, R, T, B, x, y, lo, hi } = lay, up = points[points.length - 1].v >= points[0].v, col = up ? '#4ade80' : '#f87171', P = i => x(points[i].t).toFixed(1) + ',' + y(points[i].v).toFixed(1);
  const money = v => '£' + Math.round(v).toLocaleString('en-GB'), span = lay.t1 - lay.t0, dayFmt = t => span <= 1.2 * 864e5 ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : span <= 4 * 864e5 ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const grid = [hi, (hi + lo) / 2, lo].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--border)" stroke-width="1"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#9aa0c3">${money(v)}</text>`).join('');
  const xl = `<text x="${L}" y="${H - 5}" font-size="10" fill="#9aa0c3">${esc(dayFmt(lay.t0))}</text><text x="${W - R}" y="${H - 5}" text-anchor="end" font-size="10" fill="#9aa0c3">${esc(dayFmt(lay.t1))}</text>`;
  const lines = lay.segs.map(s => s.length > 1 ? `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${s.map(P).join(' ')}"/>` : '').join('');
  const dashed = lay.gaps.map(([a, b]) => `<line x1="${x(points[a].t).toFixed(1)}" y1="${y(points[a].v).toFixed(1)}" x2="${x(points[b].t).toFixed(1)}" y2="${y(points[b].v).toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.55"/>`).join('');
  const dots = points.map((p, i) => points.length <= 80 || i === points.length - 1 || lay.segs.some(s => s.length === 1 && s[0] === i) ? `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${i === points.length - 1 ? 3.5 : 2}" fill="${col}"/>` : '').join('');
  const marks = lay.marks.map(m => { const px = x(points[m.i].t).toFixed(1), by = H - B; return `<line x1="${px}" x2="${px}" y1="${T}" y2="${by}" stroke="#c98500" stroke-width="1" stroke-dasharray="1 3" opacity="0.8"/><polygon points="${m.d > 0 ? `${px},${by - 7} ${(+px - 4).toFixed(1)},${by} ${(+px + 4).toFixed(1)},${by}` : `${px},${by} ${(+px - 4).toFixed(1)},${by - 7} ${(+px + 4).toFixed(1)},${by - 7}`}" fill="#c98500"/>`; }).join('');
  return `<svg id="ov-ln-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Investments value over time" style="touch-action:pan-y">${grid}${xl}${marks}${dashed}${lines}${dots}`
    + `<line id="ov-ln-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#9aa0c3" stroke-width="1" visibility="hidden"/><circle id="ov-ln-pick" r="5" fill="${col}" stroke="#1a1d2e" stroke-width="2" visibility="hidden"/></svg>`;
}

// ── LONGER SPANS FROM REBUILT HISTORY ──
// Saved snapshots only exist for days the app was refreshed. For longer spans we fall back to pie_history (holdings rebuilt from your Trading 212
// order history, valued at daily closes). Always labelled "rebuilt"; it uses the holdings you owned on each day, so buying/selling is in the value.
function ovHistLine(row, days, nowMs) {
  const s = row && row.series; if (!s || !s.dates || !s.value) return { points: [], n: 0 };
  const all = s.dates.map((d, i) => ({ t: Date.parse(d + 'T16:30:00Z'), v: s.value[i] })).filter(p => Number.isFinite(p.t) && p.v != null && p.v > 0);
  const pts = all.filter(p => p.t >= nowMs - days * 864e5 && p.t <= nowMs);
  if (pts.length < 2) return { points: pts, n: pts.length, available: all.length > 1 ? (all[all.length - 1].t - all[0].t) / 864e5 : 0 };
  const a = pts[0], b = pts[pts.length - 1];
  return { points: pts, n: pts.length, spanDays: (b.t - a.t) / 864e5, change: b.v - a.v, pct: (b.v - a.v) / a.v * 100, from: a, to: b, available: (all[all.length - 1].t - all[0].t) / 864e5 };
}
// rows: pie_history rows (pies + __DIRECT__ carry per-ticker qty and value). price = value / qty, in GBP.
function ovHistPositions(rows, days, nowMs) {
  const byT = {};
  (rows || []).forEach(r => { if (!r || r.pie === '__ALL__' || r.pie === '__SOLD__' || !r.series || !r.series.tickers) return;
    const d = r.series.dates || []; Object.entries(r.series.tickers).forEach(([t, x]) => { const m = byT[t] = byT[t] || {};
      d.forEach((dt, i) => { const q = +(x.qty || [])[i], v = +(x.value || [])[i]; if (q > 0 && v > 0) { const e = m[dt] = m[dt] || { q: 0, v: 0 }; e.q += q; e.v += v; } }); }); });
  const dates = [...new Set(Object.values(byT).flatMap(m => Object.keys(m)))].sort();
  if (dates.length < 2) return { posNow: [], posThen: [], availableDays: 0 };
  const tms = d => Date.parse(d + 'T16:30:00Z'), nowD = dates.filter(d => tms(d) <= nowMs).pop() || dates[dates.length - 1];
  const availableDays = (tms(nowD) - tms(dates[0])) / 864e5, cut = tms(nowD) - days * 864e5;
  const thenD = dates.filter(d => tms(d) <= cut).pop() || (availableDays >= days * 0.8 ? dates[0] : null);
  if (!thenD) return { posNow: [], posThen: [], availableDays };
  const posNow = [], posThen = [];
  Object.entries(byT).forEach(([t, m]) => { const n = m[nowD], th = m[thenD]; if (n && th) { posNow.push({ ticker: t, current_price: n.v / n.q, quantity: n.q }); posThen.push({ ticker: t, current_price: th.v / th.q, quantity: th.q }); } });
  return { posNow, posThen, nowD, thenD, availableDays, spanDays: (tms(nowD) - tms(thenD)) / 864e5 };
}

// ── MARKETS I HOLD (index moves) ──
// Public benchmark indices (Yahoo symbols), one or two per country. Which ones are marked "you hold" comes from your holdings' country weights
// in the database; Nifty, Sensex and FTSE 100 are always shown. Moves are the index's own price change (not your holdings).
const OV_MARKETS = [
  { c: 'India', flag: '🇮🇳', name: 'Nifty 50', sym: '^NSEI', always: 1 }, { c: 'India', flag: '🇮🇳', name: 'Sensex', sym: '^BSESN', always: 1 },
  { c: 'UK', flag: '🇬🇧', name: 'FTSE 100', sym: '^FTSE', always: 1 }, { c: 'USA', flag: '🇺🇸', name: 'S&P 500', sym: '^GSPC' }, { c: 'USA', flag: '🇺🇸', name: 'Nasdaq 100', sym: '^NDX' },
  { c: 'Germany', flag: '🇩🇪', name: 'DAX', sym: '^GDAXI' }, { c: 'Japan', flag: '🇯🇵', name: 'Nikkei 225', sym: '^N225' }, { c: 'China', flag: '🇨🇳', name: 'SSE Composite', sym: '000001.SS' },
  { c: 'Taiwan', flag: '🇹🇼', name: 'TAIEX', sym: '^TWII' }, { c: 'Italy', flag: '🇮🇹', name: 'FTSE MIB', sym: 'FTSEMIB.MI' }, { c: 'Spain', flag: '🇪🇸', name: 'IBEX 35', sym: '^IBEX' },
  { c: 'Netherlands', flag: '🇳🇱', name: 'AEX', sym: '^AEX' }, { c: 'Poland', flag: '🇵🇱', name: 'WIG20', sym: 'WIG20.WA' }];
// points: [[unixSeconds, close], …] daily. 1D = last close vs the one before; longer spans = last close vs the close at-or-before that many days earlier
// (null when the data does not reach back that far); fromHigh = last vs the highest close in the data (drawdown).
function ovIndexMoves(points, nowMs) {
  const pts = (points || []).filter(p => p && Number.isFinite(+p[0]) && +p[1] > 0).map(p => [+p[0] * 1000, +p[1]]).filter(p => p[0] <= nowMs + 864e5).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1], at = d => { const cut = last[0] - d * 864e5; const c = pts.filter(p => p[0] <= cut).pop(); return c && (last[0] - c[0]) / 864e5 <= d + 6 ? c : null; };
  const mv = d => { const c = at(d); return c ? (last[1] / c[1] - 1) * 100 : null; };
  return { last: last[1], d1: (last[1] / pts[pts.length - 2][1] - 1) * 100, w1: mv(7), m1: mv(30), m3: mv(91), y1: mv(365), fromHigh: (last[1] / Math.max(...pts.map(p => p[1])) - 1) * 100, asOf: last[0] };
}
function ovMarketRows(rows) {
  const f = v => v == null ? '<span style="color:var(--muted)">–</span>' : `<span style="color:${v < 0 ? 'var(--red,#f87171)' : 'var(--green,#4ade80)'}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
  return rows.map(r => `<div style="padding:8px 0;border-top:1px solid var(--border)"><div style="display:flex;justify-content:space-between;gap:8px;font-size:14px"><span>${esc(r.flag)} <b>${esc(r.name)}</b>${r.held ? ' <span style="font-size:11px;color:var(--muted)">● you hold</span>' : ''}</span>`
    + (r.m ? `<span>${Number(r.m.last).toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>` : '<span style="color:var(--muted)">no data</span>') + '</div>'
    + (r.m ? `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;margin-top:3px">${[['1D', r.m.d1], ['1W', r.m.w1], ['1M', r.m.m1], ['3M', r.m.m3], ['1Y', r.m.y1]].map(([k, v]) => `<span><span style="color:var(--muted)">${k}</span> ${f(v)}</span>`).join('')}<span><span style="color:var(--muted)">from 1Y high</span> ${f(r.m.fromHigh)}</span></div>` : '') + '</div>').join('');
}
// Trend views for the index card. Series colours: the reference categorical palette (dark steps), one fixed slot per selected index; at most 4 lines at once.
const OV_MK_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const OV_MK_RANGES = OV_RANGES;
// % change since the start of the range for each day (start = close at or before the cut, else the first close).
function ovRebase(points, days, nowMs) {
  const pts = (points || []).filter(p => p && Number.isFinite(+p[0]) && +p[1] > 0).map(p => ({ t: +p[0] * 1000, v: +p[1] })).filter(p => p.t <= nowMs + 864e5).sort((a, b) => a.t - b.t);
  if (pts.length < 2) return [];
  const cut = pts[pts.length - 1].t - days * 864e5, k = Math.max(0, pts.findIndex(p => p.t > cut) - 1), base = pts[k].v;
  return pts.slice(k).map(p => ({ t: p.t, pct: (p.v / base - 1) * 100 }));
}
// Week-by-week % change (daily=true: day-by-day, for short spans): last close of each calendar week (Mon-Sun, UTC) vs the last close of the week before; only weeks inside the range.
function ovWeeklyChanges(points, days, nowMs, daily) {
  const pts = (points || []).filter(p => p && Number.isFinite(+p[0]) && +p[1] > 0).map(p => ({ t: +p[0] * 1000, v: +p[1] })).filter(p => p.t <= nowMs + 864e5).sort((a, b) => a.t - b.t);
  const wk = t => { const d = new Date(t), n = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5; return daily ? n : Math.floor((n + 3) / 7); };
  const lastOf = new Map(); pts.forEach(p => lastOf.set(wk(p.t), p));
  const keys = [...lastOf.keys()].sort((a, b) => a - b), out = [], cut = (pts.length ? pts[pts.length - 1].t : 0) - days * 864e5;
  for (let i = 1; i < keys.length; i++) { const a = lastOf.get(keys[i - 1]), b = lastOf.get(keys[i]); if (b.t > cut) out.push({ t: b.t, pct: (b.v / a.v - 1) * 100 }); }
  return out;
}
// Today's intraday line for the 1D span: % vs the previous close (falls back to the first point of the session).
function ovIntradayPct(d) {
  const P = ((d && d.points) || []).filter(p => p && Number.isFinite(+p[0]) && +p[1] > 0); if (P.length < 2) return [];
  const base = d.meta && +d.meta.prev_close > 0 ? +d.meta.prev_close : +P[0][1]; return P.map(p => ({ t: +p[0] * 1000, pct: (+p[1] / base - 1) * 100 }));
}
function ovWeeklyStats(weeks) {
  if (!weeks || !weeks.length) return null;
  const down = weeks.filter(w => w.pct < 0).length, worst = weeks.reduce((m, w) => w.pct < m.pct ? w : m), best = weeks.reduce((m, w) => w.pct > m.pct ? w : m);
  let run = 0, streak = 0; weeks.forEach(w => { run = w.pct < 0 ? run + 1 : 0; streak = Math.max(streak, run); });
  return { n: weeks.length, down, worst, best, streak, avg: weeks.reduce((a, w) => a + w.pct, 0) / weeks.length };
}
const OV_SVG_W = 340, OV_SVG_H = 170, OV_PAD = { l: 38, r: 8, t: 8, b: 16 };
function ovAxis(lo, hi) {
  const y = v => OV_PAD.t + (hi - v) / (hi - lo || 1) * (OV_SVG_H - OV_PAD.t - OV_PAD.b), zero = lo < 0 && hi > 0, ticks = [lo, hi].filter(v => !zero || Math.abs(y(v) - y(0)) > 16);
  if (zero) ticks.push(0);
  return { y, grid: ticks.map(v => `<line x1="${OV_PAD.l}" x2="${OV_SVG_W - OV_PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${v === 0 ? '#6b7194' : 'var(--border)'}" stroke-width="1"/><text x="${OV_PAD.l - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#9aa0c3">${v > 0 ? '+' : ''}${v.toFixed(Math.abs(hi - lo) < 5 ? 1 : 0)}%</text>`).join('') };
}
function ovTrendSvg(series) {
  const all = series.flatMap(x => x.pts); if (all.length < 2) return '';
  const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t)), lo = Math.min(0, ...all.map(p => p.pct)), hi = Math.max(0, ...all.map(p => p.pct)), pad = (hi - lo) * 0.08 || 1, ax = ovAxis(lo - pad, hi + pad);
  const x = t => OV_PAD.l + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (OV_SVG_W - OV_PAD.l - OV_PAD.r);
  return { t0, t1, svg: `<svg id="ov-mk-svg" viewBox="0 0 ${OV_SVG_W} ${OV_SVG_H}" width="100%" height="${OV_SVG_H}" role="img" aria-label="Index change since the start of the range" style="touch-action:pan-y">${ax.grid}`
    + series.map(sr => `<polyline fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${sr.pts.map(p => x(p.t).toFixed(1) + ',' + ax.y(p.pct).toFixed(1)).join(' ')}"/>`).join('')
    + series.map(sr => { const e = sr.pts[sr.pts.length - 1]; return `<circle cx="${x(e.t).toFixed(1)}" cy="${ax.y(e.pct).toFixed(1)}" r="4" fill="${sr.color}" stroke="#1a1d2e" stroke-width="2"/>`; }).join('')
    + `<line id="ov-mk-cross" x1="0" x2="0" y1="${OV_PAD.t}" y2="${OV_SVG_H - OV_PAD.b}" stroke="#9aa0c3" stroke-width="1" visibility="hidden"/></svg>`, geom: { x0: OV_PAD.l, x1: OV_SVG_W - OV_PAD.r, W: OV_SVG_W } };
}
function ovBarsSvg(weeks) {
  if (!weeks || !weeks.length) return '';
  const lo = Math.min(0, ...weeks.map(w => w.pct)), hi = Math.max(0, ...weeks.map(w => w.pct)), pad = (hi - lo) * 0.08 || 1, ax = ovAxis(lo - pad, hi + pad), n = weeks.length, w = (OV_SVG_W - OV_PAD.l - OV_PAD.r) / n, bw = Math.max(2, w - 2);
  return `<svg viewBox="0 0 ${OV_SVG_W} ${OV_SVG_H}" width="100%" height="${OV_SVG_H}" role="img" aria-label="Weekly % change">${ax.grid}`
    + weeks.map((k, i) => { const y0 = ax.y(0), y1 = ax.y(k.pct), top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
      return `<rect data-i="${i}" x="${(OV_PAD.l + i * w + (w - bw) / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 2)}" fill="${k.pct < 0 ? '#e66767' : '#0ca30c'}"/>`; }).join('') + '</svg>';
}
let _ovMk = null; const OV_MK = { view: 'trend', range: '3M', sel: null, bar: null, list: [], held: new Set(), colors: {} };
const ovMkBtn = (attr, k, on) => `<button type="button" ${attr}="${k}" style="min-height:40px;min-width:48px;padding:0 10px;border-radius:8px;border:1px solid var(--border);background:${on ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${esc(k)}</button>`;
function ovMkColor(sym) { if (!OV_MK.colors[sym]) { const used = new Set(Object.entries(OV_MK.colors).filter(([k]) => OV_MK.sel.includes(k)).map(([, c]) => c)); OV_MK.colors[sym] = OV_MK_COLORS.find(c => !used.has(c)) || OV_MK_COLORS[0]; } return OV_MK.colors[sym]; }
function ovMarketsRender() {
  const body = document.getElementById('ov-markets-body'); if (!body) return;
  const days = (OV_MK_RANGES.find(r => r[0] === OV_MK.range) || OV_MK_RANGES[3])[1], is1d = OV_MK.range === '1D', now = Date.now(), got = OV_MK.list.filter(m => _ovMk.m[m.sym]);
  let h = `<div style="display:flex;gap:6px;flex-wrap:wrap">${[['trend', 'Trend'], ['bars', 'Weekly change'], ['table', 'Table']].map(([k, l]) => `<button type="button" data-mkv="${k}" style="min-height:40px;padding:0 12px;border-radius:8px;border:1px solid var(--border);background:${OV_MK.view === k ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${l}</button>`).join('')}</div>`;
  if (OV_MK.view === 'table') { body.innerHTML = h + ovMarketRows(OV_MK.list.map(m => ({ flag: m.flag, name: m.name, held: OV_MK.held.has(m.c), m: (_ovMk.m[m.sym] || {}).mv }))); return; }
  h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${OV_MK_RANGES.map(([k]) => ovMkBtn('data-mkr', k, k === OV_MK.range)).join('')}</div>`;
  h += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${got.map(m => { const on = OV_MK.view === 'trend' ? OV_MK.sel.includes(m.sym) : OV_MK.bar === m.sym, c = on ? ovMkColor(m.sym) : 'transparent';
    return `<button type="button" data-mks="${esc(m.sym)}" style="min-height:40px;padding:0 10px;border-radius:20px;border:1px solid ${on ? c : 'var(--border)'};background:transparent;color:inherit;cursor:pointer;font-size:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${on ? c : '#4a5078'};margin-right:5px"></span>${esc(m.name)}</button>`; }).join('')}</div>`;
  if (!got.length) { body.innerHTML = h + '<div style="color:var(--muted);font-size:13px">No index data came back from Yahoo Finance just now.</div>'; return; }
  if (OV_MK.view === 'trend') {
    const ser = OV_MK.sel.map(sym => got.find(m => m.sym === sym)).filter(Boolean).map(m => ({ m, color: ovMkColor(m.sym), pts: is1d ? ((_ovMk.intra || {})[m.sym] || []) : ovRebase(_ovMk.m[m.sym].pts, days, now) })).filter(x => x.pts.length > 1), T = ovTrendSvg(ser);
    if (!T) { body.innerHTML = h + '<div style="color:var(--muted);font-size:13px">Pick up to 4 indices above to draw their trend.</div>'; return; }
    h += `<div id="ov-mk-read" style="font-size:12px;min-height:34px;margin:4px 0">Touch the chart to read a ${is1d ? 'time' : 'day'}. ${is1d ? 'Each line is today\'s move vs the previous close.' : 'Each line starts at 0% at the beginning of the range.'}</div><div id="ov-mk-wrap">${T.svg}</div>`
      + `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin-top:4px">${ser.map(x => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${x.color};margin-right:4px"></span>${esc(x.m.name)} <b style="color:${x.pts[x.pts.length - 1].pct < 0 ? 'var(--red,#f87171)' : 'var(--green,#4ade80)'}">${x.pts[x.pts.length - 1].pct > 0 ? '+' : ''}${x.pts[x.pts.length - 1].pct.toFixed(1)}%</b></span>`).join('')}</div>`;
    body.innerHTML = h;
    const wrap = document.getElementById('ov-mk-wrap'), read = document.getElementById('ov-mk-read'), cross = document.getElementById('ov-mk-cross'), svg = document.getElementById('ov-mk-svg');
    const move = e => { const r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * T.geom.W, f = Math.min(1, Math.max(0, (fx - T.geom.x0) / (T.geom.x1 - T.geom.x0))), t = T.t0 + f * (T.t1 - T.t0);
      cross.setAttribute('x1', T.geom.x0 + f * (T.geom.x1 - T.geom.x0)); cross.setAttribute('x2', T.geom.x0 + f * (T.geom.x1 - T.geom.x0)); cross.setAttribute('visibility', 'visible');
      read.innerHTML = esc(is1d ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString('en-GB')) + ' · ' + ser.map(x => { const p = x.pts.reduce((m, q) => Math.abs(q.t - t) < Math.abs(m.t - t) ? q : m); return `<span style="color:var(--muted)">${esc(x.m.name)}</span> ${p.pct > 0 ? '+' : ''}${p.pct.toFixed(1)}%`; }).join(' · '); };
    wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerdown', move);
  } else {
    if (is1d) { body.innerHTML = h + '<div style="color:var(--muted);font-size:13px">Bars need 1W or longer (day-by-day up to 1M, week-by-week beyond). See Trend for today.</div>'; return; }
    const daily = days <= 31, unit = daily ? 'day' : 'week', m = got.find(x => x.sym === OV_MK.bar) || got[0], wk = ovWeeklyChanges(_ovMk.m[m.sym].pts, days, now, daily), st = ovWeeklyStats(wk);
    if (!st) { body.innerHTML = h + '<div style="color:var(--muted);font-size:13px">Not enough data for this span.</div>'; return; }
    const d = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), f = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    h += `<div id="ov-mk-read" style="font-size:12px;min-height:34px;margin:4px 0">${daily ? 'Daily' : 'Weekly'} % change of ${esc(m.name)}. Touch a bar to read its ${unit}.</div><div id="ov-mk-wrap">${ovBarsSvg(wk)}</div>`
      + `<div style="font-size:12px;margin-top:4px;line-height:1.6">${st.down} of ${st.n} ${unit}s down · worst ${unit} <b style="color:var(--red,#f87171)">${f(st.worst.pct)}</b> (${daily ? '' : 'w/e '}${d(st.worst.t)}) · best <b style="color:var(--green,#4ade80)">${f(st.best.pct)}</b> (${daily ? '' : 'w/e '}${d(st.best.t)}) · longest losing run ${st.streak} ${unit}${st.streak === 1 ? '' : 's'} · average ${f(st.avg)}/${unit}</div>`;
    body.innerHTML = h;
    const read = document.getElementById('ov-mk-read'); document.getElementById('ov-mk-wrap').addEventListener('pointerdown', e => { const r = e.target.closest('rect[data-i]'); if (r) { const k = wk[+r.dataset.i]; read.textContent = `${daily ? 'Day' : 'Week ending'} ${new Date(k.t).toLocaleDateString('en-GB')}: ${f(k.pct)}`; } });
  }
}
// 1D trend needs today's intraday points: fetched on demand for the selected indices (5-minute cache).
async function ovMkIntra() {
  if (OV_MK.range !== '1D' || OV_MK.view !== 'trend' || !_ovMk) return;
  _ovMk.intra = _ovMk.intra || {}; _ovMk.intraAt = _ovMk.intraAt || {};
  await Promise.all((OV_MK.sel || []).filter(y => !_ovMk.intra[y] || Date.now() - (_ovMk.intraAt[y] || 0) > 3e5).map(async y => {
    try { const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol: y, range: '1d' }) });
      _ovMk.intra[y] = r.ok ? ovIntradayPct(await r.json().catch(() => ({}))) : []; } catch (e) { _ovMk.intra[y] = []; } _ovMk.intraAt[y] = Date.now(); }));
}
async function loadMarketsHeld() {
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) return;
  let card = document.getElementById('ov-markets');
  if (!card) {
    const anchor = document.getElementById('ov-decline') || document.getElementById('ov-formula') || document.getElementById('stats-strip'); if (!anchor) return;
    anchor.insertAdjacentHTML('afterend', '<div class="card" id="ov-markets"><h3>Markets I hold</h3><div id="ov-markets-body"><div class="loading busy">Loading…</div></div><div class="muted" style="font-size:11px;margin-top:6px">Index moves (not your holdings), from Yahoo Finance daily closes. ● = a country in your holdings. Nifty, Sensex and FTSE 100 are always shown. Trend: every line starts at 0% at the start of the range. Weekly change: each bar is one week\'s % move. "From 1Y high" is how far the index is below its highest close of the past year.</div></div>');
    document.getElementById('ov-markets').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b || !_ovMk) return;
      if (b.dataset.mkv) OV_MK.view = b.dataset.mkv; else if (b.dataset.mkr) OV_MK.range = b.dataset.mkr;
      else if (b.dataset.mks) { const y = b.dataset.mks; if (OV_MK.view === 'bars') OV_MK.bar = y; else if (OV_MK.sel.includes(y)) OV_MK.sel = OV_MK.sel.filter(z => z !== y); else OV_MK.sel = OV_MK.sel.concat(y).slice(-4); }
      await ovMkIntra(); ovMarketsRender(); });
  }
  const body = document.getElementById('ov-markets-body');
  const held = new Set(); try { (await api('instrument_country_weights', '?select=country')).forEach(r => held.add(r.country)); } catch (e) {}
  const list = OV_MARKETS.filter(m => m.always || held.has(m.c));
  if (!_ovMk || Date.now() - _ovMk.at > 9e5) _ovMk = { at: Date.now(), m: {} };
  const one = async m => { if (m.sym in _ovMk.m) return;
    try { const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol: m.sym, range: '1y' }) });
      const d = await r.json().catch(() => ({})), mv = r.ok ? ovIndexMoves(d.points, Date.now()) : null; _ovMk.m[m.sym] = mv ? { mv, pts: d.points } : null; } catch (e) { _ovMk.m[m.sym] = null; } };
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one));
  OV_MK.list = list; OV_MK.held = held;
  if (!OV_MK.sel) OV_MK.sel = list.filter(m => m.always && _ovMk.m[m.sym]).map(m => m.sym).slice(0, 4);
  if (!OV_MK.bar || !_ovMk.m[OV_MK.bar]) OV_MK.bar = (list.find(m => _ovMk.m[m.sym]) || {}).sym || null;
  await ovMkIntra(); ovMarketsRender();
  // Re-render mood with market data now available (US/UK tabs use _ovMk)
  if (_mmTab !== 'Crypto') renderMoodTab();
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
  document.getElementById('ov-decline-btns').innerHTML = OV_RANGES.map(([k]) => `<button type="button" data-ovr="${k}" style="min-height:40px;min-width:48px;border-radius:8px;border:1px solid var(--border);background:${k === range ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${k}</button>`).join('');
  const body = document.getElementById('ov-decline-body');
  const snaps = await api('portfolio_snapshots', '?select=id,created_at&order=created_at.desc&limit=400');
  const pick = ovPickThen(snaps, days, Date.now());
  if (!pick.then) { try { const R = ovHistPositions(await api('pie_history', '?select=pie,series'), days, Date.now());
      if (R.posThen.length) { const w2 = {}; try { (await api('instrument_country_weights', '?select=ticker,country,flag,pct')).forEach(r => { (w2[r.ticker] = w2[r.ticker] || []).push(r); }); } catch (e) {}
        body.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px">Rebuilt from your Trading 212 order history: ${R.spanDays.toFixed(0)} days to ${esc(R.nowD)} (daily closes, holdings you owned at the start)</div>` + ovDeclineSections(ovCountryDecline(R.posNow, R.posThen, w2)); return; } } catch (e) {}
  }
  if (!pick.then) { body.innerHTML = `<div style="color:var(--muted);font-size:13px">Not enough saved history for ${esc(range)} yet: the oldest snapshot is ${pick.oldestDays.toFixed(1)} days older than the latest. Pick a shorter span.</div>`; return; }
  const [posNow, posThen] = await Promise.all([api('positions', `?snapshot_id=eq.${pick.latest.id}&select=ticker,current_price,quantity`), api('positions', `?snapshot_id=eq.${pick.then.id}&select=ticker,current_price,quantity`)]);
  const weights = {}; try { (await api('instrument_country_weights', '?select=ticker,country,flag,pct')).forEach(r => { (weights[r.ticker] = weights[r.ticker] || []).push(r); }); } catch (e) {}
  const span = (pick.latest.t - pick.then.t) / 864e5;
  body.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px">Latest vs ${span.toFixed(1)} days earlier (${esc(new Date(pick.then.t).toLocaleDateString('en-GB'))})</div>` + ovDeclineSections(ovCountryDecline(posNow, posThen, weights));
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
  document.getElementById('ov-line-btns').innerHTML = OV_RANGES.map(([k]) => `<button type="button" data-ovl="${k}" style="min-height:40px;min-width:48px;border-radius:8px;border:1px solid var(--border);background:${k === range ? 'var(--accent,#6366f1)' : 'transparent'};color:inherit;cursor:pointer">${k}</button>`).join('');
  const snaps = await api('portfolio_snapshots', '?select=created_at,raw&order=created_at.desc&limit=400');
  let L = ovLinePoints(snaps, days, Date.now()), rebuilt = false; const body = document.getElementById('ov-line-body');
  if (L.n < 2 || L.spanDays < days * 0.8) { try { const H = ovHistLine((await api('pie_history', '?select=pie,series')).find(r => r.pie === '__ALL__'), days, Date.now()); if (H.n >= 2 && (L.n < 2 || H.spanDays > L.spanDays)) { L = H; rebuilt = true; } } catch (e) {} }
  if (L.n < 2) { body.innerHTML = `<div style="color:var(--muted);font-size:13px">Not enough saved points for ${esc(range)} yet (${L.n} with Trading 212 account data${L.available ? `, covering ${L.available.toFixed(1)} days` : ''}). Press Refresh on different days to build the line.</div>`; return; }
  const g = x => '£' + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), up = L.change >= 0, lay = ovLineLayout(L.points);
  body.innerHTML = `<div style="font-size:20px;font-weight:700">${g(L.to.v)}</div><div style="font-size:13px;color:${up ? 'var(--green,#4ade80)' : 'var(--red,#f87171)'}">${up ? '+' : '−'}${g(L.change)} (${up ? '+' : ''}${L.pct.toFixed(2)}%) over ${L.spanDays.toFixed(1)} days · ${L.n} ${rebuilt ? 'daily points, rebuilt from your Trading 212 order history' : 'saved points'}</div>`
    + (L.flow != null && Math.abs(L.flow) >= 5 ? `<div style="font-size:12px;margin-top:2px">Cost basis ${L.flow > 0 ? '+' : '−'}${g(L.flow)} (buys/sells) · unrealised result ${L.change - L.flow >= 0 ? '+' : '−'}${g(L.change - L.flow)}</div>` : '')
    + '<div id="ov-ln-read" style="font-size:12px;min-height:34px;margin:4px 0">Touch the chart to read a point.</div><div id="ov-ln-wrap">' + ovLineSvg(L.points, lay) + '</div>'
    + (lay.gaps.length || lay.marks.length ? `<div class="muted" style="font-size:11px;margin-top:2px">${lay.gaps.length ? 'Dashed = no snapshots in between (app was not refreshed). ' : ''}${lay.marks.length ? '▲/▼ = cost basis rose/fell (a buy or sell moved the line, not the market).' : ''}</div>` : '')
    + `<div class="muted" style="font-size:11px">${esc(new Date(L.from.t).toLocaleString('en-GB'))} → ${esc(new Date(L.to.t).toLocaleString('en-GB'))}</div>`;
  const read = document.getElementById('ov-ln-read'), cross = document.getElementById('ov-ln-cross'), pick = document.getElementById('ov-ln-pick'), svg = document.getElementById('ov-ln-svg'), wrap = document.getElementById('ov-ln-wrap');
  const move = e => { const r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * lay.W; let k = 0; lay.xs.forEach((px, i) => { if (Math.abs(px - fx) < Math.abs(lay.xs[k] - fx)) k = i; });
    const p = L.points[k], px = lay.xs[k], py = lay.y(p.v), m = lay.marks.find(q => q.i === k);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible'); pick.setAttribute('cx', px); pick.setAttribute('cy', py); pick.setAttribute('visibility', 'visible');
    read.textContent = new Date(p.t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + g(p.v) + (p.inv != null ? ` · cost ${g(p.inv)} · unrealised ${p.v - p.inv < 0 ? '−' : '+'}${g(p.v - p.inv)}` : '') + (m ? ` · ${m.d > 0 ? '▲ cost basis +' : '▼ cost basis −'}${g(m.d)} (${m.d > 0 ? 'buy' : 'sell'})` : ''); };
  wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerdown', move);
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
      return `<div style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid ${pc}33;border-radius:5px;padding:3px 7px;font-size:10px" title="${e.label} — ${e.note}">
        <span style="color:#a5b4fc;font-weight:700">${e.ticker}</span>
        <span style="color:#334155">${e.pct < 100 ? e.pct+'%' : ''}</span>
        ${gs ? `<span style="color:${gc}">${gs}</span>` : ''}
      </div>`;
    }).join('');

    html += `<div data-sub="country:${country}" style="border:1px solid ${pc}44;border-radius:9px;background:${bg};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px">
        <div style="font-size:22px;line-height:1">${data.flag}</div>
        <div style="flex:1">
          <div data-sub-head style="font-size:13px;font-weight:700;color:var(--text)"><span class="sub-chev">▾</span>${country}</div>
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

// ── MARKET MOOD INDEX ─────────────────────────────────────────
// Market Mood: Crypto (api.alternative.me free/no-key) + all major markets
// computed from momentum of their index already loaded in _ovMk.
// Design: gauge arc, score badge, zone label, 7-day pill row (Mon→Today).
// CLAUDE.md: Fear & Greed is labelled as CapitalLens' own VIX/S&P/news reading.

// Tab definitions — key matches data-mmt attribute; sym = Yahoo symbol in _ovMk
const MM_TABS = [
  { key: 'Crypto', label: '₿ Crypto',  flag: '₿',  sym: null,       name: 'Bitcoin / Crypto' },
  { key: 'US',     label: '🇺🇸 US',    flag: '🇺🇸', sym: '^GSPC',    name: 'US (S&P 500)' },
  { key: 'UK',     label: '🇬🇧 UK',    flag: '🇬🇧', sym: '^FTSE',    name: 'UK (FTSE 100)' },
  { key: 'EU',     label: '🇩🇪 EU/DE', flag: '🇩🇪', sym: '^GDAXI',   name: 'Europe / Germany (DAX)' },
  { key: 'JP',     label: '🇯🇵 Japan', flag: '🇯🇵', sym: '^N225',    name: 'Japan (Nikkei 225)' },
  { key: 'IN',     label: '🇮🇳 India', flag: '🇮🇳', sym: '^NSEI',    name: 'India (Nifty 50)' },
  { key: 'CN',     label: '🇨🇳 China', flag: '🇨🇳', sym: '000001.SS', name: 'China (SSE Composite)' },
  { key: 'IT',     label: '🇮🇹 Italy', flag: '🇮🇹', sym: 'FTSEMIB.MI', name: 'Italy (FTSE MIB)' },
  { key: 'ES',     label: '🇪🇸 Spain', flag: '🇪🇸', sym: '^IBEX',    name: 'Spain (IBEX 35)' },
  { key: 'NL',     label: '🇳🇱 NL',    flag: '🇳🇱', sym: '^AEX',     name: 'Netherlands (AEX)' },
  { key: 'TW',     label: '🇹🇼 Taiwan',flag: '🇹🇼', sym: '^TWII',    name: 'Taiwan (TAIEX)' },
];
const MM_ZONES = [
  { max: 24,  label: 'Extreme Fear',  color: '#22c55e', bg: 'rgba(34,197,94,.12)'   },
  { max: 44,  label: 'Fear',          color: '#86efac', bg: 'rgba(134,239,172,.1)'  },
  { max: 55,  label: 'Neutral',       color: '#f59e0b', bg: 'rgba(245,158,11,.12)'  },
  { max: 75,  label: 'Greed',         color: '#f97316', bg: 'rgba(249,115,22,.12)'  },
  { max: 100, label: 'Extreme Greed', color: '#ef4444', bg: 'rgba(239,68,68,.12)'   },
];
function mmZone(score) { return MM_ZONES.find(z => score <= z.max) || MM_ZONES[MM_ZONES.length - 1]; }

// SVG gauge arc (half-circle, 0-100). Needle = line from centre to rim.
function mmGaugeSvg(score) {
  score = Math.max(0, Math.min(100, +score || 0));
  const z = mmZone(score), W = 200, H = 110, cx = 100, cy = 105, r = 88;
  const arc = (a1, a2, col) => {
    const rad = deg => (deg - 180) * Math.PI / 180;
    const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
    const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
    return '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + r + ',' + r + ' 0 0,1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="16" stroke-linecap="round"/>';
  };
  const seg = (lo, hi, col) => arc(lo * 1.8, hi * 1.8, col);
  const segs = MM_ZONES.map(function(z2, i) { const lo = i === 0 ? 0 : MM_ZONES[i-1].max + 1, hi = z2.max; return seg(lo, hi, z2.color + '88'); }).join('');
  const ang = (score * 1.8 - 180) * Math.PI / 180;
  const nx = cx + (r - 8) * Math.cos(ang), ny = cy + (r - 8) * Math.sin(ang);
  const needle = '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="' + z.color + '" stroke-width="3" stroke-linecap="round"/>';
  const dot = '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + z.color + '"/>';
  const lbl = '<text x="' + cx + '" y="' + (cy - 14) + '" text-anchor="middle" font-size="28" font-weight="800" fill="' + z.color + '">' + Math.round(score) + '</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:220px;display:block;margin:0 auto">' + segs + needle + dot + lbl + '</svg>';
}

// 7 day pills: oldest left, today right.
function mmPillsHtml(days) {
  if (!days || !days.length) return '';
  const D = days.slice(-7), today = new Date().toISOString().slice(0, 10);
  const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return '<div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin:8px 0 2px">' + D.map(function(d) {
    const z = mmZone(d.score), dt = d.date ? d.date.slice(0, 10) : '', isToday = dt === today;
    const dayIdx = new Date(dt + 'T12:00:00Z').getUTCDay();
    const dow = dt ? labels[dayIdx === 0 ? 6 : dayIdx - 1] : '';
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px">'
      + '<div style="font-size:9px;color:var(--muted);font-weight:' + (isToday ? 700 : 400) + '">' + (isToday ? 'Today' : esc(dow)) + '</div>'
      + '<div title="' + esc(z.label) + ' ' + Math.round(d.score) + '" style="width:36px;height:36px;border-radius:8px;background:' + z.bg + ';border:1.5px solid ' + z.color + (isToday ? '' : '66') + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:' + z.color + '">' + Math.round(d.score) + '</div>'
      + '</div>';
  }).join('') + '</div>';
}

// Compute 0-100 mood from daily index close pts ([[unixSec, close], ...]).
// 20-day price momentum: +10% = 100, -10% = 0. Labelled CapitalLens' own reading.
function mmFromIndex(pts) {
  if (!pts || pts.length < 2) return null;
  const sorted = pts.filter(function(p) { return p && +p[0] > 0 && +p[1] > 0; }).map(function(p) { return [+p[0]*1000, +p[1]]; }).sort(function(a,b) { return a[0]-b[0]; });
  if (sorted.length < 22) return null;
  const byDay = new Map();
  sorted.forEach(function(x) { const d = new Date(x[0]).toISOString().slice(0,10); byDay.set(d, x[1]); });
  const allDays = Array.from(byDay.keys()).sort();
  const last7 = allDays.slice(-7);
  const toScore = function(mom) { return Math.max(0, Math.min(100, 50 + mom * 5)); };
  const result = last7.map(function(dt) {
    const idx = allDays.indexOf(dt);
    if (idx < 20) return { score: 50, date: dt };
    const cur = byDay.get(dt), prev = byDay.get(allDays[idx - 20]);
    return { score: toScore(prev ? (cur / prev - 1) * 100 : 0), date: dt };
  });
  return { days: result };
}

let _mmCrypto = null, _mmCryptoAt = 0, _mmTab = 'Crypto';

// Market Mood fetches its OWN index history (1y daily closes via the relay), so every tab works whether or not you hold that country
// (the Markets-I-hold card only loads countries you hold). Cached 15 minutes; a failure is remembered for 60 seconds so a tab is not re-fetched in a loop.
const _mmIdx = {};
function mmIdxPts(sym) {
  const hit = typeof _ovMk !== 'undefined' && _ovMk && _ovMk.m && _ovMk.m[sym];
  if (hit && hit.pts) return hit.pts;
  const c = _mmIdx[sym]; return c && c.pts && Date.now() - c.at < 9e5 ? c.pts : null;
}
async function mmFetchIdx(sym) {
  try {
    const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol: sym, range: '1y' }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!d.points || !d.points.length) throw new Error('no prices returned');
    _mmIdx[sym] = { at: Date.now(), pts: d.points };
  } catch (e) { _mmIdx[sym] = { at: Date.now(), err: e.message || 'network error' }; }
}

async function loadMarketMood() {
  const card = document.getElementById('mood-section'); if (!card) return;
  const body = document.getElementById('mood-body');   if (!body) return;
  const tabBar = document.getElementById('mood-tabs'); if (!tabBar) return;

  // Build chip strip dynamically from MM_TABS (replaces static HTML buttons)
  if (!tabBar.dataset.wired) {
    tabBar.dataset.wired = '1';
    // Collapsed by default — show trigger + active label; tap to fan out
    const trigStyle = 'flex:0 0 auto;min-height:36px;padding:0 12px;border-radius:20px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;display:flex;align-items:center;gap:5px';
    const chipStyle = 'flex:0 0 auto;min-height:36px;padding:0 11px;border-radius:20px;border:1px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;font-size:13px;white-space:nowrap;transition:opacity .18s,transform .18s;opacity:0;transform:translateX(-18px);pointer-events:none';
    tabBar.style.cssText = 'display:flex;align-items:center;gap:6px;overflow:hidden;position:relative;min-width:0;max-width:100%';
    if (tabBar.parentElement) tabBar.parentElement.style.flexWrap = 'wrap';      // open strip drops to its own row(s) so every market is reachable on a phone
    tabBar.innerHTML =
      '<button type="button" id="mood-trigger" style="' + trigStyle + '"><span id="mood-trigger-label">📊 Markets</span><span style="font-size:10px;opacity:.8">▸</span></button>'
      + MM_TABS.map(function(t) {
          return '<button type="button" data-mmt="' + t.key + '" style="' + chipStyle + '">' + t.label + '</button>';
        }).join('');

    let _expanded = false;
    function mmExpand(open) {
      _expanded = open;
      // Open: chips WRAP onto as many rows as needed across the full card width (nothing clipped, no hidden scroll). Closed: one compact row.
      tabBar.style.flexWrap = open ? 'wrap' : 'nowrap';
      tabBar.style.flex = open ? '1 1 100%' : '0 1 auto';
      tabBar.style.overflow = open ? 'visible' : 'hidden';
      tabBar.style.marginTop = open ? '8px' : '0';
      const trig = document.getElementById('mood-trigger');
      const chips = tabBar.querySelectorAll('[data-mmt]');
      if (open) {
        trig.querySelector('span:last-child').textContent = '▾';
        chips.forEach(function(c, i) {
          c.style.pointerEvents = 'auto';
          setTimeout(function() { c.style.opacity = '1'; c.style.transform = 'translateX(0)'; }, i * 28);
        });
      } else {
        trig.querySelector('span:last-child').textContent = '▸';
        chips.forEach(function(c) { c.style.opacity = '0'; c.style.transform = 'translateX(-18px)'; c.style.pointerEvents = 'none'; });
      }
    }

    document.getElementById('mood-trigger').addEventListener('click', function() { mmExpand(!_expanded); });
    tabBar.addEventListener('click', function(e) {
      const b = e.target.closest('[data-mmt]'); if (!b) return;
      _mmTab = b.dataset.mmt;
      mmExpand(false);
      renderMoodTab();
    });
  }

  if (!_mmCrypto || Date.now() - _mmCryptoAt > 6e5) {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=7&format=json');
      const json = await res.json();
      if (json && json.data && json.data.length) {
        _mmCrypto = json.data.slice().reverse().map(function(d) {
          return { score: +d.value, date: new Date(+d.timestamp * 1000).toISOString().slice(0, 10) };
        });
        _mmCryptoAt = Date.now();
      }
    } catch(e) { _mmCrypto = _mmCrypto || null; }
  }
  renderMoodTab();
}

function renderMoodTab() {
  const body = document.getElementById('mood-body');   if (!body) return;
  const tabBar = document.getElementById('mood-tabs'); if (!tabBar) return;

  // Highlight active chip
  tabBar.querySelectorAll('[data-mmt]').forEach(function(b) {
    const on = b.dataset.mmt === _mmTab;
    b.style.background  = on ? 'var(--accent)' : 'var(--bg3)';
    b.style.color       = on ? '#fff' : 'var(--muted)';
    b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
    b.style.fontWeight  = on ? '600' : '400';
  });

  // Update trigger label to show active market
  const trigLabel = document.getElementById('mood-trigger-label');
  if (trigLabel) {
    const activeDef = MM_TABS.find(function(t) { return t.key === _mmTab; });
    trigLabel.textContent = activeDef ? (activeDef.flag + ' ' + activeDef.key) : '📊 Markets';
  }

  const tabDef = MM_TABS.find(function(t) { return t.key === _mmTab; }) || MM_TABS[0];
  let data = null, sourceNote = '';

  if (_mmTab === 'Crypto') {
    if (_mmCrypto && _mmCrypto.length) data = { days: _mmCrypto };
    sourceNote = 'Source: Alternative.me Fear & Greed Index';
  } else {
    // All non-crypto tabs: mood from the index's own closes (fetched here on demand, see mmFetchIdx)
    const sym = tabDef.sym, pts = sym && (mmIdxPts(sym) || (_mmTab === 'US' && mmIdxPts('^NDX')));
    if (pts) data = mmFromIndex(pts);
    else if (sym) {
      const c = _mmIdx[sym];
      if (c && c.err && Date.now() - c.at < 6e4) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0;text-align:center">⚠ Could not load ' + esc(tabDef.name) + ' prices (' + esc(c.err) + ') — tap the market again in a minute.</div>'; return; }
      body.innerHTML = '<div class="loading busy" style="padding:12px 0;text-align:center">Loading ' + esc(tabDef.name) + '…</div>';
      const want = _mmTab; mmFetchIdx(sym).then(function() { if (_mmTab === want) renderMoodTab(); });
      return;
    }
    sourceNote = 'CapitalLens reading: ' + tabDef.name + ' momentum vs 20-day avg';
  }

  if (!data || !data.days || !data.days.length) {
    const msg = _mmTab === 'Crypto'
      ? (_mmCrypto === null ? '⚠ Could not reach Alternative.me — try refreshing.' : '⏳ Loading crypto sentiment…')
      : 'Not enough price history for ' + esc(tabDef.name) + ' (needs about 22 trading days of closes) — source: Yahoo via the relay.';
    body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0;text-align:center">' + msg + '</div>';
    return;
  }
  const today = data.days[data.days.length - 1], z = mmZone(today.score);
  body.innerHTML = '<div style="text-align:center;padding:4px 0 0">'
    + mmGaugeSvg(today.score)
    + '<div style="font-size:15px;font-weight:700;color:' + z.color + ';margin-top:2px">' + esc(z.label) + '</div>'
    + '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + tabDef.flag + ' ' + esc(tabDef.name) + '</div>'
    + '</div>'
    + mmPillsHtml(data.days)
    + '<div style="font-size:10px;color:var(--muted);text-align:center;margin-top:4px">' + esc(sourceNote) + '</div>';
}
