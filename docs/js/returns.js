// ── RETURNS ───────────────────────────────────────────────────
// Built from your real Trading 212 money flows (services/returns_service.py): every deposit, withdrawal,
// trade, dividend and interest payment. Profit = account value − money you've put in (deposits − withdrawals).
const RT = { period: 'All', charts: [] };
const RT_UP = '#0ca30c', RT_DOWN = '#e66767', RT_LINE = '#3987e5', RT_MUTED = '#8892a4';

function rtGbp(v, sign) {
  if (IS_GUEST) return '£***';
  if (v == null) return '—';
  const s = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '£' + s;
}
const rtPct = (v, sign = true) => v == null ? '—' : `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}${Math.abs(v).toFixed(2)}%`;
const rtCls = v => v == null ? '' : v >= 0 ? 'green' : 'red';
const rtMonth = k => new Date(k + '-01T00:00:00').toLocaleString('en-GB', { month: 'short', year: '2-digit' });

async function loadReturns() {
  const el = document.getElementById('returns-content');
  const [rows, realisedRows, divRows] = await Promise.all([
    api('returns_summary', '?select=*&limit=1'),
    api('realised_pnl', '?select=*&order=filled_date.desc&limit=100'),
    api('dividends', '?select=*&order=paid_date.desc&limit=100'),
  ]);
  const r = rows[0], d = r?.details;
  if (!d) { el.innerHTML = '<div class="loading">Returns are rebuilt each morning from your Trading 212 history — check back after the next run.</div>'; return; }
  RT.d = d; RT.r = r;
  const p = d.profit, m = d.money_in;
  const since = new Date(d.since).toLocaleString('en-GB', { month: 'short', year: 'numeric' });

  const parts = [
    ['Open positions', 'gain on what you hold now', p.unrealised],
    ['Sold positions', 'gains locked in when you sold', p.realised],
    ['Dividends', 'paid into your account', p.dividends],
    ['Interest on cash', 'on uninvested cash', p.interest],
    ...(Math.abs(p.other || 0) >= 0.01 ? [['Other', 'adjustments', p.other]] : []),
    ['Fees & FX costs', 'currency conversion, stamp duty', p.costs],
  ];
  const maxAbs = Math.max(...parts.map(x => Math.abs(x[2] || 0)), 1);

  const years = Object.keys(r.yearly_breakdown || {}).sort().reverse();
  el.innerHTML = `
    <div class="card rt-hero">
      <div class="w-dim w-small">TOTAL PROFIT · since ${since}</div>
      <div class="rt-big ${rtCls(p.total)}">${rtGbp(p.total, true)}</div>
      <div class="rt-sub"><span class="${rtCls(p.pct_of_net_in)}">${rtPct(p.pct_of_net_in)}</span> on ${rtGbp(m.net)} you've put in · account now ${rtGbp(d.account_value)}</div>
    </div>

    <div class="card">
      <div class="rt-head"><h3>Profit by period</h3></div>
      <div class="dd-ranges rt-periods">${d.periods.map(x => `<button class="${RT.period === x.label ? 'active' : ''}" onclick="RT.period='${x.label}'; rtPeriod()">${x.label}</button>`).join('')}</div>
      <div id="rt-period"></div>
    </div>

    <div class="grid2 rt-rates">
      <div class="card"><div class="w-dim w-small">YOUR YEARLY GROWTH RATE</div>
        <div class="rt-mid ${rtCls(d.xirr_pct)}">${rtPct(d.xirr_pct)} <span class="rt-unit">a year</span></div>
        <div class="w-dim w-small">What your money has actually earned per year, counting when each deposit went in (money-weighted, XIRR).</div></div>
      <div class="card"><div class="w-dim w-small">HOW YOUR INVESTMENTS DID</div>
        <div class="rt-mid ${rtCls(d.twr_pct)}">${rtPct(d.twr_pct)} <span class="rt-unit">since ${since}</span></div>
        <div class="w-dim w-small">Performance of your picks, ignoring when you added money (time-weighted)${d.twr_annual_pct != null ? ` — ${rtPct(d.twr_annual_pct)} a year` : ''}.</div></div>
    </div>

    <div class="card"><h3>Account value vs money put in</h3>
      <div class="rt-legend"><span><i style="background:${RT_LINE}"></i>Account value</span><span><i class="dash"></i>Money put in</span><span class="w-dim">gap = profit</span></div>
      <div class="rt-chart"><canvas id="rt-value-chart"></canvas></div>
    </div>

    <div class="grid2">
      <div class="card"><h3>Where the profit came from</h3>
        ${parts.map(([k, sub, v]) => `<div class="rt-part">
          <div class="rt-part-l"><div>${k}</div><div class="w-dim w-small">${sub}</div></div>
          <div class="rt-part-bar"><span class="${(v || 0) >= 0 ? 'up' : 'down'}" style="width:${Math.abs(v || 0) / maxAbs * 100}%"></span></div>
          <div class="rt-part-v ${rtCls(v)}">${rtGbp(v, true)}</div></div>`).join('')}
        <div class="rt-part rt-total"><div class="rt-part-l"><b>Total profit</b></div><div></div><div class="rt-part-v ${rtCls(p.total)}"><b>${rtGbp(p.total, true)}</b></div></div>
      </div>
      <div class="card"><h3>Money in</h3>
        <div class="rt-kv"><span>Deposited <span class="w-dim w-small">(${m.deposits} deposits)</span></span><b>${rtGbp(m.deposited)}</b></div>
        <div class="rt-kv"><span>Withdrawn</span><b>${rtGbp(m.withdrawn ? -m.withdrawn : 0)}</b></div>
        <div class="rt-kv rt-total"><span>Net put in</span><b>${rtGbp(m.net)}</b></div>
        <div class="rt-kv"><span>Invested now</span><span>${rtGbp(d.holdings_value)}</span></div>
        <div class="rt-kv"><span>Cash</span><span>${rtGbp(d.cash)}</span></div>
      </div>
    </div>

    <div class="card"><h3>Year by year</h3>
      <table class="pb-rules rt-years"><tr><th>Year</th><th>Added</th><th>Profit</th><th>Return</th><th>Value</th></tr>
      ${years.map(y => { const x = r.yearly_breakdown[y]; return `<tr><td>${y}</td><td>${rtGbp(x.net_added, true)}</td>
        <td class="${rtCls(x.profit)}">${rtGbp(x.profit, true)}</td><td class="${rtCls(x.twr_pct)}">${rtPct(x.twr_pct)}</td><td>${rtGbp(x.end_value)}</td></tr>`; }).join('')}
      </table>
      <div class="w-dim w-small" style="margin-top:6px">Profit = change in value minus money added. Return = time-weighted, so deposits don't inflate it.</div>
    </div>

    <div class="card"><h3>Monthly profit</h3><div class="rt-chart"><canvas id="rt-month-chart"></canvas></div></div>

    <div class="grid2">
      <div class="card"><h3>Recent closed trades</h3>
        <div class="w-dim w-small" style="margin-bottom:6px">All-time realised: <span class="${rtCls(p.realised)}">${rtGbp(p.realised, true)}</span></div>
        ${IS_GUEST ? '<div class="w-dim">🔒 Sign in to view closed trades.</div>' : rtTable(realisedRows.filter(x => (x.side || '').includes('SELL')).slice(0, 40),
          ['Holding', 'Date', 'P&L'], x => [x.display || x.ticker, x.filled_date || '—', `<span class="${rtCls(+x.realised_pnl)}">${rtGbp(+x.realised_pnl, true)}</span>`])}
      </div>
      <div class="card"><h3>Recent dividends</h3>
        <div class="w-dim w-small" style="margin-bottom:6px">All-time: <span class="green">${rtGbp(p.dividends)}</span></div>
        ${IS_GUEST ? '<div class="w-dim">🔒 Sign in to view dividends.</div>' : rtTable(divRows.slice(0, 40),
          ['Holding', 'Date', 'Amount'], x => [x.display || x.ticker, x.paid_date || '—', `<span class="green">£${(+x.amount || 0).toFixed(2)}</span>`])}
      </div>
    </div>
    <div class="w-dim w-small dd-foot">Rebuilt from your Trading 212 deposits, withdrawals, trades, dividends and interest · cash reconciles to Trading 212 ${d.check && Math.abs(d.check.cash_rebuilt - d.check.cash_t212) < 0.05 ? 'to the penny' : 'within £' + Math.abs(d.check.cash_rebuilt - d.check.cash_t212).toFixed(2)} · updated ${new Date(d.as_of).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`;

  rtPeriod();
  rtCharts();
}

function rtTable(rows, head, cells) {
  if (!rows.length) return '<div class="w-dim">None yet.</div>';
  return `<table class="pb-rules"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(x => `<tr>${cells(x).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

function rtPeriod() {
  const x = RT.d.periods.find(p => p.label === RT.period) || RT.d.periods[RT.d.periods.length - 1];
  document.querySelectorAll('.rt-periods button').forEach(b => b.classList.toggle('active', b.textContent === x.label));
  const f = s => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('rt-period').innerHTML = `
    <div class="rt-prow"><div class="rt-mid ${rtCls(x.profit)}">${rtGbp(x.profit, true)}</div><div class="rt-pp ${rtCls(x.twr_pct)}">${rtPct(x.twr_pct)}</div></div>
    <div class="w-dim w-small">${f(x.from)} → ${f(x.to)} · value ${rtGbp(x.start_value)} → ${rtGbp(x.end_value)} · you added ${rtGbp(x.net_added, true)}</div>`;
}

function rtCharts() {
  RT.charts.forEach(c => c.destroy()); RT.charts = [];
  if (typeof Chart === 'undefined') return;
  const s = RT.d.series, grid = '#2d3353';
  const money = v => IS_GUEST ? '£***' : '£' + Math.round(v).toLocaleString('en-GB');
  RT.charts.push(new Chart(document.getElementById('rt-value-chart'), {
    type: 'line',
    data: { labels: s.dates, datasets: [
      { label: 'Account value', data: s.value, borderColor: RT_LINE, borderWidth: 2, pointRadius: 0, tension: 0.2,
        fill: { target: 1, above: 'rgba(12,163,12,.14)', below: 'rgba(230,103,103,.16)' } },
      { label: 'Money put in', data: s.net_in, borderColor: RT_MUTED, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, stepped: true },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: i => new Date(i[0].label).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        label: c => `${c.dataset.label}: ${money(c.raw)}`,
        footer: i => { const v = i.find(x => x.datasetIndex === 0)?.raw, n = i.find(x => x.datasetIndex === 1)?.raw; return v != null && n != null ? `Profit: ${IS_GUEST ? '£***' : (v - n >= 0 ? '+' : '−') + '£' + Math.abs(Math.round(v - n)).toLocaleString('en-GB')}` : ''; } } } },
      scales: { x: { type: 'category', ticks: { color: RT_MUTED, maxTicksLimit: 6, callback(v) { return new Date(this.getLabelForValue(v)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); } }, grid: { display: false } },
                y: { ticks: { color: RT_MUTED, callback: v => money(v), maxTicksLimit: 5 }, grid: { color: grid } } } },
  }));
  const months = Object.keys(RT.r.monthly_breakdown || {}).sort().slice(-24);
  const vals = months.map(k => RT.r.monthly_breakdown[k].profit);
  RT.charts.push(new Chart(document.getElementById('rt-month-chart'), {
    type: 'bar',
    data: { labels: months.map(rtMonth), datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? RT_UP : RT_DOWN), borderRadius: 4, maxBarThickness: 18 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => {
        const x = RT.r.monthly_breakdown[months[c.dataIndex]];
        return [`Profit: ${rtGbp(x.profit, true)}`, `Return: ${rtPct(x.twr_pct)}`, `Added: ${rtGbp(x.net_added, true)}`]; } } } },
      scales: { x: { ticks: { color: RT_MUTED, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
                y: { ticks: { color: RT_MUTED, callback: v => money(v), maxTicksLimit: 5 }, grid: { color: grid } } } },
  }));
}
