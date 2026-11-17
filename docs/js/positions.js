// ── POSITIONS ─────────────────────────────────────────────────
async function loadPositions() {
  if (IS_GUEST) {
    document.getElementById('positions-list').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view holdings</div>';
    return;
  }
  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) return;
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*`);
  const analystRows = await api('analyst_ratings','?select=ticker,star_rating,recommendation,source').catch(()=>[]);
  const analystMap = {};
  analystRows.forEach(a => { analystMap[a.ticker] = a; });

  const groups = {};
  positions.forEach(p => {
    const pie = p.pie || 'Solo';
    if (!groups[pie]) groups[pie] = [];
    groups[pie].push(p);
  });

  const container = document.getElementById('positions-list');
  container.innerHTML = '';
  PD.snap = null;                                   // drill-down reloads fresh data
  const meta = snap.raw?.instrument_meta || {};
  // T212 quotes prices in the instrument currency (GBX = pence). Show them that way, not as £.
  const fmtQuote = (v, t) => {
    if (v == null) return '—';
    const c = meta[t]?.ccy;
    if (c === 'GBX' || c === 'GBp') return Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + 'p';
    const sym = { GBP: '£', USD: '$', EUR: '€' }[c];
    return sym ? sym + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Number(v).toFixed(2) + (c ? ' ' + c : '');
  };
  const pieLive = name => (typeof pdLive === 'function') ? pdLive(snap.raw?.pies, name) : null;
  const all = pieLive('__ALL__');
  if (all && all.value) {
    const ror = all.invested ? all.result / all.invested * 100 : null;
    const card = document.createElement('div');
    card.className = 'card pd-allcard';
    card.setAttribute('role', 'button');
    card.onclick = () => pdOpen('__ALL__');
    card.innerHTML = `<div class="w-dim w-small">ALL POSITIONS · tap for chart</div>
      <div class="pd-allrow"><span class="pd-allval">${fmtGbpPlain(all.value)}</span>
      <span class="${clr(all.result)}">${pdArrow(ror)} ${ror != null ? Math.abs(ror).toFixed(1) + '%' : '—'} · ${fmtGbpPlain(all.result)}</span>
      <span class="w-chev">›</span></div>`;
    container.appendChild(card);
  }

  Object.entries(groups).forEach(([pieName, pos]) => {
    const totalPpl = pos.reduce((s,p) => s + (p.ppl||0), 0);
    const pl = pieLive(pieName);
    const pror = pl && pl.invested ? pl.result / pl.invested * 100 : null;
    const div = document.createElement('div');
    div.className = 'pie-group';
    div.innerHTML = `
      <div class="pie-header" onclick="togglePie(this)">
        <span class="pie-name"><a href="#positions/${encodeURIComponent(pieName)}" class="w-link" onclick="pdOpen('${pieName.replace(/'/g, "\\'")}', null, event)">${pieName}</a></span>
        <span class="pie-meta">${pl && pl.value ? `${fmtGbpPlain(pl.value)} · <span class="${clr(pror)}">${pdArrow(pror)} ${pror != null ? Math.abs(pror).toFixed(1) + '%' : ''}</span> · ` : ''}${pos.length} holdings · P&amp;L <span class="${clr(totalPpl)}">${fmtGbpPlain(totalPpl)}</span>
          <button class="pd-chartbtn" title="Chart & returns" onclick="pdOpen('${pieName.replace(/'/g, "\\'")}', null, event)">📈</button></span>
      </div>
      <div class="pie-body">
        <div class="pos-row">
          <span class="pos-head">Ticker</span>
          <span class="pos-head">Price</span>
          <span class="pos-head">Avg</span>
          <span class="pos-head">Gain %</span>
          <span class="pos-head">Dip</span>
          <span class="pos-head">Analyst</span>
        </div>
        ${pos.map(p => {
          const a = analystMap[p.ticker] || {};
          const analystHtml = a.star_rating
            ? `<span class="stars">${'★'.repeat(a.star_rating)}</span> ${badgeRating(a)}`
            : '—';
          const pplCell = IS_GUEST
            ? `<span class="masked">***</span>`
            : `<span class="${clr(p.gain_pct)}">${fmt(p.gain_pct)}%</span>`;
          return `<div class="pos-row">
            <span><a href="#positions/${encodeURIComponent(p.ticker)}" class="w-link" onclick="pdOpen('${(p.pie || '__ALL__').replace(/'/g, "\\'")}','${p.ticker}', event)">${p.display||p.ticker}</a></span>
            <span>${fmtQuote(p.current_price, p.ticker)}</span>
            <span>${fmtQuote(p.avg_price, p.ticker)}</span>
            ${pplCell}
            <span class="${clr(p.dip_from_high)}">${fmt(p.dip_from_high)}%</span>
            <span>${analystHtml}</span>
          </div>`;
        }).join('')}
      </div>`;
    container.appendChild(div);
  });
}

function togglePie(header) {
  header.nextElementSibling.classList.toggle('open');
}
