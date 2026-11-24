// ── RETURNS ───────────────────────────────────────────────────
// Built from your real Trading 212 money flows (services/returns_service.py): every deposit, withdrawal,
// trade, dividend and interest payment. Profit = account value − money you've put in (deposits − withdrawals).
const RT = { period: 'All', charts: [] };
const RT_UP = '#0ca30c', RT_DOWN = '#e66767', RT_LINE = '#3987e5';


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
      <div class="dd-ranges rt-periods">${d.periods.map(x => `<button class="${RT.period === x.label ? 'active' : ''}" onclick="rtSetPeriod('${x.label.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">${esc(x.label)}</button>`).join('')}</div>
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

    <div class="card"><h3>Profit over time</h3>
      <div class="rt-chartbar">
        <div class="dd-ranges rt-views">
          <button data-v="profit" onclick="rtSetView('profit')">Profit £</button>
          <button data-v="value" onclick="rtSetView('value')">Value vs money in</button>
        </div>
        <div class="dd-ranges rt-ranges">${['1D', '1W', '1M', '3M', '6M', '9M', 'YTD', '1Y', 'All'].map(r => `<button data-r="${r}" onclick="rtSetRange('${r}')">${r}</button>`).join('')}</div>
      </div>
      <div id="rt-vc-head" class="rt-vc-head"></div>
      <div class="rt-chart"><canvas id="rt-value-chart"></canvas></div>
      <div id="rt-vc-note" class="w-dim w-small" style="margin-top:6px"></div>
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
    <div class="w-dim w-small dd-foot">Rebuilt from your Trading 212 deposits, withdrawals, trades, dividends and interest · ${rtCheckText(d.check)} · updated ${new Date(d.as_of).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`;

  rtPeriod();
  rtCharts();
}

// Cash reconciliation footer. `check` is missing on rows not written by the real pipeline (e.g. the demo seed): say so, never crash or fake "to the penny".
function rtCheckText(check) {
  if (!check || !Number.isFinite(+check.cash_rebuilt) || !Number.isFinite(+check.cash_t212)) return 'cash reconciliation not available for this data';
  const diff = Math.abs(check.cash_rebuilt - check.cash_t212);
  return 'cash reconciles to Trading 212 ' + (diff < 0.05 ? 'to the penny' : 'within £' + diff.toFixed(2));
}
function rtTable(rows, head, cells) {
  if (!rows.length) return '<div class="w-dim">None yet.</div>';
  return `<table class="pb-rules"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(x => `<tr>${cells(x).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

function rtSetPeriod(label) { RT.period = label; rtPeriod(); }
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
  const s = RT.d.series, grid = clv('--border');
  const money = v => IS_GUEST ? '£***' : '£' + Math.round(v).toLocaleString('en-GB');
  rtValueChart();
  const months = Object.keys(RT.r.monthly_breakdown || {}).sort().slice(-24);
  const vals = months.map(k => RT.r.monthly_breakdown[k].profit);
  RT.charts.push(new Chart(document.getElementById('rt-month-chart'), {
    type: 'bar',
    data: { labels: months.map(rtMonth), datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? RT_UP : RT_DOWN), borderRadius: 4, maxBarThickness: 18 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => {
        const x = RT.r.monthly_breakdown[months[c.dataIndex]];
        return [`Profit: ${rtGbp(x.profit, true)}`, `Return: ${rtPct(x.twr_pct)}`, `Added: ${rtGbp(x.net_added, true)}`]; } } } },
      scales: { x: { ticks: { color: clv('--muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
                y: { ticks: { color: clv('--muted'), callback: v => money(v), maxTicksLimit: 5 }, grid: { color: grid } } } },
  }));
}

// ── Value / profit chart ──────────────────────────────────────
RT.view = 'profit'; RT.range = 'All';
function rtSetView(v) { RT.view = v; rtValueChart(); }
function rtSetRange(r) { RT.range = r; rtValueChart(); }

function rtSlice() {
  const s = RT.d.series, n = s.dates.length;
  const last = new Date(s.dates[n - 1]);
  let from = null;
  if (RT.range === 'YTD') from = new Date(last.getFullYear(), 0, 1);
  else if (RT.range === '1D' || RT.range === '1W') { from = new Date(last); from.setDate(from.getDate() - (RT.range === '1D' ? 1 : 7)); }
  else if (RT.range !== 'All') { const m = { '1M': 1, '3M': 3, '6M': 6, '9M': 9, '1Y': 12 }[RT.range]; from = new Date(last); from.setMonth(from.getMonth() - m); }
  let i0 = 0;
  if (from) { i0 = s.dates.findIndex(d => new Date(d) >= from); if (i0 < 0) i0 = 0; if (n - i0 < 2) i0 = Math.max(0, n - 2); }
  return { dates: s.dates.slice(i0), value: s.value.slice(i0), net: s.net_in.slice(i0) };
}

function rtValueChart() {
  const cv = document.getElementById('rt-value-chart');
  if (!cv || typeof Chart === 'undefined' || !RT.d) return;
  if (RT.vc) { RT.vc.destroy(); RT.vc = null; }
  document.querySelectorAll('.rt-views button').forEach(b => b.classList.toggle('active', b.dataset.v === RT.view));
  document.querySelectorAll('.rt-ranges button').forEach(b => b.classList.toggle('active', b.dataset.r === RT.range));
  const x = rtSlice(), n = x.dates.length;
  const profit = x.value.map((v, i) => +(v - x.net[i]).toFixed(2));
  const money = v => IS_GUEST ? '£***' : '£' + Math.round(v).toLocaleString('en-GB');
  const signed = v => IS_GUEST ? '£***' : (v >= 0 ? '+' : '−') + '£' + Math.abs(Math.round(v)).toLocaleString('en-GB');
  const dateFmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const gridC = clv('--border');

  // Headline for the selected range
  const dProfit = profit[n - 1] - profit[0];
  const head = document.getElementById('rt-vc-head');
  const note = document.getElementById('rt-vc-note');
  if (RT.view === 'profit') {
    head.innerHTML = `<span class="rt-mid ${rtCls(profit[n - 1])}">${signed(profit[n - 1])}</span> <span class="w-dim w-small">total profit now</span>` +
      (RT.range !== 'All' ? ` · <span class="${rtCls(dProfit)}">${signed(dProfit)}</span> <span class="w-dim w-small">in this period</span>` : '');
    note.textContent = 'Green = you are ahead of what you put in, red = behind. The line moves only with real gains/losses, not with deposits.';
  } else {
    head.innerHTML = `<span class="rt-mid">${money(x.value[n - 1])}</span> <span class="w-dim w-small">account value · ${money(x.net[n - 1])} put in</span>`;
    note.textContent = 'Blue line = account value, grey steps = money you put in. The space between them is your profit (green) or loss (red).';
  }

  const common = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    scales: { x: { type: 'category', ticks: { color: clv('--muted'), maxTicksLimit: 6, maxRotation: 0, callback(v) {
      const d = new Date(this.getLabelForValue(v)); return ['1D', '1W', '1M', '3M'].includes(RT.range) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }); } }, grid: { display: false } } } };

  if (RT.view === 'profit') {
    RT.vc = new Chart(cv, { type: 'line',
      data: { labels: x.dates, datasets: [{ label: 'Profit', data: profit, borderWidth: 2, pointRadius: 0, tension: 0.15,
        borderColor: RT_UP, segment: { borderColor: c => (c.p1.parsed.y >= 0 ? RT_UP : RT_DOWN) },
        fill: { target: 'origin', above: 'rgba(12,163,12,.18)', below: 'rgba(230,103,103,.2)' } }] },
      options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: i => dateFmt(i[0].label),
        label: c => `Profit: ${signed(c.raw)}`,
        afterLabel: c => IS_GUEST ? '' : [`Account value: ${money(x.value[c.dataIndex])}`, `Money put in: ${money(x.net[c.dataIndex])}`, `Return on money in: ${x.net[c.dataIndex] > 0 ? rtPct(c.raw / x.net[c.dataIndex] * 100) : '—'}`] } } },
        scales: { ...common.scales, y: { ticks: { color: clv('--muted'), callback: v => signed(v), maxTicksLimit: 6 },
          grid: { color: c => (c.tick && c.tick.value === 0 ? clv('--muted') : gridC), lineWidth: c => (c.tick && c.tick.value === 0 ? 1.5 : 1) } } } },
    });
  } else {
    const all = x.value.concat(x.net), lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 1;
    RT.vc = new Chart(cv, { type: 'line',
      data: { labels: x.dates, datasets: [
        { label: 'Account value', data: x.value, borderColor: RT_LINE, borderWidth: 2.5, pointRadius: 0, tension: 0.15,
          fill: { target: 1, above: 'rgba(12,163,12,.20)', below: 'rgba(230,103,103,.22)' } },
        { label: 'Money put in', data: x.net, borderColor: clv('--muted'), borderWidth: 2, pointRadius: 0, stepped: true },
      ] },
      options: { ...common, plugins: { legend: { display: false }, tooltip: { callbacks: {
        title: i => dateFmt(i[0].label),
        label: c => `${c.dataset.label}: ${money(c.raw)}`,
        footer: i => { const v = i.find(q => q.datasetIndex === 0)?.raw, m = i.find(q => q.datasetIndex === 1)?.raw; return v != null && m != null ? `Profit: ${signed(v - m)}` : ''; } } } },
        scales: { ...common.scales, y: { min: Math.max(0, Math.floor((lo - pad) / 10) * 10), max: Math.ceil((hi + pad) / 10) * 10,
          ticks: { color: clv('--muted'), callback: v => money(v), maxTicksLimit: 6 }, grid: { color: gridC } } } },
    });
  }
}

if (typeof module !== 'undefined') module.exports = { rtCheckText };
