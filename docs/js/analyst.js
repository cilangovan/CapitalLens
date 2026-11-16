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
    ? new Set((await api('positions', `?snapshot_id=eq.${snap.id}&select=display`)).map(p => p.display))
    : new Set();

  const allRows = await api('analyst_ratings','?select=*&order=star_rating.desc');
  // Filter to tickers present in current holdings (match on display symbol)
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
    const avgBuy = (tickers.reduce((s,t) => s + (t.buy_pct||0), 0) / tickers.length).toFixed(0);
    return `<div class="card">
      <h3>${pie}</h3>
      <div style="font-size:22px;color:var(--yellow)">${'★'.repeat(Math.round(avgStar))}${'☆'.repeat(5-Math.round(avgStar))}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">⭐ ${avgStar} avg · ${avgBuy}% buy</div>
    </div>`;
  }).join('');

  const tableHtml = `<table class="analyst-table">
    <thead><tr><th>Ticker</th><th>Pie</th><th>Rating</th><th>Stars</th><th>Target</th><th>Buy%</th><th>Hold%</th><th>Sell%</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><strong>${r.ticker}</strong></td>
      <td style="color:var(--muted)">${r.pie||'—'}</td>
      <td>${badgeRec(r.recommendation)}</td>
      <td><span class="stars">${stars(r.star_rating)}</span></td>
      <td>${r.target_mean ? '£'+Number(r.target_mean).toFixed(2) : '—'}</td>
      <td class="green">${r.buy_pct != null ? r.buy_pct+'%' : '—'}</td>
      <td class="yellow">${r.hold_pct != null ? r.hold_pct+'%' : '—'}</td>
      <td class="red">${r.sell_pct != null ? r.sell_pct+'%' : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
  document.getElementById('analyst-table-wrap').innerHTML = tableHtml;
}
