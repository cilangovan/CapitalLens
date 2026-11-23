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

const PB = {};

// ── tap a header tile → pop-up explaining it, with the stocks behind the number ──
// Closest single stocks to the first ladder step (+20%), so "£0" always says how far away the next trim is.
function pbClosest(rows, dueCount) {
  const st = (rows || []).filter(r => r.kind === 'stock' && !(r.trim_plan || []).some(x => x.hit && x.sell_pct)).sort((a, b) => (b.gain_pct || 0) - (a.gain_pct || 0)).slice(0, 3);
  if (!st.length) return '<div class="w-dim w-small">No individual stocks are tracked here: the ladder has nothing to work on.</div>';
  return `<div class="pb-m-grp"><b>${dueCount ? 'Next in line' : 'Closest to the first step'}</b>${st.map(r => `<div class="pb-m-row"><span>${r.display || r.ticker}</span><span class="w-dim w-small">${r.gain_pct >= 0 ? '+' : ''}${fmt(r.gain_pct, 1)}% · ${r.gain_pct >= 20 ? 'at the step' : fmt(20 - (r.gain_pct || 0), 1) + ' points to +20%'}</span></div>`).join('')}</div>`;
}
// Holdings flagged "Book profit" by the score rule (score 50-64) have no ladder £ amount: list them with the reason instead of leaving the £0 unexplained.
function pbScoreFlags(rows) {
  const fl = (rows || []).filter(r => r.action_level === 'trim' && !(r.trim_plan || []).some(x => x.hit && x.sell_pct));
  if (!fl.length) return '';
  return `<div class="pb-m-grp"><b>${fl.length} flagged “Book profit” by score, no £ amount</b> <span class="w-dim w-small">These scored 50–64: the rulebook says consider partial booking or reducing exposure, but no ladder step is reached, so nothing is added to the total.</span>
    ${fl.map(r => `<div class="pb-m-row"><span>${r.display || r.ticker}<span class="w-dim w-small"> · ${r.kind === 'stock' ? 'stock' : 'fund'} · score ${r.score} · ${r.gain_pct >= 0 ? '+' : ''}${fmt(r.gain_pct, 1)}%</span></span><span class="w-dim w-small">${r.action || ''}</span></div>`).join('')}</div>`;
}
// Pie-level profit check (its own card): what a pie has gained and what the booking rules say about it.
function pbPieStatus(g) {
  if (g === null || g === undefined) return { cls: 'yellow', txt: 'Not enough data yet' };
  if (g < 0) return { cls: 'red', txt: 'In a loss: nothing to book; reduce only if the thesis has weakened' };
  if (g < 5) return { cls: '', txt: 'Too early to book: no rule applies below +5%' };
  if (g < 10) return { cls: 'green', txt: 'Hold: +5–10%, no automatic selling' };
  if (g < 20) return { cls: 'green', txt: 'Review: +10–20%, check allocation and the underlying index' };
  return { cls: 'yellow', txt: 'Strong gain: trim only if the pie is overweight, and check which of its stocks passed +20%' };
}
function pbPieGbp(p) {                   // exact when the engine sent it, otherwise worked back from value and %
  if (p.gain_gbp !== null && p.gain_gbp !== undefined) return { v: p.gain_gbp, approx: false };
  if (p.gain_pct === null || p.gain_pct === undefined || !p.gbp) return { v: null, approx: false };
  return { v: p.gbp - p.gbp / (1 + p.gain_pct / 100), approx: true };
}
function pbPieCard(s, rows) {
  const pies = (s.pies || []).filter(p => p.gbp > 0).slice().sort((a, b) => (b.gain_pct ?? -999) - (a.gain_pct ?? -999));
  const blocks = pies.map(p => {
    const st = pbPieStatus(p.gain_pct), g = pbPieGbp(p), mem = (rows || []).filter(r => (r.pie || '').trim() === p.pie), stocks = mem.filter(r => r.kind === 'stock'), funds = mem.filter(r => r.kind !== 'stock');
    const best = stocks.slice().sort((a, b) => (b.gain_pct || 0) - (a.gain_pct || 0))[0];
    const mix = `${stocks.length} stock${stocks.length === 1 ? '' : 's'} · ${funds.length} fund${funds.length === 1 ? '' : 's'}`;
    const ladder = !stocks.length ? 'Funds only: the stock ladder does not apply; rebalance and review rules do.' : best ? `Best stock: ${best.display || best.ticker} ${best.gain_pct >= 0 ? '+' : ''}${fmt(best.gain_pct, 1)}% (ladder starts at +20% on a stock's own buy price)` : '';
    return `<div class="pb-pie" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap"><b>${p.pie}</b><span class="${clr(p.gain_pct)}" style="font-weight:700;font-size:16px">${p.gain_pct == null ? '—' : (p.gain_pct >= 0 ? '+' : '') + fmt(p.gain_pct, 2) + '%'}${g.v === null ? '' : ` <span style="font-size:13px">${g.approx ? '≈ ' : ''}${g.v >= 0 ? '+' : '−'}${fmtGbpPlain(Math.abs(g.v))}</span>`}</span></div>
      <div class="w-dim w-small">Value ${fmtGbpPlain(p.gbp)} · invested ${p.invested_gbp != null ? fmtGbpPlain(p.invested_gbp) : '—'} · ${fmt(p.pct, 1)}% of holdings · ${mix}</div>
      <div class="${st.cls}" style="font-size:13px;margin-top:3px">${st.txt}</div>
      ${ladder ? `<div class="w-dim w-small">${ladder}</div>` : ''}</div>`;
  }).join('');
  return `<div class="card"><h3>⑥ Pie profit check</h3>
    <div class="w-dim w-small" style="margin-bottom:4px">What each pie has gained (Trading 212's own value against what you paid) and what the booking rules say. The ladder in <i>Profit to book</i> works on single stocks only, so a rising pie can still show £0 there. Biggest gain first.</div>
    ${blocks || '<div class="w-dim w-small">No funded pies yet.</div>'}
    <div class="w-dim w-small" style="margin-top:6px">Gain % = pie value ÷ amount invested − 1, from the last Trading 212 refresh. “≈” means worked back from the rounded percentage.</div></div>`;
}
function pbInfo(key) {
  const s = PB.s, rows = PB.rows || [], lim = s.limits || {}, tot = s.totals || {}, reg = s.regime || {};
  const name = r => `<b>${r.display || r.ticker}</b><div class="w-dim w-small">${r.pie || ''}</div>`;
  const unit = r => (r.trim_plan && r.trim_plan[0] && r.trim_plan[0].unit) || '';
  let title = '', body = '';
  if (key === 'risk') {
    const risk = lim.risk_per_trade_gbp, list = rows.filter(r => r.max_position_gbp)
      .map(r => ({ ...r, over: r.value_gbp - r.max_position_gbp, lossAtExit: r.stop_distance_pct > 0 ? r.value_gbp * r.stop_distance_pct / 100 : null }))
      .sort((a, b) => b.over - a.over);
    const over = list.filter(r => r.over > 0.5);
    title = `1% risk per trade — ${fmtGbpPlain(risk)}`;
    body = `<p>Your holdings are worth <b>${fmtGbpPlain(tot.holdings_gbp)}</b>. The rule: <b>never lose more than ${lim.risk_per_trade_pct}% — ${fmtGbpPlain(risk)} — on any one stock.</b></p>
      <p>Each stock has an exit price: its <b>trailing stop</b>, ${lim.atr_mult || 3}× its average daily move (ATR) below its 3-month high. A stock is <b>oversized</b> if dropping to that exit would lose more than ${fmtGbpPlain(risk)}. The fix is to trim it towards its max size, or accept the bigger risk knowingly.</p>
      <div class="pb-m-sum ${over.length ? 'yellow' : 'green'}">${over.length ? `⚠️ ${over.length} of ${list.length} stocks are bigger than the 1% rule allows` : `✓ All ${list.length} stocks are within the 1% rule`}</div>
      <table class="pb-rules pb-m-table"><tr><th>Stock</th><th>Holding</th><th>Max size</th><th>Exit price</th><th>Status</th></tr>
      ${list.map(r => `<tr><td>${name(r)}</td><td>${fmtGbpPlain(r.value_gbp)}</td><td>${fmtGbpPlain(r.max_position_gbp)}</td>
        <td>${pbPrice(r.trailing_stop, unit(r))}<div class="w-dim w-small">${r.stop_distance_pct != null ? (r.stop_distance_pct > 0 ? r.stop_distance_pct + '% below now' : 'already below') : ''}</div></td>
        <td class="${r.over > 0.5 ? 'yellow' : 'green'}">${r.over > 0.5 ? `Oversized by ${fmtGbpPlain(r.over)}` : 'OK'}</td></tr>`).join('')}</table>
      <p class="w-dim w-small">Max size = ${fmtGbpPlain(risk)} ÷ the stock's risk distance (${lim.atr_mult || 3}× ATR as % of price). Volatile stocks get a smaller max size.</p>`;
  } else if (key === 'trims') {
    const due = rows.flatMap(r => (r.trim_plan || []).filter(x => x.hit && x.sell_pct).map(x => ({ r, x })));
    title = `Profit to book — ${fmtGbpPlain(tot.suggested_trims_gbp)}`;
    body = `<p>Profit-taking ladder: when a stock is up by each step (e.g. +25%, +50%, +100%), sell a slice to lock in gains and keep the rest running.</p>
      ${due.length ? `<table class="pb-rules pb-m-table"><tr><th>Stock</th><th>Step reached</th><th>Sell</th><th>≈ £</th></tr>
        ${due.map(({ r, x }) => `<tr><td>${name(r)}</td><td>${x.label || '+' + x.gain + '%'}</td><td>${x.sell_pct}%</td><td>${fmtGbpPlain(r.value_gbp * x.sell_pct / 100)}</td></tr>`).join('')}</table>`
        : '<div class="pb-m-sum green">✓ No stock has reached a ladder step (+20% on its own buy price), so there is nothing to book from the ladder.</div>'}
      ${pbClosest(rows, due.length)}
      ${pbScoreFlags(rows)}
      <p class="w-dim w-small">Only <b>single stocks</b> use the ladder, and each is judged on <b>its own gain against its own average buy price</b>. Funds (ETFs) are hold-and-rebalance, never trimmed automatically. A rising <b>pie</b> is shown in its own card, ⑥ Pie profit check.</p>`;
  } else if (key === 'actions') {
    title = 'Actions';
    const groups = ['reassess', 'trim', 'rebalance', 'run', 'hold'];
    const what = { reassess: 'Something broke (trend, stop or fundamentals). Re-check the reason you own it.', trim: 'Up enough to book some profit.',
      rebalance: 'Too big a share of the portfolio or sector — move some elsewhere.', run: 'Strong — leave it alone.', hold: 'Nothing to do.' };
    body = groups.map(g => { const list = rows.filter(r => r.action_level === g); return list.length ? `<div class="pb-m-grp">${pbLvl(g)} <span class="w-dim">${what[g]}</span>
      <div>${list.map(r => `<div class="pb-m-row"><span>${r.display || r.ticker}</span><span class="w-dim w-small">${r.action || ''}</span></div>`).join('')}</div></div>` : ''; }).join('');
  } else if (key === 'holdings') {
    title = `Holdings — ${fmtGbpPlain(tot.holdings_gbp)}`;
    body = `<p>Market value of everything you hold, and what you paid (${fmtGbpPlain(tot.invested_gbp)}). Biggest first:</p>
      <table class="pb-rules pb-m-table"><tr><th>Stock</th><th>Value</th><th>Weight</th><th>Gain</th></tr>
      ${[...rows].sort((a, b) => b.value_gbp - a.value_gbp).map(r => `<tr><td>${name(r)}</td><td>${fmtGbpPlain(r.value_gbp)}</td><td>${fmt(r.weight_pct, 1)}%</td><td class="${clr(r.gain_pct)}">${fmt(r.gain_pct, 1)}%</td></tr>`).join('')}</table>`;
  } else if (key === 'regime') {
    title = `Market regime — ${reg.mode}`;
    body = `<p>A quick read of the overall market, which sets how bold the plan is: <b>Aggressive</b> lets winners run, <b>Neutral</b> sticks to the ladder, <b>Defensive</b> books profit sooner and tightens risk.</p>
      <p>Today: <b>${reg.points} points</b> (Aggressive ≥ 4 · Neutral 2–3 · Defensive ≤ 1). Points come from the S&amp;P 500 and MSCI ACWI being above their 50/200-day averages, VIX (fear gauge) ${reg.vix ?? '—'}, and ${reg.breadth_pct ?? '—'}% of your holdings above their 50-day average.</p>`;
  }
  let m = document.getElementById('pb-modal');
  if (!m) { m = document.createElement('div'); m.id = 'pb-modal'; document.body.appendChild(m); m.addEventListener('click', e => { if (e.target === m) pbClose(); }); }
  m.innerHTML = `<div class="pb-m-box" role="dialog" aria-modal="true"><div class="pb-m-head"><h3>${title}</h3><button class="pb-m-x" onclick="pbClose()" aria-label="Close">✕</button></div>
    <div class="pb-m-body">${body}</div><button class="pb-m-close" onclick="pbClose()">Close</button></div>`;
  m.classList.add('open'); document.body.style.overflow = 'hidden';
}
function pbClose() { const m = document.getElementById('pb-modal'); if (m) m.classList.remove('open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') pbClose(); });

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
  PB.s = s; PB.rows = rows;
  const regColor = { Aggressive: 'green', Neutral: 'yellow', Defensive: 'red' }[reg.mode] || '';
  const regIcon = { Aggressive: '🚀', Neutral: '⚖️', Defensive: '🛡️' }[reg.mode] || '';
  const upd = new Date(s.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  // ── Header stats
  const stats = `
    <div class="stats-strip">
      <div class="stat-card pb-tap" onclick="pbInfo('regime')" role="button" tabindex="0"><div class="label">Market regime <span class="pb-i">ⓘ</span></div><div class="value ${regColor}">${regIcon} ${reg.mode}</div><div class="sub">${reg.points} signal pts</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('holdings')" role="button" tabindex="0"><div class="label">Holdings <span class="pb-i">ⓘ</span></div><div class="value">${fmtGbp(tot.holdings_gbp)}</div><div class="sub">invested ${fmtGbpPlain(tot.invested_gbp)}</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('trims')" role="button" tabindex="0"><div class="label">Profit to book <span class="pb-i">ⓘ</span></div><div class="value yellow">${fmtGbp(tot.suggested_trims_gbp)}</div><div class="sub">${(cnt.trim || 0) > 0 && !(tot.suggested_trims_gbp > 0) ? `ladder: none due · ${cnt.trim} flagged by score` : 'ladder trims due'}</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('actions')" role="button" tabindex="0"><div class="label">Actions <span class="pb-i">ⓘ</span></div><div class="value" style="font-size:15px">
        <span class="red">${cnt.reassess || 0}</span> · <span class="yellow">${cnt.trim || 0}</span> · <span style="color:#a78bfa">${cnt.rebalance || 0}</span> · <span class="green">${(cnt.run || 0) + (cnt.hold || 0)}</span></div>
        <div class="sub">reassess · book · rebal · hold</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('risk')" role="button" tabindex="0"><div class="label">1% risk / trade <span class="pb-i">ⓘ</span></div><div class="value">${fmtGbp(lim.risk_per_trade_gbp)}</div><div class="sub">max loss on one stock</div></div>
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
    + stats + notes + `<div class="grid2">${market}${sectors}</div>` + holdings + pies + pbPieCard(s, rows) + rules;
}

function pbToggle(i) {
  const b = document.getElementById('pb-body-' + i), c = document.getElementById('pb-chev-' + i);
  const open = b.classList.toggle('open');
  if (c) c.textContent = open ? '▲' : '▼';
}
