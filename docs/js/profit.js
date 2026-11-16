// ── PROFIT BOOKING & CAPITAL PROTECTION ───────────────────────
const PB_LEVELS = {
  run:       { label: 'Let it run', order: 3 },
  hold:      { label: 'Hold',       order: 4 },
  trim:      { label: 'Book profit',order: 1 },
  rebalance: { label: 'Rebalance',  order: 2 },
  reassess:  { label: 'Reassess',   order: 0 },
};
const PB_FACTORS = [
  ['market', 'Market trend', 20], ['sector', 'Sector strength', 20], ['momentum', 'Price momentum', 15],
  ['volume', 'Relative volume', 15], ['fundamentals', 'Fundamentals', 20], ['concentration', 'Concentration', 10],
];

function pbScoreColor(s) { return s >= 80 ? 'var(--green)' : s >= 65 ? '#60a5fa' : s >= 50 ? 'var(--yellow)' : 'var(--red)'; }
function pbLvl(l) { return `<span class="pb-lvl pb-${l}">${(PB_LEVELS[l] || {}).label || l}</span>`; }
function pbTick(b) { return b == null ? '—' : b ? '<span class="green">✓</span>' : '<span class="red">✗</span>'; }
function pbPrice(v, u) {
  if (v == null) return '—';
  if (u === 'p') return Number(v).toFixed(1) + 'p';
  return (u || '') + Number(v).toFixed(2);
}

async function loadProfit() {
  const el = document.getElementById('profit-content');
  if (IS_GUEST) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view the profit booking strategy</div>';
    return;
  }
  const [sumRows, rows] = await Promise.all([
    api('profit_booking_summary', '?select=*&order=updated_at.desc&limit=1'),
    api('profit_booking', '?select=*&order=score.asc'),
  ]);
  const s = sumRows[0];
  if (!s || !rows.length) {
    el.innerHTML = '<div class="loading">No profit-booking data yet. Run the Daily Portfolio Services workflow.</div>';
    return;
  }
  const reg = s.regime || {}, tot = s.totals || {}, lim = s.limits || {}, cnt = tot.counts || {};
  const regColor = { Aggressive: 'green', Neutral: 'yellow', Defensive: 'red' }[reg.mode] || '';
  const regIcon = { Aggressive: '🚀', Neutral: '⚖️', Defensive: '🛡️' }[reg.mode] || '';
  const upd = new Date(s.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  // ── Header stats
  const stats = `
    <div class="stats-strip">
      <div class="stat-card"><div class="label">Market regime</div><div class="value ${regColor}">${regIcon} ${reg.mode}</div><div class="sub">${reg.points} signal pts</div></div>
      <div class="stat-card"><div class="label">Holdings</div><div class="value">${fmtGbp(tot.holdings_gbp)}</div><div class="sub">invested ${fmtGbpPlain(tot.invested_gbp)}</div></div>
      <div class="stat-card"><div class="label">Profit to book</div><div class="value yellow">${fmtGbp(tot.suggested_trims_gbp)}</div><div class="sub">ladder trims due</div></div>
      <div class="stat-card"><div class="label">Actions</div><div class="value" style="font-size:15px">
        <span class="red">${cnt.reassess || 0}</span> · <span class="yellow">${cnt.trim || 0}</span> · <span style="color:#a78bfa">${cnt.rebalance || 0}</span> · <span class="green">${(cnt.run || 0) + (cnt.hold || 0)}</span></div>
        <div class="sub">reassess · book · rebal · hold</div></div>
      <div class="stat-card"><div class="label">1% risk / trade</div><div class="value">${fmtGbp(lim.risk_per_trade_gbp)}</div><div class="sub">max loss on one stock</div></div>
    </div>`;

  // ── Layer 1: market
  const idx = (n, t) => t ? `<tr><td>${n}</td><td>${pbTick(t.above50)}</td><td>${pbTick(t.above200)}</td><td class="${clr(t.ret3m)}">${fmt(t.ret3m, 1)}%</td></tr>` : '';
  const market = `
    <div class="card"><h3>① Market conditions</h3>
      <table class="pb-rules" style="width:100%"><tr><th>Index</th><th>&gt; 50 DMA</th><th>&gt; 200 DMA</th><th>3-month</th></tr>
        ${idx('S&amp;P 500', reg.spx)}${idx('MSCI ACWI', reg.acwi)}</table>
      <div class="pb-kv">
        <div><b>VIX</b>${reg.vix ?? '—'} ${reg.vix != null ? (reg.vix < 20 ? '<span class="green">calm</span>' : reg.vix > 28 ? '<span class="red">stressed</span>' : '<span class="yellow">elevated</span>') : ''}</div>
        <div><b>Breadth</b>${reg.breadth_pct ?? '—'}% of holdings above 50 DMA</div>
      </div>
      <div style="font-size:12px;color:var(--muted)">Aggressive ≥ 4 pts · Neutral 2–3 · Defensive ≤ 1. Each index above its 50/200 DMA +1, VIX &lt; 20 +1 (&gt; 28 −1), breadth ≥ 60% +1 (&lt; 40% −1).</div>
    </div>`;

  // ── Watch-outs
  const notes = (s.notes || []).length ? `<div class="card"><h3>⚠️ Watch-outs</h3>${s.notes.map(n => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)">${n}</div>`).join('')}</div>` : '';

  // ── Layer 2 + 5: sector & pie exposure
  const maxSec = lim.max_sector_pct || 25;
  const sectors = `
    <div class="card"><h3>② Sector exposure (look-through) — cap ${maxSec}%</h3>
      ${(s.sectors || []).map(x => `
        <div style="display:grid;grid-template-columns:150px 1fr 54px;gap:10px;align-items:center;margin-bottom:7px;font-size:12px">
          <div>${x.sector}</div>
          <div class="pb-bar"><i style="width:${Math.min(100, x.pct / 50 * 100)}%;background:${x.over ? 'var(--red)' : 'var(--accent)'}"></i>
            <span style="position:absolute;left:${maxSec / 50 * 100}%;top:-2px;bottom:-2px;border-left:2px dashed var(--muted)"></span></div>
          <div style="text-align:right;font-weight:700" class="${x.over ? 'red' : ''}">${fmt(x.pct, 1)}%</div>
        </div>`).join('')}
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Bar scale 0–50% · dashed line = ${maxSec}% cap · ETF sector splits are approximate</div>
    </div>`;
  const pies = `
    <div class="card"><h3>⑤ Pie-level view</h3>
      <table class="pb-rules" style="width:100%"><tr><th>Pie</th><th>Value</th><th>Weight</th><th>Gain</th><th>Score</th><th>Flags</th></tr>
      ${(s.pies || []).filter(p => p.gbp > 0).map(p => `<tr>
        <td>${p.pie}</td><td>${fmtGbp(p.gbp)}</td><td>${fmt(p.pct, 1)}%</td>
        <td class="${clr(p.gain_pct)}">${p.gain_pct == null ? '—' : fmt(p.gain_pct, 1) + '%'}</td>
        <td style="color:${p.avg_score ? pbScoreColor(p.avg_score) : ''};font-weight:700">${p.avg_score ?? '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${p.flags.join(', ') || '—'}</td></tr>`).join('')}
      </table>
      ${(s.pies || []).filter(p => !p.gbp).length ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">Not yet funded: ${(s.pies || []).filter(p => !p.gbp).map(p => p.pie).join(', ')}</div>` : ''}
    </div>`;

  // ── Layers 3 + 4: holdings
  const sorted = [...rows].sort((a, b) => (PB_LEVELS[a.action_level]?.order ?? 9) - (PB_LEVELS[b.action_level]?.order ?? 9) || a.score - b.score);
  const holdCard = (r, i) => {
    const sig = r.signals || {}, bd = r.breakdown || {};
    const factors = PB_FACTORS.map(([k, n, max]) => `
      <div style="display:grid;grid-template-columns:110px 1fr 40px;gap:8px;align-items:center;margin-bottom:4px">
        <div style="color:var(--muted)">${n}</div>
        <div class="pb-bar"><i style="width:${(bd[k] || 0) / max * 100}%;background:${pbScoreColor((bd[k] || 0) / max * 100)}"></i></div>
        <div style="text-align:right">${bd[k] ?? 0}/${max}</div></div>`).join('');
    const ladder = (r.trim_plan || []).length ? `
      <div style="margin-top:10px;font-weight:600">Profit-booking ladder</div>
      <div class="pb-ladder">${r.trim_plan.map(t => `
        <div class="pb-step ${t.hit ? 'hit' : ''}">
          <div style="font-weight:700">${t.hit ? '✅' : '○'} +${t.gain}% · ${pbPrice(t.price, t.unit)}</div>
          <div style="color:var(--muted)">${t.label}</div>
          ${t.sell_pct ? `<div>Sell ${t.sell_pct}% ≈ ${t.sell_qty} sh · ${fmtGbp(t.sell_gbp)}</div>` : ''}
        </div>`).join('')}</div>` : '';
    const protect = r.kind === 'stock' ? `
      <div class="pb-kv">
        <div><b>Trailing exit (3×ATR)</b>${pbPrice(r.trailing_stop, (r.trim_plan[0] || {}).unit)}<br>${sig.trail_breached
          ? `<span class="red">breached — price ${fmt(Math.abs(r.stop_distance_pct), 1)}% below</span>`
          : `<span style="color:var(--muted)">${fmt(r.stop_distance_pct, 1)}% below price</span>`}</div>
        <div><b>Max size @1% risk</b>${fmtGbp(r.max_position_gbp)}<br><span class="${r.value_gbp > r.max_position_gbp ? 'red' : 'green'}">${r.value_gbp > r.max_position_gbp ? 'oversized' : 'within limit'}</span></div>
        <div><b>Analyst upside</b>${sig.upside_pct == null ? '—' : fmt(sig.upside_pct, 1) + '%'}</div>
      </div>` : `
      <div class="pb-kv">
        <div><b>From 52w high</b>${sig.drawdown_pct == null ? '—' : '−' + fmt(sig.drawdown_pct, 1) + '%'}</div>
        <div><b>Stops</b>none — ETFs use drift &amp; drawdown reviews</div>
      </div>`;
    return `
      <div class="pb-hold-card">
        <div class="pb-hold-head" onclick="pbToggle(${i})">
          <div><div style="font-weight:700">${r.display} <span style="font-size:10px;color:var(--muted);font-weight:400">${r.kind.toUpperCase()} · ${r.pie}</span></div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.action}</div></div>
          <div class="pb-score" style="color:${pbScoreColor(r.score)}">${r.score}</div>
          <div class="${clr(r.gain_pct)}" style="font-weight:700;text-align:right">${r.gain_pct > 0 ? '+' : ''}${fmt(r.gain_pct, 1)}%</div>
          <div class="pb-hide-sm" style="text-align:right">${pbLvl(r.action_level)}<div style="font-size:10px;color:var(--muted);margin-top:2px">${fmt(r.weight_pct, 1)}% · ${fmtGbpPlain(r.value_gbp)}</div></div>
          <div id="pb-chev-${i}" style="color:var(--muted)">▼</div>
        </div>
        <div class="pb-hold-body" id="pb-body-${i}">
          <div style="margin:8px 0;padding:8px;background:var(--bg2);border-radius:6px">🧭 ${sig.rule || ''}<br>📊 Volume: ${sig.volume || '—'}${r.rel_volume ? ` (RV ${fmt(r.rel_volume, 2)})` : ''}
            · Sector vs benchmark 3m: <span class="${clr(sig.sector_rel_3m)}">${sig.sector_rel_3m == null ? '—' : fmt(sig.sector_rel_3m, 1) + '%'}</span>
            · 50/200 DMA ${pbTick(sig.above50)}${pbTick(sig.above200)} · Sector: ${r.sector}</div>
          ${factors}
          ${protect}
          ${ladder}
          ${(r.notes || []).map(n => `<div style="color:var(--yellow);margin-top:4px">• ${n}</div>`).join('')}
        </div>
      </div>`;
  };
  const holdings = `
    <div class="card"><h3>③④ Holdings — weekly score &amp; action</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Score: 80–100 let it run · 65–79 hold &amp; monitor · 50–64 consider partial booking · &lt;50 reassess. Tap a row for detail.</div>
      ${sorted.map(holdCard).join('')}
    </div>`;

  // ── Rulebook
  const rules = `
    <div class="card"><h3>📘 Rulebook</h3>
      <div class="grid2">
        <div><div style="font-weight:600;margin-bottom:6px">Individual stocks — staged booking</div>
          <table class="pb-rules" style="width:100%">
            <tr><td>+10%</td><td>Hold; review valuation</td></tr>
            <tr><td>+15%</td><td>Check momentum, volume, fundamentals</td></tr>
            <tr><td>+20%</td><td>Trim 10–15%</td></tr>
            <tr><td>+30%</td><td>Trim another 15–20%</td></tr>
            <tr><td>+40–50%</td><td>Recover initial capital</td></tr>
            <tr><td>Trend break</td><td>Trailing exit ${lim.atr_mult || 3}×ATR below 3-month high</td></tr>
          </table>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">Score ≥ 80 → lower trim % (let winners run).</div></div>
        <div><div style="font-weight:600;margin-bottom:6px">ETFs — hold &amp; rebalance</div>
          <table class="pb-rules" style="width:100%">
            <tr><td>+5–10%</td><td>Hold, no automatic selling</td></tr>
            <tr><td>+10–20%</td><td>Review allocation &amp; index</td></tr>
            <tr><td>+20–30%</td><td>Trim only if overweight</td></tr>
            <tr><td>Drift</td><td>+${lim.drift_pp || 5}pp or +${lim.drift_rel_pct || 20}% relative → rebalance</td></tr>
            <tr><td>−10–15%</td><td>Review, don't panic sell</td></tr>
            <tr><td>−20%+</td><td>Reassess risk &amp; thesis</td></tr>
          </table>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">Check monthly · rebalance quarterly · new money fixes underweights first.</div></div>
      </div>
      <div style="margin-top:10px;font-size:12px">🛡️ Limits: ${lim.risk_per_trade_pct}% risk per stock (${fmtGbpPlain(lim.risk_per_trade_gbp)}) · max ${lim.max_stock_pct}% per stock · max ${lim.max_sector_pct}% per sector.
        <span style="color:var(--muted)">Stops aren't guaranteed prices — gaps can fill below the trigger. Review prompts, not automatic sell orders.</span></div>
    </div>`;

  el.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Updated ${upd}</div>`
    + stats + notes + `<div class="grid2">${market}${sectors}</div>` + holdings + pies + rules;
}

function pbToggle(i) {
  const b = document.getElementById('pb-body-' + i), c = document.getElementById('pb-chev-' + i);
  const open = b.classList.toggle('open');
  if (c) c.textContent = open ? '▲' : '▼';
}
