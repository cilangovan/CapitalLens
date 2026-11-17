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

  Object.entries(groups).forEach(([pieName, pos]) => {
    const totalPpl = pos.reduce((s,p) => s + (p.ppl||0), 0);
    const div = document.createElement('div');
    div.className = 'pie-group';
    div.innerHTML = `
      <div class="pie-header" onclick="togglePie(this)">
        <span class="pie-name">${pieName}</span>
        <span class="pie-meta">${pos.length} holdings · P&amp;L <span class="${clr(totalPpl)}">${fmtGbpPlain(totalPpl)}</span></span>
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
            <span>${p.display||p.ticker}</span>
            <span>${fmtGbp(p.current_price)}</span>
            <span>${fmtGbp(p.avg_price)}</span>
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
