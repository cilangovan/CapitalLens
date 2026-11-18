// ── ANALYST ───────────────────────────────────────────────────

// Peter Lynch six buckets: colours and wording follow the reference card (1 green .. 6 red)
const LYNCH = { 0: ['Fund / ETF', '#64748b'], 1: ['1 Fast Grower', '#22c55e'], 2: ['2 Stalwart', '#86efac'], 3: ['3 Cyclical', '#eab308'], 4: ['4 Slow Grower', '#fde68a'], 5: ['5 Turnaround', '#d946ef'], 6: ['6 Asset Play', '#ef4444'] };
function lynchBadge(r) {
  if (r.lynch_bucket === undefined) return '<span style="color:var(--muted)" title="Run Refresh to classify">—</span>';
  if (r.lynch_bucket === null) return '<span style="color:var(--muted)" title="' + (r.lynch_reason || 'No data') + '">?</span>';
  const [name, col] = LYNCH[r.lynch_bucket] || ['?', '#64748b'];
  return `<span title="${(r.lynch_reason || '').replace(/"/g, '&quot;')} (confidence: ${r.lynch_confidence || '?'})" style="display:inline-block;padding:2px 8px;border-radius:999px;background:${col}22;border:1px solid ${col};color:${col};font-size:11px;white-space:nowrap">${name}</span>`;
}
function lynchSummary(rows) {
  const has = rows.some(r => r.lynch_bucket !== undefined);
  if (!has) return '<div style="color:var(--muted);font-size:12px;padding:6px 0">Peter Lynch buckets appear after the next Refresh.</div>';
  const pies = {}; rows.forEach(r => { (pies[r.pie || 'Solo holdings'] = pies[r.pie || 'Solo holdings'] || []).push(r); });
  const legend = Object.entries(LYNCH).filter(([k]) => k !== '0').map(([k, [n, c]]) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;color:var(--muted)"><i style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block"></i>${n}</span>`).join('');
  const cards = Object.entries(pies).map(([pie, rs]) => {
    const groups = {}; rs.forEach(r => { const k = r.lynch_bucket === undefined || r.lynch_bucket === null ? '?' : r.lynch_bucket; (groups[k] = groups[k] || []).push(r.ticker); });
    const short = t => String(t).replace(/_(US_)?EQ$/, '').replace(/([a-z])$/, '');
    return `<div class="card"><h3>${pie}</h3>` + Object.keys(groups).sort().map(k => { const [n, c] = LYNCH[k] || ['Unclassified', '#64748b']; return `<div style="font-size:12px;margin:3px 0"><span style="color:${c};font-weight:600">${n}</span> <span style="color:var(--muted)">${groups[k].map(short).join(', ')}</span></div>`; }).join('') + '</div>';
  }).join('');
  return `<h3 style="margin:18px 0 6px">Peter Lynch buckets</h3><div style="margin-bottom:8px">${legend}</div><div class="pie-ratings-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">${cards}</div>
  <div style="font-size:11px;color:var(--muted);margin-top:6px">Rule-based estimate from public fundamentals (growth, profit margin, book value, sector). Hover a badge for the reason. A screening aid, not advice.</div>`;
}
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
    <thead><tr><th>Ticker</th><th>Pie</th><th>Lynch</th><th>Rating</th><th>Stars</th><th>Analysts</th><th>Target</th><th>Buy%</th><th>Hold%</th><th>Sell%</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><strong>${r.ticker}</strong></td>
      <td style="color:var(--muted)">${r.pie||'—'}</td>
      <td>${lynchBadge(r)}</td>
      <td>${badgeRating(r)}</td>
      <td><span class="stars">${stars(r.star_rating)}</span></td>
      <td>${r.source === 'trend' ? '<span style="color:var(--muted)">none</span>' : (r.analyst_count || '—')}</td>
      <td>${fmtTarget(r.target_mean, r.yahoo_ticker)}</td>
      ${r.source === 'trend' ? '<td colspan="3" style="color:var(--muted);font-size:12px">trend score — no analyst votes</td>'
        : `<td class="green">${r.buy_pct != null ? r.buy_pct+'%' : '—'}</td>
      <td class="yellow">${r.hold_pct != null ? r.hold_pct+'%' : '—'}</td>
      <td class="red">${r.sell_pct != null ? r.sell_pct+'%' : '—'}</td>`}
    </tr>`).join('')}</tbody></table>`;
  // phones: one compact card per holding (the 9-column table doesn't fit a narrow screen)
  const short = t => String(t).replace(/_(US_)?EQ$/, '').replace(/([a-z])$/, '');
  const cardsHtml = `<div class="an-cards">${rows.map(r => {
    const trend = r.source === 'trend';
    const votes = trend ? '' : `<div class="an-bar" title="Buy ${r.buy_pct ?? 0}% · Hold ${r.hold_pct ?? 0}% · Sell ${r.sell_pct ?? 0}%">
        <span style="width:${+r.buy_pct || 0}%" class="b"></span><span style="width:${+r.hold_pct || 0}%" class="h"></span><span style="width:${+r.sell_pct || 0}%" class="s"></span></div>
      <div class="an-votes"><span class="green">Buy ${r.buy_pct ?? '—'}%</span><span class="yellow">Hold ${r.hold_pct ?? '—'}%</span><span class="red">Sell ${r.sell_pct ?? '—'}%</span></div>`;
    return `<div class="an-card">
      <div class="an-top"><strong>${short(r.ticker)}</strong><span class="stars">${stars(r.star_rating)}</span></div>
      <div class="an-mid">${badgeRating(r)} ${lynchBadge(r)}<span class="an-meta">${r.pie || '—'}</span></div>
      <div class="an-meta">${trend ? 'Trend score — no analyst coverage' : `${r.analyst_count || '—'} analysts · target ${fmtTarget(r.target_mean, r.yahoo_ticker)}`}</div>
      ${votes}
    </div>`;
  }).join('')}</div>`;
  document.getElementById('analyst-table-wrap').innerHTML = `${lynchSummary(rows)}<h3 style="margin:18px 0 6px">Ratings</h3><div class="an-tablewrap">${tableHtml}</div>${cardsHtml}`;
}
