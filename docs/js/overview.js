// ── OVERVIEW ──────────────────────────────────────────────────
async function loadOverview() {
  const [snaps, , alerts] = await Promise.all([
    api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'),
    api('positions','?select=*&order=gain_pct.desc&limit=1'),
    api('alerts','?select=*&order=created_at.desc&limit=5'),
  ]);

  const snap = snaps[0] || {};
  const tv = snap.total_value || 0;
  const cash = snap.cash || 0;
  const inv = snap.invested || 0;
  const ppl = snap.total_ppl || (tv - inv);
  const pplPct = inv ? (ppl / inv * 100) : 0;
  const ts = snap.created_at ? new Date(snap.created_at).toLocaleString('en-GB') : '—';
  document.getElementById('last-updated').textContent = `Updated: ${ts}`;

  const allPos = await api('positions', `?snapshot_id=eq.${snap.id}&select=gain_pct,ppl`).catch(()=>[]);
  const winners = allPos.filter(p => (p.gain_pct||0) > 0).length;
  const losers  = allPos.filter(p => (p.gain_pct||0) < 0).length;
  const alertCount = alerts.length;

  document.getElementById('stats-strip').innerHTML = `
    <div class="stat-card"><div class="label">Total Value</div><div class="value">${fmtGbp(tv)}</div></div>
    <div class="stat-card"><div class="label">Invested</div><div class="value">${fmtGbp(inv)}</div></div>
    <div class="stat-card"><div class="label">Cash</div><div class="value">${fmtGbp(cash)}</div></div>
    <div class="stat-card"><div class="label">Total P&amp;L</div><div class="value ${clr(ppl)}">${fmtGbp(ppl)}</div><div class="sub ${clr(pplPct)}">${IS_GUEST ? '' : fmt(pplPct)+'%'}</div></div>
    <div class="stat-card"><div class="label">Winners</div><div class="value green">${winners}</div></div>
    <div class="stat-card"><div class="label">Losers</div><div class="value red">${losers}</div></div>
    <div class="stat-card"><div class="label">Positions</div><div class="value">${allPos.length}</div></div>
    <div class="stat-card"><div class="label">Alerts</div><div class="value yellow">${alertCount}</div></div>
  `;

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

async function loadOverviewCharts() {
  if (IS_GUEST) {
    document.getElementById('gain-bar').parentElement.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view holdings chart</div>';
    document.getElementById('pie-doughnut').parentElement.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view pie breakdown</div>';
    return;
  }
  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) return;
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*&order=gain_pct.desc`);

  const ctx1 = document.getElementById('gain-bar').getContext('2d');
  if (ctx1._chart) ctx1._chart.destroy();
  ctx1._chart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: positions.map(p => p.ticker || p.display || '?'),
      datasets: [{
        data: positions.map(p => +(p.gain_pct || 0).toFixed(2)),
        backgroundColor: positions.map(p => (p.gain_pct||0) >= 0 ? 'rgba(34,197,94,.7)' : 'rgba(239,68,68,.7)'),
        borderRadius: 3,
      }]
    },
    options: { plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#8892a4',font:{size:9}},grid:{color:'#2d3353'}}, y:{ticks:{color:'#8892a4'},grid:{color:'#2d3353'}} }, responsive:true }
  });

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
    data: {
      labels: pienames,
      datasets: [{ data: pienames.map(k => pieMap[k]), backgroundColor: COLORS }]
    },
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

  const SECTOR_MAP = {
    'NVDA':'Technology','MSFT':'Technology','AAPL':'Technology',
    'GOOGL':'Technology','FB':'Technology','AMZN':'Technology',
    'SPCX':'Technology',
    'SGLNl':'Commodities','SSLNl':'Commodities',
    'VUSAa':'Broad Market','VWCEd':'Broad Market','SXRVd':'Broad Market',
    'QDVEd':'Emerging Markets',
    'IAEXl':'Country / Regional','IPOLl':'Country / Regional',
    'ITWNl':'Country / Regional','XDAXl':'Country / Regional',
    'CS1l':'Country / Regional','IMIBl':'Country / Regional',
  };

  const SECTOR_COLORS = {
    'Technology':       { bg:'rgba(99,102,241,.18)',  border:'#6366f1', text:'#a5b4fc' },
    'Commodities':      { bg:'rgba(245,158,11,.15)',  border:'#f59e0b', text:'#fcd34d' },
    'Broad Market':     { bg:'rgba(34,197,94,.12)',   border:'#22c55e', text:'#86efac' },
    'Emerging Markets': { bg:'rgba(6,182,212,.13)',   border:'#06b6d4', text:'#67e8f9' },
    'Country / Regional':{ bg:'rgba(167,139,250,.13)', border:'#a78bfa', text:'#c4b5fd'},
  };

  const PIE_COLORS = {
    'Magnificent 7':'#6366f1','UK Gold & Silver':'#f59e0b',
    'Wider ETF':'#22c55e','Country Etf':'#a78bfa',
  };

  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) { el.innerHTML = '<div style="color:var(--muted)">No snapshot yet</div>'; return; }
  // reuse cached positions fetch (same params as loadOverviewCharts)
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*&order=gain_pct.desc`);

  const seen = new Set();
  const pos = positions.filter(p => { if(seen.has(p.ticker)) return false; seen.add(p.ticker); return true; });

  const sectors = {};
  pos.forEach(p => {
    const sym = p.display || p.ticker || '';
    const cleanSym = sym.replace(/[ldaAS]$/, '') || sym;
    const sector = SECTOR_MAP[sym] || SECTOR_MAP[cleanSym] || 'Other';
    const pie = p.pie || 'Solo';
    if (!sectors[sector]) sectors[sector] = {};
    if (!sectors[sector][pie]) sectors[sector][pie] = [];
    sectors[sector][pie].push(p);
  });

  const SECTOR_ORDER = ['Technology','Broad Market','Country / Regional','Emerging Markets','Commodities','Other'];

  let html = `<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">`;

  for (const sName of SECTOR_ORDER) {
    if (!sectors[sName]) continue;
    const sc = SECTOR_COLORS[sName] || { bg:'rgba(100,116,139,.12)', border:'#475569', text:'#94a3b8' };
    const pies = sectors[sName];

    let piecols = '';
    for (const [pieName, holdings] of Object.entries(pies)) {
      const pc = PIE_COLORS[pieName] || '#8892a4';
      const chips = holdings.map(h => {
        const gp = h.gain_pct != null ? +h.gain_pct : null;
        const gpColor = gp == null ? '#475569' : gp >= 0 ? '#22c55e' : '#ef4444';
        const gpStr = gp == null ? '' : `${gp >= 0 ? '+' : ''}${gp.toFixed(1)}%`;
        const sym = (h.display || h.ticker || '').replace(/_EQ$/, '');
        return `<div style="
          display:inline-flex;align-items:center;gap:5px;
          background:#0f1117;border:1px solid ${sc.border}44;
          border-radius:6px;padding:4px 8px;font-size:11px;
          transition:border-color .15s;cursor:default;
          " title="${pieName}">
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

    html += `<div style="
      border:1px solid ${sc.border}55;border-radius:10px;
      background:${sc.bg};overflow:hidden;
    ">
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;border-bottom:1px solid ${sc.border}33;
      ">
        <div style="font-size:12px;font-weight:700;color:${sc.text}">${sName}</div>
        <div style="font-size:10px;color:#334155">${totalHoldings} holding${totalHoldings!==1?'s':''} · ${Object.keys(pies).length} pie${Object.keys(pies).length!==1?'s':''}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;padding:10px 12px">
        ${piecols}
      </div>
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

  // ETF → country exposure: flag, country name, approximate weight %
  const ETF_COUNTRY_MAP = {
    'QDVEd':  { label:'US Tech ETF',      countries:[
      { flag:'🇺🇸', name:'USA',         pct:100, note:'AAPL·NVDA·MSFT·GOOGL·AMZN' },
    ]},
    'ITWNl':  { label:'Taiwan ETF',       countries:[
      { flag:'🇹🇼', name:'Taiwan',      pct:100, note:'TSMC 32%·MediaTek 8%' },
    ]},
    'IMIBl':  { label:'Italy MIB ETF',    countries:[
      { flag:'🇮🇹', name:'Italy',       pct:100, note:'UniCredit·Intesa·Eni·Enel' },
    ]},
    'IPOLl':  { label:'Poland ETF',       countries:[
      { flag:'🇵🇱', name:'Poland',      pct:100, note:'PKO·Pekao·mBank·Orlen' },
    ]},
    'XDAXl':  { label:'Germany DAX ETF',  countries:[
      { flag:'🇩🇪', name:'Germany',     pct:100, note:'Siemens·Allianz·SAP·Airbus' },
    ]},
    'IAEXl':  { label:'Netherlands AEX',  countries:[
      { flag:'🇳🇱', name:'Netherlands', pct:100, note:'ASML·Shell·ING·Unilever·Adyen' },
    ]},
    'CS1l':   { label:'MSCI World ETF',   countries:[
      { flag:'🇺🇸', name:'USA',         pct:67, note:'S&P 500 large cap' },
      { flag:'🇯🇵', name:'Japan',       pct:6,  note:'Toyota·Sony·SoftBank' },
      { flag:'🇬🇧', name:'UK',          pct:4,  note:'HSBC·AstraZeneca·BP' },
      { flag:'🇫🇷', name:'France',      pct:3,  note:'LVMH·TotalEnergies' },
      { flag:'🇨🇦', name:'Canada',      pct:3,  note:'Royal Bank·Shopify' },
      { flag:'🌍', name:'Other DM',     pct:17, note:'Germany·Australia·Switzerland…' },
    ]},
    'VUSAa':  { label:'S&P 500 ETF',      countries:[
      { flag:'🇺🇸', name:'USA',         pct:100, note:'500 largest US companies' },
    ]},
    'VWCEd':  { label:'All-World ETF',    countries:[
      { flag:'🇺🇸', name:'USA',         pct:63, note:'S&P 500 dominant' },
      { flag:'🇯🇵', name:'Japan',       pct:6,  note:'Large cap' },
      { flag:'🇬🇧', name:'UK',          pct:4,  note:'Large cap' },
      { flag:'🇨🇳', name:'China',       pct:3,  note:'Alibaba·Tencent' },
      { flag:'🌍', name:'Other',        pct:24, note:'EM + other DM' },
    ]},
    'SXRVd':  { label:'S&P 500 Financials',countries:[
      { flag:'🇺🇸', name:'USA',         pct:100, note:'JPMorgan·BofA·Wells Fargo' },
    ]},
    'SGLNl':  { label:'Gold ETC',         countries:[
      { flag:'🥇', name:'Gold',         pct:100, note:'Physical gold backed' },
    ]},
    'SSLNl':  { label:'Silver ETC',       countries:[
      { flag:'🥈', name:'Silver',       pct:100, note:'Physical silver backed' },
    ]},
  };

  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) { el.innerHTML = '<div style="color:var(--muted)">No snapshot yet</div>'; return; }
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*&order=gain_pct.desc`);

  // Build map of ticker → position data
  const posMap = {};
  positions.forEach(p => { posMap[p.display || p.ticker] = p; });

  // Aggregate country exposure across all ETFs held
  const countryAgg = {}; // countryName → { flag, etfs:[], totalPct, weightedGain, gainCount }

  for (const [etfTicker, etfDef] of Object.entries(ETF_COUNTRY_MAP)) {
    const pos = posMap[etfTicker];
    if (!pos) continue; // not in portfolio
    const gainPct = pos.gain_pct != null ? +pos.gain_pct : null;

    for (const c of etfDef.countries) {
      if (!countryAgg[c.name]) countryAgg[c.name] = { flag:c.flag, etfs:[], gainSum:0, gainCount:0 };
      countryAgg[c.name].etfs.push({ ticker:etfTicker, label:etfDef.label, pct:c.pct, note:c.note, gain:gainPct });
      if (gainPct != null) {
        countryAgg[c.name].gainSum += gainPct * (c.pct / 100);
        countryAgg[c.name].gainCount++;
      }
    }
  }

  // Sort countries by weighted gain desc
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
      return `<div style="display:inline-flex;align-items:center;gap:4px;background:#0f1117;border:1px solid ${pc}33;border-radius:5px;padding:3px 7px;font-size:10px" title="${e.note}">
        <span style="color:#a5b4fc;font-weight:700">${e.ticker}</span>
        <span style="color:#334155">${e.pct < 100 ? e.pct+'%' : ''}</span>
        ${gs ? `<span style="color:${gc}">${gs}</span>` : ''}
      </div>`;
    }).join('');

    html += `<div style="border:1px solid ${pc}44;border-radius:9px;background:${bg};overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px">
        <div style="font-size:22px;line-height:1">${data.flag}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#e2e8f0">${country}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${etfChips}</div>
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
