// ── RETURNS ───────────────────────────────────────────────────
async function loadReturns() {
  const [rows, realisedRows, divRows] = await Promise.all([
    api('returns_summary','?select=*&limit=1'),
    api('realised_pnl','?select=*&order=filled_date.desc&limit=200'),
    api('dividends','?select=*&order=paid_date.desc&limit=200'),
  ]);
  const r = rows[0];
  const el = document.getElementById('returns-content');

  const totalRealised = realisedRows.reduce((s,x) => s + (parseFloat(x.realised_pnl)||0), 0);
  const totalDivs     = divRows.reduce((s,x) => s + (parseFloat(x.amount)||0), 0);

  if (!r && !realisedRows.length && !divRows.length) {
    el.innerHTML = '<div class="loading">No returns data yet. Run daily_services workflow.</div>'; return;
  }

  const yearly = r ? (r.yearly_breakdown || {}) : {};
  const monthly = r ? (r.monthly_breakdown || {}) : {};

  el.innerHTML = `
    <div class="grid3">
      <div class="card xirr-banner"><div class="big ${r ? clr(r.xirr_pct) : ''}">${r ? fmt(r.xirr_pct)+'%' : '—'}</div><div class="label">XIRR (true IRR)</div></div>
      <div class="card xirr-banner"><div class="big ${r ? clr(r.annualised_pct) : ''}">${r ? fmt(r.annualised_pct)+'%' : '—'}</div><div class="label">Annualised Return</div></div>
      <div class="card xirr-banner"><div class="big ${r ? clr(r.total_return_pct) : ''}">${r ? fmt(r.total_return_pct)+'%' : '—'}</div><div class="label">Total Return</div></div>
    </div>
    <div class="grid3" style="margin-top:0">
      <div class="card"><div class="big ${clr(totalRealised)}">${IS_GUEST ? '***' : '£'+totalRealised.toFixed(2)}</div><div class="label">Realised P&amp;L (all time)</div></div>
      <div class="card"><div class="big pos">£${IS_GUEST ? '***' : totalDivs.toFixed(2)}</div><div class="label">Dividends received</div></div>
      <div class="card"><div class="big ${clr(totalRealised+totalDivs)}">${IS_GUEST ? '***' : '£'+(totalRealised+totalDivs).toFixed(2)}</div><div class="label">Total realised income</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Yearly Breakdown</h3><canvas id="yearly-chart"></canvas></div>
      <div class="card"><h3>Monthly Return %</h3><canvas id="monthly-chart"></canvas></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h3 style="margin:0">Realised P&amp;L — Closed Trades</h3>
          ${IS_GUEST ? '' : `<select id="pnl-year-filter" style="background:#0d1b2e;color:#e2e8f0;border:1px solid #2d3353;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer">
            <option value="all">All Years</option>
            ${[...new Set(realisedRows.map(x=>(x.filled_date||'').slice(0,4)).filter(y=>y))].sort().reverse().map(y=>`<option value="${y}">${y}</option>`).join('')}
          </select>`}
        </div>
        <div id="pnl-table-wrap">
        ${IS_GUEST
          ? '<div class="loading" style="font-size:13px;color:var(--muted)">🔒 Sensitive data — sign in to view closed trades.</div>'
          : (()=>{
              const sells = realisedRows.filter(x => x.side && x.side.includes('SELL'));
              if(!sells.length) return '<div class="loading" style="font-size:13px">No closed sell orders yet.</div>';
              return '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:var(--muted)"><th style="text-align:left;padding:4px 6px">Ticker</th><th style="padding:4px 6px">Date</th><th style="padding:4px 6px">Qty</th><th style="padding:4px 6px">P&amp;L</th><th style="padding:4px 6px">%</th></tr></thead><tbody>'
              + sells.slice(0,50).map(x => {
                  const pnl = parseFloat(x.realised_pnl)||0;
                  const cls = pnl >= 0 ? 'pos' : 'neg';
                  return `<tr style="border-top:1px solid #1a2744" data-year="${(x.filled_date||'').slice(0,4)}">
                    <td style="padding:4px 6px;font-weight:600">${x.display||x.ticker}</td>
                    <td style="padding:4px 6px;color:var(--muted)">${x.filled_date||'—'}</td>
                    <td style="padding:4px 6px;text-align:right">${parseFloat(x.quantity||0).toFixed(3)}</td>
                    <td style="padding:4px 6px;text-align:right" class="${cls}">${(pnl>=0?'+':'')+'£'+pnl.toFixed(2)}</td>
                    <td style="padding:4px 6px;text-align:right" class="${cls}">${(parseFloat(x.realised_pnl_pct)||0).toFixed(1)}%</td>
                  </tr>`;
                }).join('') + '</tbody></table>';
            })()
        }
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h3 style="margin:0">Dividends</h3>
          ${IS_GUEST ? '' : `<select id="div-year-filter" style="background:#0d1b2e;color:#e2e8f0;border:1px solid #2d3353;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer">
            <option value="all">All Years</option>
            ${[...new Set(divRows.map(x=>(x.paid_date||'').slice(0,4)).filter(y=>y))].sort().reverse().map(y=>`<option value="${y}">${y}</option>`).join('')}
          </select>`}
        </div>
        <div id="div-table-wrap">
        ${IS_GUEST
          ? '<div class="loading" style="font-size:13px;color:var(--muted)">🔒 Sensitive data — sign in to view dividends.</div>'
          : divRows.length === 0
            ? '<div class="loading" style="font-size:13px">No dividends received yet.</div>'
            : '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="color:var(--muted)"><th style="text-align:left;padding:4px 6px">Ticker</th><th style="padding:4px 6px">Date</th><th style="padding:4px 6px;text-align:right">Amount</th></tr></thead><tbody>'
            + divRows.slice(0,100).map(x => `<tr style="border-top:1px solid #1a2744" data-year="${(x.paid_date||'').slice(0,4)}">
                <td style="padding:4px 6px;font-weight:600">${x.display||x.ticker}</td>
                <td style="padding:4px 6px;color:var(--muted)">${x.paid_date||'—'}</td>
                <td style="padding:4px 6px;text-align:right;color:#22c55e">£${(parseFloat(x.amount)||0).toFixed(4)}</td>
              </tr>`).join('') + '</tbody></table>'
        }
        </div>
      </div>
    </div>`;

  document.getElementById('pnl-year-filter')?.addEventListener('change', function(){
    const yr = this.value;
    document.querySelectorAll('#pnl-table-wrap tbody tr').forEach(tr => {
      tr.style.display = (yr === 'all' || tr.dataset.year === yr) ? '' : 'none';
    });
  });
  document.getElementById('div-year-filter')?.addEventListener('change', function(){
    const yr = this.value;
    document.querySelectorAll('#div-table-wrap tbody tr').forEach(tr => {
      tr.style.display = (yr === 'all' || tr.dataset.year === yr) ? '' : 'none';
    });
  });

  const years = Object.keys(yearly).sort();
  const ctx1 = document.getElementById('yearly-chart').getContext('2d');
  new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [{
        label: 'P&L %',
        data: years.map(y => yearly[y].ppl_pct || 0),
        backgroundColor: years.map(y => (yearly[y].ppl_pct||0) >= 0 ? 'rgba(34,197,94,.7)' : 'rgba(239,68,68,.7)'),
        borderRadius: 4,
      }]
    },
    options: { plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#8892a4'},grid:{color:'#2d3353'}}, y:{ticks:{color:'#8892a4'},grid:{color:'#2d3353'}} }, responsive:true }
  });

  const months = Object.keys(monthly).sort().slice(-24);
  const ctx2 = document.getElementById('monthly-chart').getContext('2d');
  new Chart(ctx2, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Monthly %',
        data: months.map(m => monthly[m].monthly_ret_pct || 0),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }]
    },
    options: { plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#8892a4',maxRotation:45,font:{size:9}},grid:{color:'#2d3353'}}, y:{ticks:{color:'#8892a4'},grid:{color:'#2d3353'}} }, responsive:true }
  });
}
