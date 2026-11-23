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

// ── Live market regime recompute ──────────────────────────────
// Fetches ^GSPC, ACWI, ^VIX (1y daily closes) from the relay and recomputes the
// regime score using the same algorithm as the Python pipeline and profitbooking.js.
// Returns null on network failure so the snapshot values remain.
let _pbLiveRegCache = null, _pbLiveRegAt = 0;
async function pbFetchPtsOrdered(sym) {
  try {
    const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol: sym, range: '1y' }) });
    if (!r.ok) return null;
    const d = await r.json().catch(() => ({}));
    return (d.points || []).filter(p => p && Number.isFinite(+p[0]) && +p[1] > 0).sort((a, b) => +a[0] - +b[0]).map(p => +p[1]);
  } catch (e) { return null; }
}
function pbSma(closes, n) {
  if (!closes || closes.length < n) return null;
  let s = 0; for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}
function pbRet(closes, days) {
  if (!closes || closes.length <= days) return null;
  return (closes[closes.length - 1] / closes[closes.length - 1 - days] - 1) * 100;
}
function pbTrend(closes) {
  if (!closes || closes.length < 201) return null;
  const p = closes[closes.length - 1], m50 = pbSma(closes, 50), m200 = pbSma(closes, 200);
  return { price: p, above50: p > m50, above200: p > m200, ret3m: pbRet(closes, 63) };
}
async function pbComputeRegimeLive(storedBreadth) {
  if (_pbLiveRegCache && Date.now() - _pbLiveRegAt < 15 * 60 * 1000) return _pbLiveRegCache;
  // Always fetch fresh — never reuse _ovMk which may be hours old.
  // _ovMk has no age guard here and CF doesn't cache POSTs, so stale _ovMk
  // would silently serve mid-session data. Each fresh POST hits Yahoo directly.
  const fetches = [
    pbFetchPtsOrdered('^GSPC'),
    pbFetchPtsOrdered('ACWI'),
    pbFetchPtsOrdered('^VIX'),
  ];
  const [gsc, asc, vc] = await Promise.all(fetches);
  const spx = pbTrend(gsc), acwi = pbTrend(asc);
  const vix = vc && vc.length ? +(vc[vc.length - 1]).toFixed(1) : null;
  let pts = 0;
  for (const t of [spx, acwi]) if (t) pts += (t.above50 ? 1 : 0) + (t.above200 ? 1 : 0);
  if (vix != null) pts += vix < 20 ? 1 : vix > 28 ? -1 : 0;
  const bp = storedBreadth != null ? storedBreadth : null; // breadth needs live portfolio — keep stored value
  if (bp != null) pts += bp >= 60 ? 1 : bp < 40 ? -1 : 0;
  const mode = pts >= 4 ? 'Aggressive' : pts >= 2 ? 'Neutral' : 'Defensive';
  _pbLiveRegCache = {
    mode, points: pts,
    spx: spx ? { above50: spx.above50, above200: spx.above200, ret3m: spx.ret3m != null ? +spx.ret3m.toFixed(1) : null } : null,
    acwi: acwi ? { above50: acwi.above50, above200: acwi.above200, ret3m: acwi.ret3m != null ? +acwi.ret3m.toFixed(1) : null } : null,
    vix, breadth_pct: bp, _live: true, _at: Date.now(),
  };
  _pbLiveRegAt = Date.now();
  return _pbLiveRegCache;
}

// Patch the already-rendered profit booking card with live regime data.
async function pbPatchLiveRegime(storedReg) {
  const lbl = document.getElementById('pb-regime-freshness');
  if (lbl) lbl.textContent = '⏳ Refreshing market data…';
  let live;
  try { live = await pbComputeRegimeLive(storedReg ? storedReg.breadth_pct : null); }
  catch (e) { if (lbl) lbl.textContent = '⚠ Could not refresh — showing snapshot'; return; }
  if (!live) { if (lbl) lbl.textContent = '⚠ Could not refresh — showing snapshot'; return; }

  // Patch regime header chip
  const chip = document.getElementById('pb-regime-chip');
  if (chip) {
    const regColor = { Aggressive: 'green', Neutral: 'yellow', Defensive: 'red' }[live.mode] || '';
    const regIcon = { Aggressive: '🚀', Neutral: '⚖️', Defensive: '🛡️' }[live.mode] || '';
    chip.className = 'value ' + regColor;
    chip.textContent = regIcon + ' ' + live.mode;
    const sub = document.getElementById('pb-regime-pts');
    if (sub) sub.textContent = live.points + ' signal pts';
  }

  // Patch market conditions table
  const tbl = document.getElementById('pb-mkt-table');
  if (tbl && (live.spx || live.acwi)) {
    const idx2 = (n, t) => t ? `<tr><td>${n}</td><td>${pbTick(t.above50)}</td><td>${pbTick(t.above200)}</td><td class="${clr(t.ret3m)}">${fmt(t.ret3m, 1)}%</td></tr>` : '';
    tbl.innerHTML = `<tr><th>Index</th><th>&gt; 50 DMA</th><th>&gt; 200 DMA</th><th>3-month</th></tr>${idx2('S&amp;P 500', live.spx)}${idx2('MSCI ACWI', live.acwi)}`;
  }
  const vixEl = document.getElementById('pb-mkt-vix');
  if (vixEl && live.vix != null) {
    const v = live.vix;
    vixEl.innerHTML = `<b>VIX</b>${v} ${v < 20 ? '<span class="green">calm</span>' : v > 28 ? '<span class="red">stressed</span>' : '<span class="yellow">elevated</span>'}`;
  }

  // Patch notes section if regime changed
  const notesEl = document.getElementById('pb-watchouts-body');
  if (notesEl && live.mode !== storedReg.mode) {
    const newNote = { Aggressive: 'Market regime Aggressive — let winners run, trim only at ladder levels.',
      Neutral: 'Market regime Neutral — follow the ladder, tighten review on weak sectors.',
      Defensive: 'Market regime Defensive — book ladder profits fully, protect gains, avoid new stock risk.' }[live.mode];
    // Replace the old regime note (it's always the last item)
    const items = notesEl.querySelectorAll('div');
    for (const item of items) {
      if (item.textContent.startsWith('Market regime ')) { item.textContent = newNote; break; }
    }
  }

  // Update execute panel mode badge
  const execBadge = document.getElementById('pb-exec-badge');
  if (execBadge) {
    const isUp = live.mode === 'Aggressive' || live.mode === 'Neutral';
    execBadge.style.background = isUp ? 'rgba(34,197,94,.15)' : 'rgba(245,158,11,.15)';
    execBadge.style.color = isUp ? 'var(--green)' : 'var(--yellow)';
    execBadge.textContent = 'Market ' + live.mode;
  }

  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (lbl) lbl.innerHTML = `🟢 Live data · updated ${now}`;
  PB.liveReg = live;
}

// ── Live per-holding DMA patch ─────────────────────────────────
// Fetches 1y closes for each unique yahoo_ticker and patches the
// 50/200 DMA ✓/✗ ticks in the holdings cards. Runs in batches of 4.
let _pbDmaCache = {}, _pbDmaAt = {};
const PB_DMA_TTL = 15 * 60 * 1000;

async function pbFetchDmaTrend(sym) {
  if (!sym) return null;
  if (_pbDmaCache[sym] && Date.now() - (_pbDmaAt[sym] || 0) < PB_DMA_TTL) return _pbDmaCache[sym];
  const closes = await pbFetchPtsOrdered(sym);
  if (!closes || closes.length < 51) return null;
  const price = closes[closes.length - 1];
  const m50 = pbSma(closes, 50);
  const m200 = closes.length >= 201 ? pbSma(closes, 200) : null;
  const result = { above50: price > m50, above200: m200 != null ? price > m200 : null };
  _pbDmaCache[sym] = result; _pbDmaAt[sym] = Date.now();
  return result;
}

async function pbPatchLiveHoldingDMAs(rows) {
  const freshLbl = document.getElementById('pb-dma-freshness');
  // Collect unique tickers with a DOM target
  const tasks = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r.yahoo_ticker) continue;
    const sym = r.yahoo_ticker;
    const domId = 'pb-dma-' + sym.replace(/[^a-zA-Z0-9]/g, '_');
    if (!document.getElementById(domId)) continue;
    if (!seen.has(sym)) { seen.add(sym); tasks.push(sym); }
  }
  if (!tasks.length) { if (freshLbl) freshLbl.textContent = ''; return; }
  // Batch fetch in groups of 4
  let done = 0;
  for (let i = 0; i < tasks.length; i += 4) {
    const batch = tasks.slice(i, i + 4);
    const results = await Promise.all(batch.map(s => pbFetchDmaTrend(s).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      const sym = batch[j], trend = results[j];
      if (!trend) continue;
      const domId = 'pb-dma-' + sym.replace(/[^a-zA-Z0-9]/g, '_');
      const el = document.getElementById(domId);
      if (el) {
        const a200 = trend.above200 != null ? pbTick(trend.above200) : '—';
        el.innerHTML = pbTick(trend.above50) + a200;
        el.title = 'Live · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      done++;
    }
    if (freshLbl) freshLbl.textContent = `⏳ DMA refresh: ${Math.min(i + 4, tasks.length)}/${tasks.length}…`;
  }
  const nowT = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (freshLbl) freshLbl.innerHTML = `🟢 DMA live · ${nowT} (${done}/${tasks.length} updated)`;
}

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
      <div class="stat-card pb-tap" onclick="pbInfo('regime')" role="button" tabindex="0"><div class="label">Market regime <span class="pb-i">ⓘ</span></div><div id="pb-regime-chip" class="value ${regColor}">${regIcon} ${reg.mode}</div><div id="pb-regime-pts" class="sub">${reg.points} signal pts</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('holdings')" role="button" tabindex="0"><div class="label">Holdings <span class="pb-i">ⓘ</span></div><div class="value">${fmtGbp(tot.holdings_gbp)}</div><div class="sub">invested ${fmtGbpPlain(tot.invested_gbp)}</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('trims')" role="button" tabindex="0"><div class="label">Profit to book <span class="pb-i">ⓘ</span></div><div class="value yellow">${fmtGbp(tot.suggested_trims_gbp)}</div><div class="sub">${(cnt.trim || 0) > 0 && !(tot.suggested_trims_gbp > 0) ? `ladder: none due · ${cnt.trim} flagged by score` : 'ladder trims due'}</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('actions')" role="button" tabindex="0"><div class="label">Actions <span class="pb-i">ⓘ</span></div><div class="value" style="font-size:15px">
        <span class="red">${cnt.reassess || 0}</span> · <span class="yellow">${cnt.trim || 0}</span> · <span style="color:#a78bfa">${cnt.rebalance || 0}</span> · <span class="green">${(cnt.run || 0) + (cnt.hold || 0)}</span></div>
        <div class="sub">reassess · book · rebal · hold</div></div>
      <div class="stat-card pb-tap" onclick="pbInfo('risk')" role="button" tabindex="0"><div class="label">1% risk / trade <span class="pb-i">ⓘ</span></div><div class="value">${fmtGbp(lim.risk_per_trade_gbp)}</div><div class="sub">max loss on one stock</div></div>
    </div>`;

  // ── Execute panel: shown when market is up (regime = Aggressive or Neutral) with contextual steps
  function pbExecuteSteps(piesData, rowsData, regData, totData) {
    const isUp = regData && (regData.mode === 'Aggressive' || regData.mode === 'Neutral');
    const pieProfits = (piesData || []).filter(p => p.gbp > 0 && p.gain_pct > 0).sort((a, b) => (b.gain_pct || 0) - (a.gain_pct || 0));
    const concentration = (s.limits || {});
    const maxStock = concentration.max_stock_pct || 25;
    const overweight = (rowsData || []).filter(r => r.weight_pct > maxStock).sort((a, b) => b.weight_pct - a.weight_pct);
    if (!isUp && !pieProfits.length) return '';
    // Build contextual step list
    const steps = [];
    // Step 1: Check which pies are actually up
    if (pieProfits.length) {
      const best = pieProfits[0];
      steps.push(`<div class="pb-exec-step">
        <div class="pb-exec-num">1</div>
        <div class="pb-exec-body">
          <b>Check your pie gains</b>
          <div class="w-dim w-small" style="margin-top:3px">Your pies in profit right now:</div>
          ${pieProfits.map(p => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${p.pie}</span><span class="${clr(p.gain_pct)}" style="font-weight:600">${p.gain_pct >= 0 ? '+' : ''}${fmt(p.gain_pct, 2)}%  ${p.gain_gbp != null ? '≈ ' + fmtGbpPlain(p.gain_gbp) : ''}</span>
          </div>`).join('')}
        </div>
      </div>`);
    }
    // Step 2: Choose method based on what you want
    steps.push(`<div class="pb-exec-step">
      <div class="pb-exec-num">2</div>
      <div class="pb-exec-body">
        <b>Choose your exit method in T212</b>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
          <div style="padding:8px;background:var(--bg2);border-radius:6px;border-left:3px solid var(--green)">
            <b style="font-size:13px">Option A — Partial Withdraw (easiest)</b>
            <div class="w-dim w-small">Pie → "Withdraw" → enter £ amount → T212 sells proportionally across ALL holdings. Preserves your allocation weights. Best for clean cash-out.</div>
          </div>
          <div style="padding:8px;background:var(--bg2);border-radius:6px;border-left:3px solid var(--yellow)">
            <b style="font-size:13px">Option B — Sell overweight holdings directly</b>
            <div class="w-dim w-small">Tap a holding inside the pie → "Sell". Target overweight stocks first to fix concentration AND book profit at once. Pie will go off-target — rebalance next investment.</div>
          </div>
        </div>
      </div>
    </div>`);
    // Step 3: Concentration fix — name the culprits
    if (overweight.length) {
      steps.push(`<div class="pb-exec-step">
        <div class="pb-exec-num">3</div>
        <div class="pb-exec-body">
          <b>Fix concentration first</b>
          <div class="w-dim w-small" style="margin-top:3px">These are over the ${maxStock}% limit — Option B targets here:</div>
          ${overweight.map(r => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${r.display || r.ticker} <span class="w-dim w-small">${r.pie}</span></span>
            <span class="red" style="font-weight:600">${fmt(r.weight_pct, 1)}% <span class="w-dim w-small">(limit ${maxStock}%)</span></span>
          </div>`).join('')}
        </div>
      </div>`);
    }
    // Step 4: Timing warning
    steps.push(`<div class="pb-exec-step">
      <div class="pb-exec-num">${overweight.length ? 4 : 3}</div>
      <div class="pb-exec-body">
        <b>When to do it</b>
        <div class="w-dim w-small" style="margin-top:3px">T212 executes at market price (fractional shares). Best done during market hours for liquid ETFs — avoid after-hours for stocks. Settlement is T+2 so the cash clears in 2 business days.</div>
        <div style="margin-top:6px;padding:7px 10px;background:rgba(239,68,68,.08);border-radius:6px;border-left:3px solid var(--red);font-size:12px">
          😈 Devil's advocate: market up 1 day ≠ peak. If you're ISA-sheltered, the tax argument disappears. Selling your best performers removes the engine of your gains. Consider: is this booking profit, or just reducing exposure because you're nervous?
        </div>
      </div>
    </div>`);
    const badgeId = `id="pb-exec-badge" style="${isUp ? 'background:rgba(34,197,94,.15);color:var(--green)' : 'background:rgba(245,158,11,.15);color:var(--yellow)'};border-radius:5px;padding:2px 7px;font-size:12px"`;
    return `<div class="card" style="border-left:3px solid var(--accent)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0">🎯 How to cash out</h3><span ${badgeId}>Market ${(regData || {}).mode || 'Unknown'}</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Step-by-step — T212 has no "sell profit only" button. Here's how to do it given your portfolio.</div>
      <div class="pb-exec-steps">${steps.join('')}</div>
    </div>`;
  }
  const executePanel = pbExecuteSteps(s.pies, rows, reg, tot);

  // ── Layer 1: market
  const idx = (n, t) => t ? `<tr><td>${n}</td><td>${pbTick(t.above50)}</td><td>${pbTick(t.above200)}</td><td class="${clr(t.ret3m)}">${fmt(t.ret3m, 1)}%</td></tr>` : '';
  const market = `
    <div class="card"><h3>① Market conditions</h3>
      <div style="font-size:11px;margin-bottom:6px"><span id="pb-regime-freshness" style="color:var(--muted)">📸 Snapshot · ${upd}</span></div>
      <table id="pb-mkt-table" class="pb-rules" style="width:100%"><tr><th>Index</th><th>&gt; 50 DMA</th><th>&gt; 200 DMA</th><th>3-month</th></tr>
        ${idx('S&amp;P 500', reg.spx)}${idx('MSCI ACWI', reg.acwi)}</table>
      <div class="pb-kv">
        <div id="pb-mkt-vix"><b>VIX</b>${reg.vix ?? '—'} ${reg.vix != null ? (reg.vix < 20 ? '<span class="green">calm</span>' : reg.vix > 28 ? '<span class="red">stressed</span>' : '<span class="yellow">elevated</span>') : ''}</div>
        <div><b>Breadth</b>${reg.breadth_pct ?? '—'}% of holdings above 50 DMA</div>
      </div>
      <div style="font-size:12px;color:var(--muted)">Aggressive ≥ 4 pts · Neutral 2–3 · Defensive ≤ 1. Each index above its 50/200 DMA +1, VIX &lt; 20 +1 (&gt; 28 −1), breadth ≥ 60% +1 (&lt; 40% −1).</div>
    </div>`;

  // ── Watch-outs
  const notes = (s.notes || []).length ? `<div class="card"><h3>⚠️ Watch-outs</h3><div id="pb-watchouts-body">${s.notes.map(n => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)">${n}</div>`).join('')}</div></div>` : '';

  // ── Layer 2 + 5: sector & pie exposure
  const maxSec = lim.max_sector_pct || 25;
  const snapshotNote = `<div style="font-size:11px;color:var(--muted);margin-bottom:6px">📸 Pipeline snapshot · ${upd} — sector weights need a full pipeline run to refresh</div>`;
  const sectors = `
    <div class="card"><h3>② Sector exposure (look-through) — cap ${maxSec}%</h3>
      ${snapshotNote}
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
      ${snapshotNote}
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
            · 50/200 DMA <span id="pb-dma-${r.yahoo_ticker ? r.yahoo_ticker.replace(/[^a-zA-Z0-9]/g, '_') : i}" data-pb-dma="${r.yahoo_ticker || ''}">${pbTick(sig.above50)}${pbTick(sig.above200)}</span> · Sector: ${r.sector}</div>
          ${factors}
          ${protect}
          ${ladder}
          ${(r.notes || []).map(n => `<div style="color:var(--yellow);margin-top:4px">• ${n}</div>`).join('')}
        </div>
      </div>`;
  };
  const holdings = `
    <div class="card"><h3>③④ Holdings — weekly score &amp; action</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Score: 80–100 let it run · 65–79 hold &amp; monitor · 50–64 consider partial booking · &lt;50 reassess. Tap a row for detail.</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px">📸 Scores/signals: Pipeline snapshot · ${upd} &nbsp;|&nbsp; <span id="pb-dma-freshness">⏳ Refreshing 50/200 DMA…</span></div>
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

  el.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Pipeline run: ${upd}</div>`
    + stats + executePanel + notes + `<div class="grid2">${market}${sectors}</div>` + holdings + pies + pbPieCard(s, rows) + rules;
  // Fire-and-forget: overlay live market + DMA data onto the snapshot
  pbPatchLiveRegime(reg).catch(() => {});
  pbPatchLiveHoldingDMAs(rows).catch(() => { const l = document.getElementById('pb-dma-freshness'); if (l) l.textContent = '⚠ Could not refresh DMA'; });
}

function pbToggle(i) {
  const b = document.getElementById('pb-body-' + i), c = document.getElementById('pb-chev-' + i);
  const open = b.classList.toggle('open');
  if (c) c.textContent = open ? '▲' : '▼';
}
