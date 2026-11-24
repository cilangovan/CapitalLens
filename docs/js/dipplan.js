// ── DIP PLANNER (Strategy tab) ────────────────────────────────
// No fixed budget. You type an amount (£100, £200 …) when the market dips; this turns it into a plan:
//   which pies to invest in and which to hold, how much per pie, how much per stock, and whether to put it
//   across the whole pie (its own weights) or custom-balance it.
// Pure maths first (dipPlanCompute, unit-tested in tests/dipplan_test.mjs), then the card.
// Inputs are the Entry Analysis rows (value_buy_scores) + the pies from the latest snapshot + the market mood
// from the strategy row, all produced by Refresh. Nothing is invented: a signal with no data is left out and
// the others are re-weighted, and the card says so.

const DP_WEIGHTS = { rsi: 18, momentum: 10, volume: 6, flow: 6, entry: 20, dip: 10, pe: 12, quality: 18 };      // sums to 100
const DP_LABELS  = { rsi: 'RSI', momentum: 'Momentum', volume: 'Volume', flow: 'Order flow (est.)', entry: 'Entry point', dip: 'Dip depth', pe: 'PE ratio', quality: 'Quality score' };
const DP_DIRECT_PIES = ['', 'individual', 'untagged', 'solo'];                                              // holdings that are not inside a Trading 212 pie
const DP_FRACTION = { strong: 1, moderate: 0.5, none: 0 };                                                  // how much of the amount to deploy

function dpNum(x) { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function dpEsc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); }
function dpGbp(n) { n = Number(n) || 0; return '£' + (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2)); }
function dpRound(x, d) { const f = Math.pow(10, d || 0); return Math.round((x + Number.EPSILON) * f) / f; }
function dpParse(v) { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return {}; } }

// Split `total` (pounds) by `weights`, in whole pence, so the parts add up exactly (largest remainder).
function dpSplit(total, weights) {
  const pence = Math.round(total * 100), sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (!(sum > 0)) return weights.map(() => 0);
  const raw = weights.map(w => pence * w / sum), base = raw.map(Math.floor);
  let left = pence - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  return base.map(p => p / 100);
}

// Trading 212 tickers look like NVDA_US_EQ / VUSAa_EQ, Yahoo ones like NVDA / VUSA.AS. Used only when a row has no saved t212 ticker.
function dpKey(t) { t = String(t || '').toUpperCase(); return t.split('.')[0].split('_')[0]; }
function dpKeyT212(t) { const b = String(t || '').split('_')[0]; return (/^[A-Z]{3,}[a-z]$/.test(b) ? b.slice(0, -1) : b).toUpperCase(); }

// ── One stock: eight signals → a 0-100 buy score, an overbought flag and a decision ──
function dpSignals(st, mood) {
  const w = st.w || {}, cur = dpNum(w.current), hi = dpNum(w.high_52w), lo = dpNum(w.low_52w), tgt = dpNum(w.price);
  const rsi = dpNum(w.rsi), m4 = dpNum(w.mom_4w), m1 = dpNum(w.mom_1w), vr = dpNum(w.vol_ratio), pe = dpNum(w.pe), fpe = dpNum(w.fwd_pe);
  const S = {};
  // RSI: oversold is the dip we want; overbought is the thing to avoid
  if (rsi !== null) S.rsi = { score: rsi < 30 ? 1 : rsi < 40 ? 0.85 : rsi < 50 ? 0.65 : rsi < 60 ? 0.4 : rsi < 70 ? 0.15 : 0, value: rsi,
    note: `RSI ${rsi} — ${rsi < 30 ? 'oversold' : rsi < 40 ? 'weak, near oversold' : rsi < 50 ? 'soft' : rsi < 60 ? 'neutral' : rsi < 70 ? 'strong, getting stretched' : 'overbought'}` };
  // Momentum: down over 4 weeks but turning up this week is best; still sliding hard is a falling knife
  if (m4 !== null || m1 !== null) {
    let sc, nt; const a = m4, b = m1 === null ? 0 : m1;
    if (a === null) { sc = b >= 0 ? 0.6 : 0.4; nt = `${b >= 0 ? '+' : ''}${b}% this week`; }
    else if (a <= -15 && b < 0) { sc = 0.2; nt = `down ${Math.abs(a)}% in 4 weeks and still falling — wait for a bounce`; }
    else if (a <= -3 && b >= 0) { sc = 1; nt = `down ${Math.abs(a)}% in 4 weeks, bouncing this week — turning`; }
    else if (a < 0 && b < 0) { sc = 0.5; nt = `down ${Math.abs(a)}% in 4 weeks, still sliding`; }
    else if (a < 0) { sc = 0.7; nt = `slightly down over 4 weeks (${a}%)`; }
    else if (a <= 10) { sc = 0.45; nt = `+${a}% in 4 weeks — no real dip`; }
    else if (a <= 15) { sc = 0.3; nt = `+${a}% in 4 weeks — running up`; }
    else { sc = 0.15; nt = `+${a}% in 4 weeks — extended`; }
    S.momentum = { score: sc, value: a, note: 'Momentum: ' + nt };
  }
  // Volume: heavy volume on a bounce = buyers; heavy volume on a fall = selling pressure
  if (vr !== null) {
    const up = (m1 !== null ? m1 : (m4 !== null ? m4 : 0)) >= 0;
    S.volume = vr >= 1.3 ? { score: up ? 1 : 0.35, value: vr, note: up ? `Volume ${vr}× normal on a rise — buyers stepping in` : `Volume ${vr}× normal on a fall — selling pressure` }
      : vr >= 0.8 ? { score: 0.6, value: vr, note: `Volume ${vr}× normal — nothing unusual` } : { score: 0.4, value: vr, note: `Volume ${vr}× normal — thin, weak conviction` };
  }
  // Order flow (ESTIMATED from candle volume and close position; not real orders). Only used when it could be verified.
  const fs_ = w.flow_state, fsc = dpNum(w.flow_score);
  if (fsc !== null && fs_ && fs_ !== 'unverified') S.flow = { score: fsc, value: fs_, note: 'Order flow (estimated): ' + (w.flow_note || fs_) };
  // Entry point: price vs this week's target entry (60%) and where it sits in the 52-week range (40%)
  let eT = null, eR = null, en = [];
  if (cur !== null && tgt !== null && tgt > 0) { const gap = (cur - tgt) / tgt * 100; eT = gap <= 0 ? 1 : gap <= 3 ? 0.75 : gap <= 8 ? 0.4 : 0.15; en.push(gap <= 0 ? 'at or below the target entry' : `${dpRound(gap, 1)}% above the target entry`); }
  if (cur !== null && hi !== null && lo !== null && hi > lo) { const p = (cur - lo) / (hi - lo); eR = p < 0.3 ? 1 : p < 0.5 ? 0.75 : p < 0.7 ? 0.45 : 0.15; en.push(`${Math.round(p * 100)}% up the 52-week range`); }
  if (eT !== null || eR !== null) S.entry = { score: eT !== null && eR !== null ? 0.6 * eT + 0.4 * eR : (eT !== null ? eT : eR), value: eT !== null ? dpRound((cur - tgt) / tgt * 100, 1) : null, note: 'Entry: ' + en.join(', ') };
  // Dip depth: how far below the 52-week high; fear in the market makes a real dip count a bit more
  if (cur !== null && hi !== null && hi > 0) {
    const dd = (hi - cur) / hi * 100; let sc = dd >= 25 ? 1 : dd >= 15 ? 0.85 : dd >= 8 ? 0.6 : dd >= 3 ? 0.35 : 0.1;
    if (mood && mood.level >= 2 && dd >= 8) sc = Math.min(1, sc + 0.1);
    S.dip = { score: sc, value: dpRound(dd, 1), note: `${dpRound(dd, 1)}% below the 52-week high` };
  }
  // PE: cheaper is better; ETFs and loss-makers have none, so they are scored on the other signals only
  if (pe !== null && pe > 0) S.pe = { score: pe < 15 ? 1 : pe < 25 ? 0.75 : pe < 35 ? 0.5 : pe < 50 ? 0.25 : 0.1, value: pe,
    note: `PE ${dpRound(pe, 1)}${fpe !== null && fpe > 0 ? ` (forward ${dpRound(fpe, 1)})` : ''} — ${pe < 15 ? 'cheap' : pe < 25 ? 'fair' : pe < 35 ? 'full' : pe < 50 ? 'expensive' : 'very expensive'}` };
  // Quality: the Entry Analysis score (business quality, financials, momentum, valuation, risk)
  const q = dpNum(st.score); if (q !== null) S.quality = { score: Math.max(0, Math.min(1, q / 100)), value: q, note: `Entry Analysis ${q}/100${st.verdict ? ' · ' + st.verdict : ''}` };
  return S;
}

function dpScoreStock(st, mood) {
  const S = dpSignals(st, mood), w = st.w || {};
  let num = 0, den = 0; for (const k of Object.keys(S)) { num += DP_WEIGHTS[k] * S[k].score; den += DP_WEIGHTS[k]; }
  const buyScore = den > 0 ? Math.round(num / den * 100) : null, coverage = den;
  const rsi = dpNum(w.rsi), cur = dpNum(w.current), hi = dpNum(w.high_52w);
  const reasonsHold = [];
  if (rsi !== null && rsi >= 70) reasonsHold.push(`overbought (RSI ${rsi})`);
  else if (rsi !== null && rsi >= 65 && cur !== null && hi !== null && cur >= 0.97 * hi) reasonsHold.push(`overbought: RSI ${rsi} at the 52-week high`);
  if (w.action === 'HOLD / AVOID' && !reasonsHold.length) reasonsHold.push('Entry Analysis says hold / avoid this week');
  const overbought = reasonsHold.length > 0;
  let decision;
  if (buyScore === null) decision = 'HOLD';
  else if (overbought) decision = 'HOLD';
  else decision = buyScore >= 80 ? 'STRONG BUY' : buyScore >= 72 ? 'BUY' : buyScore >= 58 ? 'ACCUMULATE' : 'HOLD';
  if (decision === 'HOLD' && !reasonsHold.length) reasonsHold.push(buyScore === null ? 'no signals available' : `score ${buyScore}/100 is too low to add`);
  const ranked = Object.keys(S).sort((a, b) => Math.abs(S[b].score - 0.5) * DP_WEIGHTS[b] - Math.abs(S[a].score - 0.5) * DP_WEIGHTS[a]);
  return { signals: S, buyScore, coverage, overbought, decision, holdReason: decision === 'HOLD' ? reasonsHold.join('; ') : null, why: ranked.slice(0, 2).map(k => S[k].note) };
}

// ── The market: is it a dip, and how fearful is it? ──
function dpMarket(mood, scored) {
  const m = mood || null, lvl = m && Number.isFinite(+m.level) ? +m.level : null, spx = m ? dpNum(m.spx_drawdown) : null, vix = m ? dpNum(m.vix) : null;
  const dds = scored.map(s => dpNum((s.w || {}).high_52w) && dpNum((s.w || {}).current) ? (s.w.high_52w - s.w.current) / s.w.high_52w * 100 : null).filter(x => x !== null);
  const deep = dds.filter(x => x >= 8).length, breadth = dds.length ? deep / dds.length : null;
  const reasons = []; let level = 'none';
  if (lvl !== null && lvl >= 2) { level = 'strong'; reasons.push(`market mood is ${m.label || (lvl === 3 ? 'Extreme fear' : 'Fear')}${vix !== null ? ` (VIX ${vix})` : ''}`); }
  if (spx !== null && spx >= 8) { level = 'strong'; reasons.push(`S&P 500 is ${spx}% below its high`); }
  if (level === 'none' && spx !== null && spx >= 4) { level = 'moderate'; reasons.push(`S&P 500 is ${spx}% below its high`); }
  if (level === 'none' && breadth !== null && breadth >= 0.4) { level = 'moderate'; reasons.push(`${deep} of ${dds.length} holdings are 8%+ below their highs`); }
  if (level === 'strong' && breadth !== null && breadth >= 0.4 && spx === null) reasons.push(`${deep} of ${dds.length} holdings are 8%+ below their highs`);
  if (!reasons.length) reasons.push(m ? `no dip: mood ${m.label || 'normal'}${vix !== null ? `, VIX ${vix}` : ''}${spx !== null ? `, S&P ${spx}% off its high` : ''}` : 'no market reading yet (press Refresh), so only the holdings themselves were checked');
  const fg = lvl === null ? { label: 'Not available', icon: '❔' } : { label: ['Greed / calm', 'Normal', 'Fear', 'Extreme fear'][Math.max(0, Math.min(3, lvl))], icon: ['😎', '🙂', '😨', '😱'][Math.max(0, Math.min(3, lvl))] };
  return { level, reasons, fearGreed: fg, vix, spxDrawdown: spx, breadth: breadth === null ? null : { deep, of: dds.length, pct: Math.round(breadth * 100) } };
}

// input: { amount, stocks:[{ticker,t212,display,pie,score,verdict,w:{…this_week}}], pies:{ 'Pie name': [{ticker,expected,current}] }, mood:{level,label,vix,spx_drawdown}|null, force:boolean }
function dpPlanCompute(inp) {
  const amount = dpNum(inp.amount);
  if (amount === null || amount <= 0) return { error: 'Enter an amount above £0.' };
  const stocks = (inp.stocks || []).filter(s => s && s.ticker);
  if (!stocks.length) return { error: 'No Entry Analysis data yet. Press Refresh (⚙ Settings) so there are signals to work from.' };
  const mood = inp.mood || null, pieMap = inp.pies || {};
  const scored = stocks.map(s => Object.assign({}, s, dpScoreStock(s, mood)));
  const mk = dpMarket(mood, stocks), forced = !!inp.force && mk.level === 'none';
  const fraction = forced ? 1 : DP_FRACTION[mk.level], deployable = dpRound(amount * fraction, 2), holdCash = dpRound(amount - deployable, 2);
  const notes = [], warnings = [];

  // group by pie (membership comes from the saved snapshot, never from names in the code)
  const groups = new Map();
  for (const s of scored) { const direct = DP_DIRECT_PIES.includes(String(s.pie || '').trim().toLowerCase()), name = direct ? 'Not in a pie' : String(s.pie).trim(); if (!groups.has(name)) groups.set(name, { name, direct, stocks: [] }); groups.get(name).stocks.push(s); }

  // target + current weight of each stock inside its pie, from the snapshot
  for (const g of groups.values()) {
    const members = g.direct ? [] : (Object.entries(pieMap).find(([k]) => k.trim() === g.name) || [null, []])[1] || [];
    let known = 0;
    for (const s of g.stocks) {
      const hit = members.find(m => (s.t212 && m.ticker === s.t212) || (!s.t212 && dpKeyT212(m.ticker) === dpKey(s.ticker)));
      s.target = hit && dpNum(hit.expected) !== null ? dpNum(hit.expected) : null; s.now = hit && dpNum(hit.current) !== null ? dpNum(hit.current) : null; if (s.target !== null) known++;
    }
    g.weightsKnown = !g.direct && known === g.stocks.length;
    if (!g.direct && !g.weightsKnown) { const eq = 1 / g.stocks.length; for (const s of g.stocks) if (s.target === null) s.target = eq; g.weightsGuessed = true; }
    if (!g.direct) { const t = g.stocks.reduce((a, s) => a + s.target, 0); if (t > 0) for (const s of g.stocks) s.target = s.target / t; }
    g.avgScore = Math.round(g.stocks.reduce((a, s) => a + (s.buyScore || 0), 0) / g.stocks.length);
    g.eligible = g.stocks.filter(s => s.decision !== 'HOLD');
    g.strength = g.eligible.reduce((a, s) => a + (s.buyScore - 50), 0);
    g.verdict = g.eligible.length && g.avgScore >= 50 ? 'INVEST' : 'HOLD';
    g.holdReason = g.verdict === 'HOLD' ? (g.eligible.length ? `pie average score ${g.avgScore}/100 is too weak to add` : g.stocks.every(s => s.overbought) ? 'everything in it is overbought right now' : 'no stock in it passes the buy checks') : null;
  }
  const invest = [...groups.values()].filter(g => g.verdict === 'INVEST'), hold = [...groups.values()].filter(g => g.verdict === 'HOLD');

  // pie amounts: by buy strength, no single pie above its cap (diversify)
  if (invest.length && deployable > 0) {
    const cap = invest.length >= 3 ? 0.5 : invest.length === 2 ? 0.65 : 1; let share = new Map(invest.map(g => [g, g.strength / invest.reduce((a, x) => a + x.strength, 0)]));
    for (let i = 0; i < 6; i++) {
      const over = [...share].filter(([, v]) => v > cap + 1e-9); if (!over.length) break;
      let excess = 0; for (const [g, v] of over) { excess += v - cap; share.set(g, cap); }
      const free = [...share].filter(([, v]) => v < cap - 1e-9), fs = free.reduce((a, [, v]) => a + v, 0);
      if (!free.length || fs <= 0) break; for (const [g, v] of free) share.set(g, v + excess * v / fs);
    }
    const parts = dpSplit(deployable, invest.map(g => share.get(g)));
    invest.forEach((g, i) => { g.amount = parts[i]; g.share = share.get(g); });
  }
  for (const g of invest) { if (g.amount === undefined) g.amount = 0; }
  for (const g of hold) g.amount = 0;

  // inside each pie: custom (tilted to the signals) vs whole pie (its own target weights)
  for (const g of invest) {
    const el = g.stocks.filter(s => s.decision !== 'HOLD'), cw = el.map(s => s.buyScore - 50), cparts = dpSplit(g.amount, cw);
    g.stocks.forEach(s => { s.amountCustom = 0; }); el.forEach((s, i) => { s.amountCustom = cparts[i]; });
    if (g.direct) { g.mode = 'DIRECT'; g.stocks.forEach(s => { s.amountWhole = s.amountCustom; }); g.tilt = null; continue; }
    const wparts = dpSplit(g.amount, g.stocks.map(s => s.target)); g.stocks.forEach((s, i) => { s.amountWhole = wparts[i]; });
    const cshare = g.amount > 0 ? g.stocks.map(s => s.amountCustom / g.amount) : g.stocks.map(() => 0);
    g.tilt = dpRound(0.5 * g.stocks.reduce((a, s, i) => a + Math.abs(cshare[i] - s.target), 0), 3);
    g.mode = g.tilt < 0.15 ? 'WHOLE' : 'CUSTOM';
    g.skip = g.stocks.filter(s => s.decision === 'HOLD');
  }
  const shape = g => ({ pie: g.name, direct: g.direct, verdict: g.verdict, amount: g.amount, share: g.share === undefined ? 0 : dpRound(g.share, 3), mode: g.mode || null, tilt: g.tilt === undefined ? null : g.tilt,
    avgScore: g.avgScore, holdReason: g.holdReason, weightsKnown: !!g.weightsKnown, weightsGuessed: !!g.weightsGuessed,
    skipped: (g.skip || []).map(s => s.display || s.ticker),
    stocks: g.stocks.slice().sort((a, b) => (b.buyScore || 0) - (a.buyScore || 0)).map(s => ({ ticker: s.ticker, display: s.display || s.ticker, decision: s.decision, buyScore: s.buyScore, coverage: s.coverage, overbought: s.overbought, holdReason: s.holdReason,
      why: s.why, signals: s.signals, target: s.target === undefined ? null : s.target, now: s.now === undefined ? null : s.now, amountCustom: s.amountCustom || 0, amountWhole: s.amountWhole || 0, price: dpNum((s.w || {}).current), cur: s.currency_symbol || '' })) });
  const pies = [...invest.sort((a, b) => b.amount - a.amount), ...hold.sort((a, b) => b.avgScore - a.avgScore)].map(shape);

  if (mk.level === 'none' && !forced) notes.push('No market dip right now, so this plan holds your cash. Tick “plan anyway” to see where it would go.');
  if (mk.level === 'moderate' && !forced) notes.push(`Only a moderate dip, so the plan uses half of your amount (${dpGbp(deployable)}) and keeps ${dpGbp(holdCash)} back for a deeper dip.`);
  if (forced) notes.push('Planned anyway: there is no dip, so these are the best places to put it, not a dip signal.');
  if (deployable > 0 && !invest.length) { warnings.push('Nothing passes the buy checks right now (everything is overbought or weak), so the money stays in cash.'); }
  const unspent = deployable > 0 && !invest.length ? deployable : 0;
  const lowCov = scored.filter(s => s.coverage < 50).length; if (lowCov) warnings.push(`${lowCov} holding${lowCov === 1 ? ' has' : 's have'} few signals (data missing), so ${lowCov === 1 ? 'its' : 'their'} score is less reliable.`);
  const noPe = scored.filter(s => !s.signals.pe).length; if (noPe) notes.push(`${noPe} holding${noPe === 1 ? ' has' : 's have'} no PE (ETFs or no earnings): scored on the other signals.`);
  const guessed = [...groups.values()].filter(g => g.weightsGuessed).map(g => g.name); if (guessed.length) warnings.push(`Pie weights not found for ${guessed.join(', ')}: equal weights assumed. Press Refresh to read them from Trading 212.`);
  return { amount, deployable: dpRound(deployable - unspent, 2), holdCash: dpRound(holdCash + unspent, 2), fraction, forced, market: mk, pies, notes, warnings };
}

// ── The card ──────────────────────────────────────────────────
const _dp = { stocks: [], pies: {}, mood: null, updated: null, amount: '' };
const DP_DECISION = { 'STRONG BUY': ['#22c55e', '🚀'], 'BUY': ['#22c55e', '📈'], 'ACCUMULATE': ['#60a5fa', '🔵'], 'HOLD': ['#94a3b8', '⏸'] };

async function loadDipPlanner(vbRows, stratRow) {
  const el = document.getElementById('dip-planner-content'); if (!el) return;
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) { el.innerHTML = ''; return; }
  let snap = null; try { snap = ((await api('portfolio_snapshots', '?select=raw&order=created_at.desc&limit=1')) || [])[0]; } catch (e) {}
  const raw = dpParse(snap && snap.raw), pies = {};
  for (const p of raw.pies || []) if (p && p.name) pies[String(p.name).trim()] = (p.instruments || []).map(i => ({ ticker: i.ticker, expected: i.expected, current: i.current }));
  _dp.pies = pies; _dp.mood = stratRow ? dpParse(stratRow.market_mood) : null; if (_dp.mood && !Object.keys(_dp.mood).length) _dp.mood = null;
  _dp.stocks = (vbRows || []).map(v => { const w = dpParse(v.this_week); return { ticker: v.ticker, t212: w.t212 || null, display: v.display, pie: v.pie, score: v.score, verdict: v.verdict, currency_symbol: v.currency_symbol, w }; });
  const dates = (vbRows || []).map(v => Date.parse(v.updated_at)).filter(Number.isFinite); _dp.updated = dates.length ? Math.max(...dates) : null;
  const stale = _dp.updated && (Date.now() - _dp.updated) > 3 * 86400000;
  const when = _dp.updated ? new Date(_dp.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const chips = [50, 100, 200, 500].map(n => `<button type="button" class="dp-chip" onclick="dipPlanSet(${n})">£${n}</button>`).join('');
  el.innerHTML = `
    <div class="card" id="dip-planner-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 4px">💧 Dip Planner</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:12px">No fixed budget. Enter what you want to invest when the market dips and get the plan: which pies to buy or hold, how much per pie and per stock.</div>
      <style>
        #dip-planner-card .dp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
        #dip-planner-card .dp-in{flex:1 1 140px;min-width:0;min-height:44px;box-sizing:border-box;background:var(--bg3,#0d1b2e);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:16px}
        #dip-planner-card .dp-go{flex:0 0 auto;min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:var(--accent,#6366f1);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
        #dip-planner-card .dp-chip{min-height:44px;min-width:56px;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-size:13px;cursor:pointer}
        #dip-planner-card .dp-pie{border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:10px}
        #dip-planner-card .dp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;cursor:pointer;background:#0d1b2e;min-height:44px}
        #dip-planner-card .dp-body{display:none;padding:10px 12px;border-top:1px solid var(--border);background:var(--bg)}
        #dip-planner-card .dp-st{padding:8px 0;border-bottom:1px solid #1e293b}
        #dip-planner-card .dp-st:last-child{border-bottom:0}
        #dip-planner-card .dp-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        #dip-planner-card .dp-sig{display:inline-block;font-size:10px;padding:2px 6px;border-radius:6px;margin:2px 3px 0 0;white-space:nowrap}
        #dip-planner-card .dp-pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap}
        #dip-planner-card .dp-small{font-size:11px;color:var(--muted);word-break:break-word}
      </style>
      <div class="dp-row">
        <input id="dp-amount" class="dp-in" type="number" inputmode="decimal" min="1" step="1" placeholder="Amount in £, e.g. 100" onkeydown="dipPlanKey(event)">
        <button type="button" class="dp-go" onclick="dipPlanRun()">Plan it</button>
      </div>
      <div class="dp-row">${chips}</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);min-height:40px"><input id="dp-force" type="checkbox" onchange="dipPlanRun(true)"> Plan it even if there is no market dip</label>
      <div class="dp-small" style="margin-bottom:8px">${when ? `Signals from your last Refresh: ${dpEsc(when)}.${stale ? ' <span style="color:#f59e0b">That is more than 3 days old, so press Refresh first.</span>' : ''}` : 'No signals yet: press Refresh.'}</div>
      <div id="dp-result" aria-live="polite"></div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--muted);min-height:40px;display:flex;align-items:center">How the plan is worked out</summary>
        <div class="dp-small" style="line-height:1.6;padding:6px 2px">
          <b>1. Is it a dip?</b> Strong when the market mood is Fear or Extreme fear (VIX 20+) or the S&amp;P 500 is 8%+ below its high: your full amount is used. Moderate when the S&amp;P is 4–8% down or 40%+ of your holdings are 8%+ below their highs: half is used. Otherwise cash is held.<br>
          <b>2. Score each stock out of 100:</b> ${Object.keys(DP_WEIGHTS).map(k => `${DP_LABELS[k]} ${DP_WEIGHTS[k]}`).join(' · ')}. A signal with no data is left out and the rest re-weighted.<br>
          <b>3. Decide:</b> 80+ strong buy, 72+ buy, 58+ accumulate, below that hold. RSI 70+, or RSI 65+ at the 52-week high, or an Entry Analysis “hold / avoid” means overbought: no new money.<br>
          <b>4. Pies:</b> a pie is invested if some stock passes and its average score is 50+. Money is split by buy strength, no pie above 50% (65% with two pies).<br>
          <b>5. Whole pie or custom:</b> if the signal split is within 15 points of the pie’s own weights, add to the whole pie. Otherwise custom-balance towards the stocks shown.<br>
          <b>Sources:</b> prices, RSI, volume, momentum and PE are Yahoo daily data from your last Refresh. Fear &amp; Greed here is CapitalLens’ own reading (VIX, S&amp;P drawdown, news headlines), not CNN’s index. Pie weights are from your Trading 212 pies. This is a rule-based screen, not advice.
        </div></details>
    </div>`;
  if (_dp.amount) { const i = document.getElementById('dp-amount'); if (i) i.value = _dp.amount; }
}

function dipPlanKey(e) { if (e && e.key === 'Enter') dipPlanRun(); }

function dipPlanSet(n) { const i = document.getElementById('dp-amount'); if (i) { i.value = String(n); } dipPlanRun(); }

function dipPlanRun(fromCheckbox) {
  const out = document.getElementById('dp-result'), inp = document.getElementById('dp-amount'), force = document.getElementById('dp-force');
  if (!out || !inp) return;
  if (fromCheckbox === true && !String(inp.value).trim()) return;
  _dp.amount = inp.value;
  const plan = dpPlanCompute({ amount: inp.value, stocks: _dp.stocks, pies: _dp.pies, mood: _dp.mood, force: !!(force && force.checked) });
  out.innerHTML = plan.error ? `<div style="padding:10px 12px;border-radius:8px;background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;font-size:12px">${dpEsc(plan.error)}</div>` : dpRenderPlan(plan);
}

function dipPlanToggle(id) {
  const b = document.getElementById(id), c = document.getElementById(id + '-chev'); if (!b) return;
  const open = b.style.display === 'block'; b.style.display = open ? 'none' : 'block'; if (c) c.textContent = open ? '▼' : '▲';
}

function dpRenderPlan(p) {
  const lvlMeta = { strong: ['#22c55e', 'Market dip: deploy', '🟢'], moderate: ['#e8a838', 'Moderate dip: deploy half', '🟡'], none: ['#94a3b8', 'No market dip: hold cash', '⚪'] }[p.market.level];
  const sigChip = (k, s) => {
    if (!s) return `<span class="dp-sig" style="background:#1e293b;color:#64748b">${DP_LABELS[k]} n/a</span>`;
    const c = s.score >= 0.7 ? '#22c55e' : s.score >= 0.4 ? '#e8a838' : '#ef4444', v = s.value === null || s.value === undefined ? '' : ' ' + (k === 'volume' ? s.value + '×' : k === 'momentum' ? (s.value >= 0 ? '+' : '') + s.value + '%' : k === 'entry' ? (s.value > 0 ? '+' : '') + s.value + '%' : k === 'dip' ? '−' + s.value + '%' : s.value);
    return `<span class="dp-sig" style="background:${c}22;color:${c}">${DP_LABELS[k]}${dpEsc(v)}</span>`;
  };
  const stockHtml = (g, s) => {
    const dm = DP_DECISION[s.decision] || DP_DECISION.HOLD, tgt = s.target === null ? '' : `target ${Math.round(s.target * 100)}%`, now = s.now === null ? '' : `now ${Math.round(s.now * 100)}%`;
    const amt = g.verdict === 'INVEST' ? (g.mode === 'WHOLE' ? s.amountWhole : s.amountCustom) : 0, alt = g.mode === 'CUSTOM' ? `whole pie ${dpGbp(s.amountWhole)} · custom ${dpGbp(s.amountCustom)}` : '';
    return `<div class="dp-st">
      <div class="dp-line"><span style="font-weight:700;font-size:12px;flex:1 1 120px;min-width:0;word-break:break-word">${dpEsc(s.display)}</span>
        <span class="dp-pill" style="background:${dm[0]}22;color:${dm[0]}">${dm[1]} ${dpEsc(s.decision)}</span>
        <span style="font-weight:800;font-size:14px;color:${amt > 0 ? '#22c55e' : '#94a3b8'}">${amt > 0 ? dpGbp(amt) : '—'}</span></div>
      <div class="dp-small">Score ${s.buyScore === null ? 'n/a' : s.buyScore + '/100'}${[tgt, now].filter(Boolean).length ? ' · ' + [tgt, now].filter(Boolean).join(' · ') : ''}${alt ? ' · ' + alt : ''}</div>
      <div>${['rsi', 'momentum', 'volume', 'pe', 'entry', 'dip', 'quality'].map(k => sigChip(k, s.signals[k])).join('')}</div>
      <div class="dp-small" style="margin-top:3px">${s.decision === 'HOLD' ? dpEsc(s.holdReason || '') : dpEsc((s.why || []).join(' · '))}</div>
    </div>`;
  };
  const pieHtml = (g, i) => {
    const id = 'dp-pie-' + i, inv = g.verdict === 'INVEST', c = inv ? '#22c55e' : '#94a3b8';
    const modeTxt = !inv ? g.holdReason : g.mode === 'DIRECT' ? 'Buy these stocks directly (they are not in a pie)' : g.mode === 'WHOLE' ? 'Invest in the whole pie: its own weights already suit the signals' : `Custom balance: put it into ${g.stocks.filter(s => s.decision !== 'HOLD').map(s => dpEsc(s.display)).join(', ')}${g.skipped.length ? `; skip ${g.skipped.map(dpEsc).join(', ')}` : ''}`;
    return `<div class="dp-pie" style="border-color:${c}55">
      <div class="dp-head" onclick="dipPlanToggle('${id}')">
        <span style="font-weight:700;font-size:13px;flex:1 1 120px;min-width:0;word-break:break-word">${dpEsc(g.pie)}</span>
        <span class="dp-pill" style="background:${c}22;color:${c}">${inv ? 'INVEST' : 'HOLD'}</span>
        <span style="font-weight:800;font-size:16px;color:${c}">${inv ? dpGbp(g.amount) : '—'}</span>
        <span id="${id}-chev" style="color:var(--muted);font-size:11px">▼</span>
        <div class="dp-small" style="flex:1 0 100%">${modeTxt}${g.weightsGuessed ? ' <span style="color:#f59e0b">(pie weights not found: equal weights assumed)</span>' : ''}</div>
      </div>
      <div class="dp-body" id="${id}">${g.stocks.map(s => stockHtml(g, s)).join('')}</div>
    </div>`;
  };
  const inv = p.pies.filter(g => g.verdict === 'INVEST'), hold = p.pies.filter(g => g.verdict === 'HOLD');
  const mk = p.market, bd = mk.breadth;
  return `
    <div style="padding:10px 12px;border-radius:9px;background:${lvlMeta[0]}14;border:1px solid ${lvlMeta[0]}44;margin-bottom:10px">
      <div style="font-weight:800;font-size:13px;color:${lvlMeta[0]}">${lvlMeta[2]} ${lvlMeta[1]}</div>
      <div class="dp-small" style="margin-top:2px">${mk.reasons.map(dpEsc).join(' · ')}</div>
      <div class="dp-small" style="margin-top:2px">${mk.fearGreed.icon} Fear &amp; Greed: ${dpEsc(mk.fearGreed.label)}${mk.vix !== null ? ` · VIX ${mk.vix}` : ''}${bd ? ` · ${bd.deep}/${bd.of} holdings 8%+ off their highs` : ''}</div>
    </div>
    <div class="stats-strip" style="margin-bottom:10px">
      <div class="stat-card"><div class="label">You entered</div><div class="value">${dpGbp(p.amount)}</div></div>
      <div class="stat-card"><div class="label">Invest now</div><div class="value green">${dpGbp(p.deployable)}</div><div class="sub">${p.forced ? 'planned anyway' : Math.round(p.fraction * 100) + '% of it'}</div></div>
      <div class="stat-card"><div class="label">Keep in cash</div><div class="value">${dpGbp(p.holdCash)}</div></div>
    </div>
    ${p.warnings.map(w => `<div style="padding:8px 10px;border-radius:7px;background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;margin-bottom:6px;font-size:11px">⚠️ ${dpEsc(w)}</div>`).join('')}
    ${p.notes.map(n => `<div class="dp-small" style="margin-bottom:6px">ℹ️ ${dpEsc(n)}</div>`).join('')}
    ${inv.length ? `<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px">Invest (${inv.length})</div>${inv.map((g, i) => pieHtml(g, i)).join('')}` : ''}
    ${hold.length ? `<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 6px">Hold, no new money (${hold.length})</div>${hold.map((g, i) => pieHtml(g, inv.length + i)).join('')}` : ''}`;
}

if (typeof module !== 'undefined') module.exports = { dpPlanCompute, dpScoreStock, dpSignals, dpSplit, dpMarket, dpKey, dpKeyT212, dpRenderPlan, DP_WEIGHTS };
