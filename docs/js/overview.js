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
