// ── ANALYST ───────────────────────────────────────────────────
async function loadAnalyst() {
  if (IS_GUEST) {
    document.getElementById('pie-ratings').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view analyst ratings</div>';
    document.getElementById('analyst-table-wrap').innerHTML = '';
    return;
  }

  // Get current snapshot to filter analyst ratings to active positions only
  const snap = (await api('portfolio_snapshots','?select=id&order=created_at.desc&limit=1'))[0];
  const activeTickers = snap
    ? new Set((await api('positions', `?snapshot_id=eq.${snap.id}&select=ticker`)).map(p => p.ticker))
    : new Set();

  const allRows = await api('analyst_ratings','?select=*&order=star_rating.desc');
  // Keep only ratings for current holdings (keyed by T212 ticker)
  const rows = activeTickers.size
    ? allRows.filter(r => activeTickers.has(r.ticker))
    : allRows;

  const byPie = {};
  rows.forEach(r => {
    if (!byPie[r.pie]) byPie[r.pie] = [];
    byPie[r.pie].push(r);
  });

  const pieRatingsEl = document.getElementById('pie-ratings');
  pieRatingsEl.innerHTML = Object.entries(byPie).map(([pie, tickers]) => {
    const avgStar = (tickers.reduce((s,t) => s + (t.star_rating||0), 0) / tickers.length).toFixed(1);
    const covered = tickers.filter(t => t.source !== 'trend');
    const avgBuy = covered.length ? (covered.reduce((s,t) => s + (t.buy_pct||0), 0) / covered.length).toFixed(0) : null;
    const nTrend = tickers.length - covered.length;
    return `<div class="card">
      <h3>${pie}</h3>
      <div style="font-size:22px;color:var(--yellow)">${'★'.repeat(Math.round(avgStar))}${'☆'.repeat(5-Math.round(avgStar))}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">⭐ ${avgStar} avg${avgBuy != null ? ` · ${avgBuy}% analysts buy` : ''}${nTrend ? ` · ${nTrend} trend-rated (no analysts)` : ''}</div>
    </div>`;
  }).join('');

  const tableHtml = `<table class="analyst-table">
    <thead><tr><th>Ticker</th><th>Pie</th><th>Rating</th><th>Stars</th><th>Analysts</th><th>Target</th><th>Buy%</th><th>Hold%</th><th>Sell%</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><strong>${r.ticker}</strong></td>
      <td style="color:var(--muted)">${r.pie||'—'}</td>
      <td>${badgeRating(r)}</td>
      <td><span class="stars">${stars(r.star_rating)}</span></td>
      <td>${r.source === 'trend' ? '<span style="color:var(--muted)">none</span>' : (r.analyst_count || '—')}</td>
      <td>${fmtTarget(r.target_mean, r.yahoo_ticker)}</td>
      ${r.source === 'trend' ? '<td colspan="3" style="color:var(--muted);font-size:12px">trend score — no analyst votes</td>'
        : `<td class="green">${r.buy_pct != null ? r.buy_pct+'%' : '—'}</td>
      <td class="yellow">${r.hold_pct != null ? r.hold_pct+'%' : '—'}</td>
      <td class="red">${r.sell_pct != null ? r.sell_pct+'%' : '—'}</td>`}
    </tr>`).join('')}</tbody></table>`;
  document.getElementById('analyst-table-wrap').innerHTML = tableHtml;
}
