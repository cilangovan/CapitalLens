// ── INSTITUTIONAL FLOW ────────────────────────────────────────
async function loadInstFlow() {
  const el = document.getElementById('inst-flow-content');
  if (IS_GUEST) { el.innerHTML = ''; return; }
  const rows = await api('institutional_flow_reports','?select=*&order=report_date.desc&limit=1');
  const r = rows[0];
  if (!r) {
    el.innerHTML = `<div class="card" style="margin-bottom:16px">
      <h3>🌍 Global Institutional Capital</h3>
      <div style="color:var(--muted);font-size:12px">No data yet — runs every Sunday.</div>
    </div>`;
    return;
  }

  const safeJ = (v,d) => { if(!v) return d; if(typeof v==='object') return v; try{return JSON.parse(v)}catch{return d}};
  const markets   = safeJ(r.markets, []);
  const sectors   = safeJ(r.sector_rotation, {});
  const opps      = safeJ(r.opportunities, []);
  const cautions  = safeJ(r.cautions, []);
  const actions   = safeJ(r.portfolio_actions, []);

  const scoreColor = s => s>=80?'#22c55e':s>=65?'#60a5fa':s>=45?'#e8a838':'#ef4444';
  const scoreLabel = s => s>=80?'Strong Accumulation':s>=65?'Positive':s>=45?'Neutral':'Weak';

  // Market score cards (collapsible)
  let instCardIdx = 0;
  const marketCards = markets.map(m => {
    const sc = scoreColor(m.score);
    const bd = m.breakdown || {};
    const md = m.market_data || {};
    const idx = instCardIdx++;
    const collapseId = `inst-collapse-${idx}`;
    const bars = Object.entries(bd).map(([k,v]) => {
      const pct = Math.round((v.score/v.max)*100);
      const lbl = k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      const bc  = pct>=75?'#22c55e':pct>=50?'#60a5fa':'#e8a838';
      return `<div style="margin-bottom:5px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:2px">
          <span>${lbl}</span><span style="color:${bc}">${v.score}/${v.max}</span>
        </div>
        <div style="height:4px;background:#1e293b;border-radius:2px">
          <div style="width:${pct}%;height:100%;background:${bc};border-radius:2px"></div>
        </div>
        <div style="font-size:9px;color:#475569;margin-top:1px">${v.note||''}</div>
      </div>`;
    }).join('');
    const techRow = [
      md.rsi!=null?`RSI <strong style="color:${md.rsi<40?'#22c55e':md.rsi>65?'#ef4444':'#e8a838'}">${md.rsi}</strong>`:'',
      md.mom_4w!=null?`4w mom <strong style="color:${md.mom_4w>=0?'#22c55e':'#ef4444'}">${md.mom_4w>=0?'+':''}${md.mom_4w}%</strong>`:'',
      md.pct_from_high!=null?`From 52w high <strong style="color:#94a3b8">${md.pct_from_high}%</strong>`:'',
      md.above_ma50!=null?`MA50 <strong style="color:${md.above_ma50?'#22c55e':'#ef4444'}">${md.above_ma50?'Above':'Below'}</strong>`:'',
    ].filter(Boolean).join(' · ');
    return `
      <div style="border:1px solid ${sc}44;border-radius:10px;overflow:hidden;margin-bottom:10px">
        <div onclick="toggleInstCard('${collapseId}')" style="padding:12px 14px;background:#0d1b2e;display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none">
          <div style="flex:1">
            <div style="font-weight:700;font-size:13px">${m.label||m.region}</div>
            <div style="font-size:11px;color:${sc};margin-top:2px">${scoreLabel(m.score)} · ${m.action||''}</div>
            <div style="font-size:10px;color:#475569;margin-top:4px">${techRow}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:26px;font-weight:800;color:${sc}">${m.score}</div>
            <div style="font-size:9px;color:var(--muted)">/ 100</div>
          </div>
          <div id="${collapseId}-chevron" style="color:#334155;font-size:11px;margin-left:4px">▲</div>
        </div>
        <div id="${collapseId}" style="padding:10px 14px;background:#060f1e">${bars}</div>
      </div>`;
  }).join('');

  // Inject collapse helper once
  if (!window._instCollapseReady) {
    window._instCollapseReady = true;
    window.toggleInstCard = function(id) {
      const el = document.getElementById(id);
      const ch = document.getElementById(id + '-chevron');
      if (!el) return;
      const hidden = el.style.display === 'none';
      el.style.display = hidden ? '' : 'none';
      if (ch) ch.textContent = hidden ? '▲' : '▼';
    };
  }

  const allSectors = (sectors.all || []);
  const sectorRows = allSectors.map(s => {
    const sc = s.score > 5 ? '#22c55e' : s.score < -5 ? '#ef4444' : '#94a3b8';
    const sig = s.signal==='Inflow'?'▲':s.signal==='Outflow'?'▼':'–';
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #0d1b2e;font-size:11px">
      <span style="color:${sc};font-size:13px">${sig}</span>
      <span style="flex:1;color:#e2e8f0">${s.sector}</span>
      <span style="color:var(--muted);min-width:40px">${s.ticker}</span>
      <span style="color:${s.mom_4w>=0?'#22c55e':'#ef4444'};min-width:50px;text-align:right">${s.mom_4w>=0?'+':''}${s.mom_4w}%</span>
      <span style="color:#94a3b8;min-width:36px;text-align:right">RSI ${s.rsi}</span>
      <span style="color:${sc};font-weight:700;min-width:28px;text-align:right">${s.score>0?'+':''}${s.score}</span>
    </div>`;
  }).join('');

  // ── Portfolio sector exposure: weights come from the database (RLS limits rows to instruments you hold) ──
  const sectorWts = {};
  try {
    (await api('instrument_sector_weights', '?select=ticker,sector,pct,note&order=pct.desc')).forEach(r => {
      (sectorWts[r.sector.toLowerCase()] = sectorWts[r.sector.toLowerCase()] || []).push(r);
    });
  } catch (e) {}
  const normSector = n => {
    n = String(n || '').toLowerCase();
    if (n.startsWith('consumer st')) return 'consumer staples';
    if (n.startsWith('comm')) return 'comm services';
    return n;
  };

  const portfolioImpact = (sectorName) => {
    const key = normSector(sectorName);
    const hits = sectorWts[key]
      || Object.entries(sectorWts).find(([k]) => key && (key.includes(k) || k.includes(key)))?.[1]
      || [];
    if (!hits.length) return '';
    const chips = hits.map(h => {
      const pct = h.pct != null ? (+h.pct >= 100 ? '100% ' : '~' + (+h.pct) + '% ') : '';
      return `<span style="display:inline-flex;align-items:center;gap:3px;background:#0f1117;border:1px solid #2d3353;border-radius:4px;padding:2px 6px;font-size:10px">
        <span style="color:#a5b4fc;font-weight:700">${String(h.ticker).replace(/_EQ$/, '')}</span>
        <span style="color:#475569">${pct}${h.note || ''}</span>
      </span>`;
    }).join(' ');
    return `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px;align-items:center">
      <span style="font-size:9px;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-right:2px">Your exposure:</span>
      ${chips}
    </div>`;
  };

  const oppHtml = opps.map(o => `
    <div style="padding:7px 10px;border-radius:7px;background:rgba(34,197,94,0.07);border-left:3px solid #22c55e;margin-bottom:5px;font-size:11px">
      <div style="font-weight:600;color:#22c55e">${o.type}: ${o.name} <span style="color:#94a3b8;font-weight:400">· ${o.score}/100</span></div>
      <div style="color:var(--muted);margin-top:2px">${o.reason}</div>
      <div style="color:#22c55e;margin-top:2px">→ ${o.action}</div>
      ${portfolioImpact(o.name)}
    </div>`).join('');
  const cauHtml = cautions.map(c => `
    <div style="padding:7px 10px;border-radius:7px;background:rgba(239,68,68,0.07);border-left:3px solid #ef4444;margin-bottom:5px;font-size:11px">
      <div style="font-weight:600;color:#ef4444">${c.type}: ${c.name} <span style="color:#94a3b8;font-weight:400">· ${c.score}/100</span></div>
      <div style="color:var(--muted);margin-top:2px">${c.reason}</div>
      <div style="color:#ef4444;margin-top:2px">→ ${c.action}</div>
      ${portfolioImpact(c.name)}
    </div>`).join('');

  const actHtml = actions.map(a => {
    const sc = a.market_score>=65?'#22c55e':a.market_score>=45?'#e8a838':'#ef4444';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #0d1b2e;font-size:11px">
      <div style="min-width:130px;color:#94a3b8">${a.pie}</div>
      <div style="min-width:60px;color:var(--muted)">${a.region}</div>
      <div style="flex:1;color:${sc}">${a.action}</div>
    </div>`;
  }).join('');

  const noteHtml = `
    <div style="margin-top:12px;padding:10px 12px;background:#0d1b2e;border-radius:8px;font-size:10px;color:#475569;line-height:1.6">
      <strong style="color:#64748b">📌 Data sources:</strong>
      <strong style="color:#94a3b8">ETF flows</strong> — money entering/leaving funds (daily signal, used for all regions).
      <strong style="color:#94a3b8">Exchange-level net buying</strong> — actual net trading by investor category (most reliable for USA/UK).
      <strong style="color:#94a3b8">Major shareholder disclosures</strong> — significant ownership changes, not ordinary daily trading.
      <strong style="color:#94a3b8">13F filings</strong> — institutional holdings with ~45-day delay; informs long-term view only, not weekly entry timing.
    </div>`;

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:6px">
        <div>
          <h3 style="margin:0">🌍 Global Institutional Capital</h3>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.summary||''}</div>
        </div>
        <div style="font-size:10px;color:#334155">Week of ${r.report_date}</div>
      </div>
      <div style="font-size:10px;color:#334155;margin-bottom:14px;padding:6px 10px;background:#060f1e;border-radius:6px">
        🕐 Daily: detect changes &nbsp;·&nbsp; Weekly: Buy / Hold / Reduce / Watch &nbsp;·&nbsp; Monthly: rebalance &nbsp;·&nbsp; Quarterly: reassess fundamentals + 13F
      </div>

      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Market Scores</div>
      ${marketCards}

      ${r.cash_strategy?`
      <div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:rgba(96,165,250,0.08);border:1px solid #1e3a5f;font-size:12px;color:#cbd5e1;line-height:1.6">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">💰 Cash Deployment Strategy</div>
        ${r.cash_strategy}
      </div>`:''}

      <div class="m-grid2" style="gap:16px;margin-bottom:14px">
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">✅ Opportunities</div>
          ${oppHtml||'<div style="font-size:11px;color:#334155">None identified</div>'}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">⚠️ Cautions</div>
          ${cauHtml||'<div style="font-size:11px;color:#334155">None identified</div>'}
        </div>
      </div>

      ${actHtml?`
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">📋 Pie Actions</div>
        <div style="font-size:10px;color:#475569;display:flex;gap:10px;margin-bottom:4px">
          <span style="min-width:130px">Pie</span><span style="min-width:60px">Region</span><span>Action</span>
        </div>
        ${actHtml}
      </div>`:''}

      <div>
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">🔄 Sector Rotation</div>
        <div style="font-size:9px;color:#475569;display:flex;gap:8px;margin-bottom:4px;padding:0 0 4px 20px;border-bottom:1px solid #0d1b2e">
          <span style="flex:1">Sector</span><span style="min-width:40px">ETF</span>
          <span style="min-width:50px;text-align:right">4w mom</span>
          <span style="min-width:36px;text-align:right">RSI</span>
          <span style="min-width:28px;text-align:right">Score</span>
        </div>
        ${sectorRows}
      </div>
      ${noteHtml}
    </div>`;
}

// ── HOLDING DECISIONS ─────────────────────────────────────────
async function loadHoldingDecisions() {
  const el = document.getElementById('holding-dec-content');
  if (IS_GUEST) { el.innerHTML = ''; return; }
  const rows = await api('holding_decisions',
    '?select=*&order=report_date.desc,score.asc&limit=200');
  if (!rows.length) {
    el.innerHTML = `<div class="card" style="margin-bottom:16px">
      <h3>📊 Holding Decisions</h3>
      <div style="color:var(--muted);font-size:12px">No data yet — runs every Sunday.</div>
    </div>`;
    return;
  }

  const latestDate = rows[0].report_date;
  const latest = rows.filter(r => r.report_date === latestDate);

  const sellLevelMeta = {
    0: { label:'Clear',           color:'#22c55e', bg:'rgba(34,197,94,0.07)'  },
    1: { label:'L1 Warning',      color:'#e8a838', bg:'rgba(232,168,56,0.08)' },
    2: { label:'L2 Weakness',     color:'#f97316', bg:'rgba(249,115,22,0.08)' },
    3: { label:'L3 Distribution', color:'#ef4444', bg:'rgba(239,68,68,0.08)'  },
    4: { label:'L4 Deterioration',color:'#dc2626', bg:'rgba(220,38,38,0.1)'   },
    5: { label:'L5 Exit',         color:'#7f1d1d', bg:'rgba(127,29,29,0.12)'  },
  };
  const decColor = s => s>=80?'#22c55e':s>=65?'#60a5fa':s>=50?'#e8a838':s>=35?'#f97316':'#ef4444';

  const byPie = {};
  latest.forEach(r => { const p = r.pie||'Individual'; if(!byPie[p]) byPie[p]=[]; byPie[p].push(r); });

  const pieSections = Object.entries(byPie)
    .sort(([,a],[,b]) => Math.min(...b.map(x=>x.sell_level)) - Math.min(...a.map(x=>x.sell_level)))
    .map(([pie, stocks]) => {
      const cards = stocks.map(h => {
        const dc  = decColor(h.score);
        const slm = sellLevelMeta[h.sell_level||0];
        const id  = `hd-${h.ticker.replace(/[^a-z0-9]/gi,'_')}`;
        const buySig = h.buy_signal || '';
        const buySigColor = buySig.startsWith('BUY')?'#22c55e':buySig.startsWith('WAIT')?'#e8a838':buySig.startsWith('AVOID')?'#ef4444':'#94a3b8';
        const factors = [
          ['Institutional',  h.inst_score,  20],
          ['Price Trend',    h.price_score, 20],
          ['Financial',      h.fin_score,   25],
          ['Valuation',      h.val_score,   15],
          ['Sector Outlook', h.sector_score,10],
          ['Risk',           h.risk_score,  10],
        ].map(([lbl,score,max]) => {
          const pct = Math.round((score/max)*100);
          const bc  = pct>=75?'#22c55e':pct>=50?'#60a5fa':'#e8a838';
          return `<div style="margin-bottom:4px">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted)">
              <span>${lbl}</span><span style="color:${bc}">${score}/${max}</span>
            </div>
            <div style="height:3px;background:#1e293b;border-radius:2px">
              <div style="width:${pct}%;height:100%;background:${bc};border-radius:2px"></div>
            </div>
          </div>`;
        }).join('');
        const techBadges = [
          h.rsi!=null ? `<span style="color:${h.rsi<40?'#22c55e':h.rsi>65?'#ef4444':'#e8a838'}">RSI ${h.rsi}</span>` : '',
          h.mom_4w!=null ? `<span style="color:${h.mom_4w>=0?'#22c55e':'#ef4444'}">${h.mom_4w>=0?'+':''}${h.mom_4w}% 4w</span>` : '',
          h.mom_1w!=null ? `<span style="color:${h.mom_1w>=0?'#22c55e':'#ef4444'}">${h.mom_1w>=0?'+':''}${h.mom_1w}% 1w</span>` : '',
          h.pct_from_high!=null ? `<span style="color:#94a3b8">${h.pct_from_high}% from 52w high</span>` : '',
          h.above_ma50!=null ? `<span style="color:${h.above_ma50?'#22c55e':'#ef4444'}">${h.above_ma50?'Above':'Below'} MA50</span>` : '',
        ].filter(Boolean).join(' · ');

        return `
          <div style="border:1px solid ${slm.color}33;border-radius:9px;overflow:hidden;margin-bottom:8px">
            <div onclick="toggleVB('${id}')" style="display:flex;align-items:center;gap:10px;padding:10px 13px;cursor:pointer;background:#0d1b2e">
              <div style="flex:1">
                <div style="font-weight:700;font-size:12px;color:#e2e8f0">${h.display||h.ticker}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px">${techBadges}</div>
              </div>
              ${h.sell_level?`<div style="font-size:10px;padding:2px 7px;border-radius:8px;background:${slm.bg};color:${slm.color};font-weight:600;white-space:nowrap">${slm.label}</div>`:''}
              <div style="text-align:center;min-width:46px">
                <div style="font-size:18px;font-weight:800;color:${dc}">${h.score}</div>
                <div style="font-size:9px;color:var(--muted)">/100</div>
              </div>
              <div style="font-size:9px;padding:2px 6px;border-radius:6px;background:${dc}22;color:${dc};white-space:nowrap">${h.decision}</div>
              <div style="color:var(--muted);font-size:11px" id="${id}-chevron">▼</div>
            </div>
            <div id="${id}" style="display:none;padding:10px 13px;border-top:1px solid #1e293b;background:#060f1e">
              <div style="padding:7px 10px;border-radius:7px;background:${buySigColor}11;border-left:2px solid ${buySigColor};margin-bottom:9px;font-size:11px;color:${buySigColor}">${buySig}</div>
              ${h.sell_signal?`<div style="padding:7px 10px;border-radius:7px;background:rgba(239,68,68,0.07);border-left:2px solid #ef4444;margin-bottom:9px;font-size:11px;color:#fca5a5">⚠️ ${h.sell_signal}</div>`:''}
              <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Score Breakdown</div>
              ${factors}
              ${h.notes?`<div style="margin-top:7px;font-size:10px;color:var(--muted)">${h.notes}</div>`:''}
            </div>
          </div>`;
      }).join('');

      return `
        <div style="margin-bottom:16px">
          <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #1e293b">
            ${pie} <span style="color:#334155;font-weight:400">(${stocks.length})</span>
          </div>
          ${cards}
        </div>`;
    }).join('');

  const legendHtml = Object.entries(sellLevelMeta).map(([lvl, m]) =>
    `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${m.bg};color:${m.color}">L${lvl} ${m.label}</span>`
  ).join(' ');

  const exits    = latest.filter(r => r.sell_level >= 4);
  const warns    = latest.filter(r => r.sell_level >= 1 && r.sell_level <= 3);
  const buys     = latest.filter(r => (r.buy_signal||'').startsWith('BUY'));
  const stripItems = [
    `<div class="stat-card"><div class="label">Holdings</div><div class="value">${latest.length}</div></div>`,
    `<div class="stat-card"><div class="label">🟢 Buy Signal</div><div class="value green">${buys.length}</div></div>`,
    `<div class="stat-card"><div class="label">⚠️ Warnings</div><div class="value" style="color:#e8a838">${warns.length}</div></div>`,
    `<div class="stat-card"><div class="label">🔴 Exit Alert</div><div class="value red">${exits.length}</div></div>`,
    `<div class="stat-card"><div class="label">Week of</div><div class="value" style="font-size:13px">${latestDate}</div></div>`,
  ].join('');

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:4px">📊 Holding Decisions</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px">Per-stock score out of 100 · 5-level sell framework · Buy / Wait / Hold / Avoid signals</div>
      <div class="stats-strip" style="margin-bottom:12px">${stripItems}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">${legendHtml}</div>
      <div style="font-size:10px;color:#334155;padding:6px 10px;background:#060f1e;border-radius:6px;margin-bottom:14px;line-height:1.6">
        <strong style="color:#475569">Selling discipline:</strong>
        Never sell a fundamentally strong holding solely on temporary institutional selling ·
        Sell when the thesis breaks, not just on price fall ·
        Review triggers at each level, not automatic stop-losses ·
        ETFs: ignore single-week outflows; act on sustained trends
      </div>
      ${pieSections}
    </div>`;
}

// ── STRATEGY ──────────────────────────────────────────────────
async function loadStrategy() {
  loadInstFlow();
  loadHoldingDecisions();

  if (IS_GUEST) {
    document.getElementById('strategy-content').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view strategy recommendations</div>';
    return;
  }
  const [stratRows, vbRows] = await Promise.all([
    api('strategy_recommendations','?select=*&order=updated_at.desc&limit=1'),
    api('value_buy_scores','?select=*&order=score.desc'),
  ]);
  const s = stratRows[0];
  const el = document.getElementById('strategy-content');

  const ratingMeta = {
    high:   { label:'Strong Buy', color:'#22c55e', bg:'rgba(34,197,94,0.1)',  dot:'🟢' },
    medium: { label:'Accumulate', color:'#e8a838', bg:'rgba(232,168,56,0.1)', dot:'🟡' },
    low:    { label:'Hold/Wait',  color:'#94a3b8', bg:'rgba(148,163,184,0.1)',dot:'⚪' },
  };
  const actionMeta = {
    'BUY NOW':      { color:'#22c55e', bg:'rgba(34,197,94,0.15)',   icon:'🚀' },
    'DCA — ADD':    { color:'#22c55e', bg:'rgba(34,197,94,0.1)',    icon:'📈' },
    'ACCUMULATE':   { color:'#60a5fa', bg:'rgba(96,165,250,0.1)',   icon:'🔵' },
    'WAIT FOR DIP': { color:'#e8a838', bg:'rgba(232,168,56,0.1)',   icon:'⏳' },
    'HOLD / AVOID': { color:'#94a3b8', bg:'rgba(148,163,184,0.1)', icon:'🛑' },
  };
  const safeJSON = (v, fallback) => {
    if (!v) return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fallback; }
  };

  let vbHtml = '';
  if (vbRows && vbRows.length) {
    const byPie = {};
    vbRows.forEach(v => { const p = v.pie||'Other'; if(!byPie[p]) byPie[p]=[]; byPie[p].push(v); });

    const pieSections = Object.entries(byPie).map(([pie, stocks]) => {
      const stockCards = stocks.map(v => {
        const zones    = safeJSON(v.entry_zones, []);
        const cards    = safeJSON(v.scorecard, []);
        const earn     = safeJSON(v.earnings, {});
        const tw       = safeJSON(v.this_week, {});
        const sym      = v.currency_symbol || '$';

        const scoreColor = v.score >= 75 ? '#22c55e' : v.score >= 55 ? '#e8a838' : '#ef4444';
        const am = actionMeta[tw.action] || actionMeta['HOLD / AVOID'];
        const id = `vb-${v.ticker.replace(/[^a-z0-9]/gi,'_')}`;

        const hasCost = tw.avg_cost && tw.avg_cost > 0;
        const diffPct = hasCost ? ((tw.current - tw.avg_cost) / tw.avg_cost * 100) : null;
        const costColor = diffPct === null ? '#94a3b8' : diffPct < 0 ? '#22c55e' : diffPct < 10 ? '#e8a838' : '#ef4444';

        const twBox = tw.action ? `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:${am.bg};border:1px solid ${am.color}33;margin-bottom:10px">
            <span style="font-size:18px">${am.icon}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:800;color:${am.color}">${tw.action}</div>
              <div style="font-size:11px;color:var(--muted)">Target entry: <strong style="color:#e2e8f0">${sym}${tw.price}</strong>
                ${hasCost ? `&nbsp;· Avg cost: <strong style="color:${costColor}">${sym}${tw.avg_cost} (${diffPct>=0?'+':''}${diffPct.toFixed(1)}%)</strong>` : ''}
                ${tw.rsi ? `&nbsp;· RSI: <strong style="color:${tw.rsi<40?'#22c55e':tw.rsi>65?'#ef4444':'#e8a838'}">${tw.rsi}</strong>` : ''}
              </div>
              ${(tw.rationale||[]).map(r=>`<div style="font-size:10px;color:var(--muted);margin-top:2px">· ${r}</div>`).join('')}
            </div>
          </div>` : '';

        const priceStats = tw.current ? `
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:10px;padding:8px;background:#0d1b2e;border-radius:6px">
            <span>Current <strong style="color:#e2e8f0">${sym}${tw.current}</strong></span>
            ${tw.ma20  ? `<span>MA20 <strong style="color:${tw.current>tw.ma20?'#22c55e':'#ef4444'}">${sym}${tw.ma20}</strong></span>` : ''}
            ${tw.ma50  ? `<span>MA50 <strong style="color:${tw.current>tw.ma50?'#22c55e':'#ef4444'}">${sym}${tw.ma50}</strong></span>` : ''}
            ${tw.low_52w  ? `<span>52w Low <strong style="color:#94a3b8">${sym}${tw.low_52w}</strong></span>` : ''}
            ${tw.high_52w ? `<span>52w High <strong style="color:#94a3b8">${sym}${tw.high_52w}</strong></span>` : ''}
            ${tw.vol_pct  ? `<span>Volatility <strong style="color:${tw.vol_pct>50?'#ef4444':tw.vol_pct>30?'#e8a838':'#22c55e'}">${tw.vol_pct}%</strong></span>` : ''}
          </div>` : '';

        const zonesHtml = zones.map(z => {
          const m = ratingMeta[z.rating] || ratingMeta.low;
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:${m.bg};margin-bottom:3px">
            <span style="font-size:11px;min-width:110px;color:#e2e8f0">${z.label}</span>
            <span style="font-size:11px;font-weight:600;color:${m.color};min-width:80px">${m.dot} ${m.label}</span>
            <span style="font-size:11px;color:var(--muted)">${z.note||''}</span>
          </div>`;
        }).join('');

        const scorecardHtml = cards.map(c => {
          const pct = Math.round((c.score/c.max)*100);
          const col = pct>=80?'#22c55e':pct>=55?'#e8a838':'#ef4444';
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <span style="font-size:11px;color:var(--muted);min-width:140px">${c.category}</span>
            <div style="flex:1;height:5px;background:#1e293b;border-radius:3px">
              <div style="width:${pct}%;height:100%;border-radius:3px;background:${col}"></div>
            </div>
            <span style="font-size:11px;color:${col};min-width:34px;text-align:right">${c.score}/${c.max}</span>
          </div>`;
        }).join('');

        const earnHtml = earn.period ? `
          <div style="margin-top:8px;padding:8px;background:#0d1b2e;border-radius:6px;font-size:11px">
            <div style="color:var(--muted);margin-bottom:5px;font-weight:600">${earn.period} Earnings</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              ${earn.revenue_growth_pct!=null?`<span>Revenue <strong style="color:${earn.revenue_growth_pct>=0?'#22c55e':'#ef4444'}">${earn.revenue_growth_pct>=0?'+':''}${earn.revenue_growth_pct}%</strong></span>`:''}
              ${earn.op_profit_growth_pct!=null?`<span>Op Profit <strong style="color:${earn.op_profit_growth_pct>=0?'#22c55e':'#ef4444'}">${earn.op_profit_growth_pct>=0?'+':''}${earn.op_profit_growth_pct}%</strong></span>`:''}
              ${earn.net_profit_growth_pct!=null?`<span>Net Profit <strong style="color:${earn.net_profit_growth_pct>=0?'#22c55e':'#ef4444'}">${earn.net_profit_growth_pct>=0?'+':''}${earn.net_profit_growth_pct}%</strong></span>`:''}
            </div>
          </div>` : '';

        return `
          <div style="border:1px solid #2d3353;border-radius:10px;overflow:hidden;margin-bottom:10px">
            <div onclick="toggleVB('${id}')" style="display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;user-select:none;background:#0d1b2e">
              <div style="flex:1">
                <div style="font-weight:700;font-size:13px;color:#e2e8f0">${v.display||v.ticker}</div>
                ${tw.action ? `<div style="font-size:11px;color:${am.color};margin-top:1px">${am.icon} ${tw.action}${tw.price?` · target ${sym}${tw.price}`:''}</div>` : ''}
              </div>
              <div style="text-align:center;min-width:52px">
                <div style="font-size:20px;font-weight:800;color:${scoreColor}">${v.score}</div>
                <div style="font-size:10px;color:var(--muted)">/ 100</div>
              </div>
              <div style="font-size:10px;font-weight:600;color:${scoreColor};padding:2px 7px;border-radius:10px;background:${scoreColor}22;white-space:nowrap">${v.verdict||'—'}</div>
              <div style="color:var(--muted);font-size:11px" id="${id}-chevron">▼</div>
            </div>
            <div id="${id}" style="display:none;padding:12px 14px;border-top:1px solid #2d3353">
              ${twBox}
              ${priceStats}
              <div class="m-grid2" style="gap:16px">
                <div>
                  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Entry Zones</div>
                  ${zonesHtml}
                  ${earnHtml}
                </div>
                <div>
                  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px">Score Breakdown</div>
                  ${scorecardHtml}
                </div>
              </div>
              ${v.warning ? `<div style="margin-top:10px;padding:9px 12px;background:rgba(239,68,68,0.07);border-left:3px solid #ef4444;border-radius:0 6px 6px 0;font-size:11px;color:#fca5a5">⚠️ ${v.warning}</div>` : ''}
              ${v.notes   ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);line-height:1.6">${v.notes}</div>` : ''}
              <div style="margin-top:8px;font-size:10px;color:#334155">Updated ${new Date(v.updated_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
            </div>
          </div>`;
      }).join('');

      return `
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #1e293b">${pie} <span style="color:#334155;font-weight:400">(${stocks.length} stock${stocks.length>1?'s':''})</span></div>
          ${stockCards}
        </div>`;
    }).join('');

    vbHtml = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <h3 style="margin:0">🎯 Entry Analysis</h3>
          <span style="font-size:11px;color:var(--muted)">PWI Scout · RSI · MA · 52w range · avg cost</span>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:14px">Live analysis — click any stock to see entry zones, this-week target price and risk scorecard.</div>
        ${pieSections}
      </div>`;
  }

  let stratHtml = '';
  if (s) {
    const recs = s.recommendations || [];
    const notes = s.notes || [];
    const onTrack = s.on_track;
    const mood = s.market_mood || {};
    const moodIcon = ['😎','🙂','😨','😱'][mood.level ?? 1];
    const annTxt = s.annualised_return == null ? '—' : fmt(s.annualised_return)+'%';
    stratHtml = `
      <div class="stats-strip" style="margin-bottom:16px">
        <div class="stat-card"><div class="label">Week</div><div class="value">${s.week_number} of ${s.weeks_in_month||4}</div><div class="sub">Aggressive</div></div>
        <div class="stat-card"><div class="label">This week</div><div class="value green">£${s.total_suggested}</div><div class="sub">of £300/month</div></div>
        <div class="stat-card"><div class="label">Market mood</div><div class="value">${moodIcon} ${mood.label||'—'}</div><div class="sub">VIX ${mood.vix ?? '—'}</div></div>
        <div class="stat-card"><div class="label">Annualised</div><div class="value ${s.annualised_return==null?'':clr(s.annualised_return)}">${annTxt}</div><div class="sub">${onTrack==null?'Building history':onTrack?'✓ Above 10% base':'✗ Below 10% base'} · stretch 15%</div></div>
      </div>
      <div class="card"><h3>Recommendations</h3>
        ${recs.map(r=>`<div class="rec-card priority-${r.priority||'LOW'}">
          <div><div class="rec-pie">${r.pie}</div><div class="rec-reason">${r.reason||''}</div></div>
          <div class="rec-amount">£${r.amount}</div>
        </div>`).join('')}
      </div>
      ${notes.length?`<div class="card"><h3>Notes</h3>${notes.map(n=>`<div style="font-size:12px;color:var(--muted);padding:3px 0">${n}</div>`).join('')}</div>`:''}`;
  } else if (!vbRows.length) {
    stratHtml = '<div class="loading">No strategy data yet. Run the daily_services workflow.</div>';
  }

  el.innerHTML = vbHtml + stratHtml;
}

function toggleVB(id) {
  const el = document.getElementById(id);
  const ch = document.getElementById(id+'-chevron');
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (ch) ch.textContent = open ? '▼' : '▲';
}
