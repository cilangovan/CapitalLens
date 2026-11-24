// ── SWING TAB (1–10 day trades) ───────────────────────────────
// Stocks OUTSIDE your pies (untagged holdings + watchlist stocks) that pass the quality bar AND have a valid entry today.
// No valid entry = no recommendation. Nothing is "almost" or "watch": the card says "No entry today" and why.
// Pure maths first (swingSignal, unit-tested in tests/zk_swing_test.mjs and back-tested by scripts/swing_backtest.mjs),
// then the card. The same functions run in the browser, the tests and the back-test, so what is tested is what is shown.
// Inputs: daily candles [t, open, high, low, close, volume] from the dashboard's /chart route. A stock with no volume or
// fewer than 60 bars is "data unverified" and never gets an entry. Earnings dates are NOT checked (no reliable free source).
// Fixed rules, never tuned on the data. The Validation box shows the latest back-test; with no passing back-test the tab shows no entries.

const SW = {
  minBars: 60, holdDays: 10, rr: 2, minTurnover: 1e6, atrMin: 0.01, atrMax: 0.06, maxRiskAtr: 3,
  qualityMin: 60,                                   // Entry Analysis score (or watchlist quality "Good") needed before technicals are even looked at
  cost: 0.004,                                      // round-trip cost assumed in the back-test (spread + FX + slippage)
  gate: { trades: 150, pf: 1.2, oosExpectancy: 0 }  // a back-test must clear this before the tab shows entries
};

function swNum(x) { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; }
function swEsc(s) { return String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])); }
function swR(x, d) { const f = Math.pow(10, d === undefined ? 2 : d); return Math.round((x + Number.EPSILON) * f) / f; }

function swSma(a, n, end) { end = end === undefined ? a.length : end; if (end < n) return null; let s = 0; for (let i = end - n; i < end; i++) s += a[i]; return s / n; }
// Wilder RSI(14) at bar `end` (exclusive end index); closes up to and including end-1
function swRsiSeries(c) {
  const out = new Array(c.length).fill(null); if (c.length < 15) return out;
  let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= 14; l /= 14; out[14] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = 15; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * 13 + (d > 0 ? d : 0)) / 14; l = (l * 13 + (d < 0 ? -d : 0)) / 14; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  return out;
}
function swAtrSeries(h, l, c) {
  const out = new Array(c.length).fill(null); if (c.length < 15) return out;
  const tr = i => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  let a = 0; for (let i = 1; i <= 14; i++) a += tr(i); a /= 14; out[14] = a;
  for (let i = 15; i < c.length; i++) { a = (a * 13 + tr(i)) / 14; out[i] = a; }
  return out;
}
// Clean a candle list: sort, drop bad bars, split into columns
function swCols(candles) {
  const k = (candles || []).filter(b => b && b.length >= 6 && [1, 2, 3, 4].every(j => Number.isFinite(+b[j]) && +b[j] > 0) && +b[2] >= +b[3]).sort((a, b) => a[0] - b[0]);
  return { t: k.map(b => +b[0]), o: k.map(b => +b[1]), h: k.map(b => +b[2]), l: k.map(b => +b[3]), c: k.map(b => +b[4]), v: k.map(b => swNum(b[5])) };
}
// Indicators for the whole series (computed once; the back-test reuses them for every bar)
function swPrep(candles) {
  const X = swCols(candles); X.rsi = swRsiSeries(X.c); X.atr = swAtrSeries(X.h, X.l, X.c); return X;
}

// Evaluate bar i (a COMPLETED daily bar). Returns { entry:false, reasons:[…] } or { entry:true, setup, trigger, stop, target, … }.
// cfg (all optional, default = the original rules): { stopAtr: n  wider stop of n ATR instead of under the last 3 lows, ctx: { idx: {t:[],c:[]} }, regime: true  needs the market above a rising 50-day average, rs: n  needs a 63-day return at least n ahead of the market }
function swingSignal(X, i, cfg) {
  cfg = cfg || {};
  const no = (...reasons) => ({ entry: false, reasons });
  if (i === undefined) i = X.c.length - 1;
  if (i < SW.minBars - 1) return no(`Only ${i + 1} daily bars (need ${SW.minBars}): data unverified`);
  const c = X.c[i], o = X.o[i], atr = X.atr[i], rsi = X.rsi[i];
  if (atr === null || rsi === null) return no('Indicators unavailable: data unverified');
  // volume must exist for the last 21 bars, otherwise the volume rule cannot be checked and there is no entry
  let vs = 0, vn = 0; for (let j = i - 20; j < i; j++) { if (X.v[j] === null || X.v[j] === undefined) return no('No volume data: cannot verify entry volume'); vs += X.v[j]; vn++; }
  const avgV = vs / vn, v = X.v[i]; if (v === null || v === undefined) return no('No volume data today: cannot verify entry volume');
  const turnover = avgV * c; if (turnover < SW.minTurnover) return no('Too thinly traded (average daily turnover under 1 million)');
  const atrPct = atr / c; if (atrPct < SW.atrMin) return no('Too quiet: moves too small to pay for costs in 10 days'); if (atrPct > SW.atrMax) return no('Too volatile: daily range over 6% of price');
  const s20 = swSma(X.c, 20, i + 1), s50 = swSma(X.c, 50, i + 1), s50b = swSma(X.c, 50, i - 9);
  if (s20 === null || s50 === null || s50b === null) return no('Not enough history for the 50-day average');
  if (!(c > s50 && s20 > s50 && s50 > s50b)) return no('Not in an uptrend (needs price above a rising 50-day average)');
  if (rsi > 70) return no(`Overbought (RSI ${swR(rsi, 0)}): no new money`);
  if (c > s20 + 2.5 * atr) return no('Stretched far above its 20-day average: wait for a pullback');
  if (cfg.regime || cfg.rs) {
    const I = cfg.ctx && cfg.ctx.idx; if (!I || I.c.length < 70) return no('Market data unavailable: cannot check the market trend');
    let k = -1; for (let a = 0, b = I.t.length - 1; a <= b;) { const m = (a + b) >> 1; if (I.t[m] <= X.t[i]) { k = m; a = m + 1; } else b = m - 1; }
    if (k < 63) return no('Market data does not reach this date');
    if (cfg.regime) { const m50 = swSma(I.c, 50, k + 1), m50b = swSma(I.c, 50, k - 9); if (!(I.c[k] > m50 && m50 > m50b)) return no('Market is not in an uptrend (S&P 500 below a rising 50-day average): no new entries'); }
    if (cfg.rs) { const r = c / X.c[i - 63] - 1, rm = I.c[k] / I.c[k - 63] - 1; if (!(r - rm >= cfg.rs)) return no('Not a market leader: 3-month return is not ahead of the market'); }
  }
  const volX = v / avgV;
  let hi20 = -Infinity; for (let j = i - 20; j < i; j++) hi20 = Math.max(hi20, X.h[j]);
  let setup = null, why = [];
  // Setup B: breakout through the 20-day high on heavy volume, not already stretched
  if (c > hi20 && volX >= 1.5 && rsi <= 70 && c <= hi20 + atr) { setup = 'Breakout'; why = [`Closed above the 20-day high with ${swR(volX, 1)}× normal volume`, `RSI ${swR(rsi, 0)}`]; }
  // Setup A: pullback inside the uptrend that is turning back up on at least normal volume
  if (!setup) {
    let rMax = 0; for (let j = i - 10; j < i; j++) if (X.rsi[j] !== null) rMax = Math.max(rMax, X.rsi[j]);
    const nearSupport = c <= s20 + 0.5 * atr && c >= s50, turning = c > o && c > X.c[i - 1];
    if (rMax >= 58 && rsi >= 35 && rsi <= 55 && nearSupport && turning && volX >= 1.0) { setup = 'Pullback bounce'; why = [`Pulled back from RSI ${swR(rMax, 0)} to ${swR(rsi, 0)} inside an uptrend`, `Bounced off the 20/50-day zone on ${swR(volX, 1)}× volume`]; }
    else if (!(rMax >= 58)) return no('No setup: no recent strength to pull back from and no breakout');
    else if (!nearSupport) return no('No setup: not at the 20/50-day support zone');
    else if (!(rsi >= 35 && rsi <= 55)) return no(`No setup: RSI ${swR(rsi, 0)} is outside the 35–55 pullback zone`);
    else if (!turning) return no('No setup: still falling, no bounce yet');
    else return no(`No setup: volume only ${swR(volX, 1)}× normal on the bounce (needs 1.0×)`);
  }
  // Risk: stop under the last 3 lows, never further than 3 ATR; target 2R; pullbacks also need room below the recent high
  const stop = cfg.stopAtr ? c - cfg.stopAtr * atr : Math.min(X.l[i], X.l[i - 1], X.l[i - 2]) - 0.25 * atr, risk = c - stop;
  if (!(risk > 0)) return no('Stop is not below the price');
  if (risk > SW.maxRiskAtr * atr) return no(`Stop too far away (${swR(risk / atr, 1)} ATR): risk not worth taking`);
  const target = c + SW.rr * risk;
  if (setup === 'Pullback bounce' && !cfg.stopAtr) { let top = -Infinity; for (let j = i - 20; j <= i; j++) top = Math.max(top, X.h[j]); if (top < c + 1.5 * risk) return no('No room to run: recent high is too close to the entry'); }
  // quality of the setup, 0-100, only used to rank the ones that already passed every gate
  const score = Math.round(Math.min(100, 50 + Math.min(25, (volX - 1) * 20) + (setup === 'Breakout' ? 5 : 10) + Math.min(10, (s20 / s50 - 1) * 200)));
  return { entry: true, setup, trigger: c, ceiling: c + 0.5 * atr, stop, target, risk, riskPct: risk / c, rr: SW.rr, atr, rsi, volX, avgVol: avgV, holdDays: SW.holdDays, score, why, bar: i, t: X.t[i] };
}


// ── Published strategies (rules as printed; each tested on its own, never mixed or tuned) ──
// connors   : Connors & Alvarez, "Short Term Trading Strategies That Work" (2008): close above the 200-day, RSI(2) below 10.
// ibs       : Internal Bar Strength mean reversion: close in the bottom 20% of the day's range, inside a 200-day uptrend.
// grail     : Raschke "Holy Grail" trend pullback: ADX(14) above 30 with +DI over -DI, a pullback bar that touched the 20-day EMA, then a close above that bar's high.
// minervini : Minervini Trend Template (50>150>200-day, 200-day rising, within 25% of the 52-week high, 30%+ above the low) plus a 20-day breakout on 1.5x volume.
// Exits: 'natural' = the book's own exit (mean reversion: first close above the 5-day average; trend: close below the 10-day average) with a 7% disaster stop and the 10-day limit;
//        'target5' = take profit at +5%, stop at -4%, 10-day limit.
function swRsiN(c, n) {
  const out = new Array(c.length).fill(null); if (c.length <= n) return out;
  let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + (d > 0 ? d : 0)) / n; l = (l * (n - 1) + (d < 0 ? -d : 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  return out;
}
function swEma(c, n) { const out = new Array(c.length).fill(null); if (c.length < n) return out; let e = 0; for (let i = 0; i < n; i++) e += c[i]; e /= n; out[n - 1] = e; const k = 2 / (n + 1); for (let i = n; i < c.length; i++) { e = c[i] * k + e * (1 - k); out[i] = e; } return out; }
function swAdx(h, l, c, n) {
  n = n || 14; const N = c.length, adx = new Array(N).fill(null), pdi = new Array(N).fill(null), mdi = new Array(N).fill(null); if (N < 2 * n + 1) return { adx, pdi, mdi };
  let tr = 0, pd = 0, md = 0; for (let i = 1; i <= n; i++) { const up = h[i] - h[i - 1], dn = l[i - 1] - l[i]; tr += Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); pd += up > dn && up > 0 ? up : 0; md += dn > up && dn > 0 ? dn : 0; }
  const dx = []; let ax = null;
  for (let i = n; i < N; i++) {
    if (i > n) { const up = h[i] - h[i - 1], dn = l[i - 1] - l[i], t = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); tr = tr - tr / n + t; pd = pd - pd / n + (up > dn && up > 0 ? up : 0); md = md - md / n + (dn > up && dn > 0 ? dn : 0); }
    const p = 100 * pd / tr, m = 100 * md / tr; pdi[i] = p; mdi[i] = m; const d = p + m === 0 ? 0 : 100 * Math.abs(p - m) / (p + m); dx.push(d);
    if (dx.length === n) { ax = dx.reduce((a, b) => a + b, 0) / n; adx[i] = ax; } else if (dx.length > n) { ax = (ax * (n - 1) + d) / n; adx[i] = ax; }
  }
  return { adx, pdi, mdi };
}
const SW_STRATS = ['connors', 'ibs', 'grail', 'minervini'];
const SW_EXITS = { natural: { disaster: 0.07 }, target5: { targetPct: 0.05, stopPct: 0.04 },
  // longer holds (NOT swing trades): the template's source found the edge only with slow exits, so these are tested separately
  hold50: { disaster: 0.15, sma: 50, maxHold: 120 }, hold200: { disaster: 0.25, sma: 200, maxHold: 250 } };
function swPrepStrat(X) { if (!X.rsi2) { X.rsi2 = swRsiN(X.c, 2); X.ema20 = swEma(X.c, 20); X.dm = swAdx(X.h, X.l, X.c, 14); } return X; }
function swStratSignal(X, i, name, exitMode) {
  const no = (...reasons) => ({ entry: false, reasons }); swPrepStrat(X);
  if (i < 251) return no(`Only ${i + 1} daily bars (need 252): data unverified`);
  const c = X.c[i], atr = X.atr[i]; if (atr === null) return no('Indicators unavailable: data unverified');
  let vs = 0; for (let j = i - 20; j < i; j++) { if (X.v[j] === null || X.v[j] === undefined) return no('No volume data: cannot verify entry volume'); vs += X.v[j]; }
  const avgV = vs / 20, v = X.v[i]; if (v === null || v === undefined) return no('No volume data today: cannot verify entry volume');
  if (avgV * c < SW.minTurnover) return no('Too thinly traded (average daily turnover under 1 million)');
  if (atr / c < SW.atrMin) return no('Too quiet: moves too small to pay for costs'); if (atr / c > 0.08) return no('Too volatile: daily range over 8% of price');
  const s5 = swSma(X.c, 5, i + 1), s10 = swSma(X.c, 10, i + 1), s50 = swSma(X.c, 50, i + 1), s150 = swSma(X.c, 150, i + 1), s200 = swSma(X.c, 200, i + 1), s200b = swSma(X.c, 200, i - 20);
  let why = [], trend = false;
  if (name === 'connors') { if (!(c > s200)) return no('Below the 200-day average'); const r2 = X.rsi2[i]; if (!(r2 < 10)) return no(`RSI(2) is ${swR(r2, 0)}: not below 10`); why = [`Above the 200-day, RSI(2) ${swR(r2, 1)} (below 10)`]; }
  else if (name === 'ibs') { if (!(c > s200)) return no('Below the 200-day average'); const rg = X.h[i] - X.l[i]; if (!(rg > 0)) return no('No range today'); const ibs = (c - X.l[i]) / rg; if (!(ibs < 0.2)) return no(`Closed ${swR(ibs * 100, 0)}% up its range: not in the bottom 20%`); why = [`Closed in the bottom ${swR(ibs * 100, 0)}% of the day's range, inside a 200-day uptrend`]; }
  else if (name === 'grail') { trend = true; const d = X.dm, p = i - 1; if (d.adx[i] === null) return no('ADX unavailable'); if (!(d.adx[i] > 30 && d.pdi[i] > d.mdi[i])) return no(`No strong uptrend (ADX ${swR(d.adx[i], 0)}, needs 30+ with +DI over -DI)`); if (!(X.l[p] <= X.ema20[p])) return no('Yesterday did not pull back to the 20-day EMA'); if (!(c > X.h[p] && c > X.ema20[i])) return no('No turn yet: price has not closed above the pullback bar high'); why = [`ADX ${swR(d.adx[i], 0)}, pulled back to the 20-day EMA and turned up`]; }
  else if (name === 'minervini') {
    trend = true; let hi = -Infinity, lo = Infinity; for (let j = i - 251; j <= i; j++) { hi = Math.max(hi, X.h[j]); lo = Math.min(lo, X.l[j]); }
    if (!(c > s50 && s50 > s150 && s150 > s200 && s200 > s200b)) return no('Fails the trend template (needs price > 50 > 150 > 200-day, 200-day rising)');
    if (!(c >= 0.75 * hi && c >= 1.3 * lo)) return no('Not within 25% of the 52-week high and 30%+ above the low');
    let hi20 = -Infinity; for (let j = i - 20; j < i; j++) hi20 = Math.max(hi20, X.h[j]); const volX = v / avgV;
    if (!(c > hi20 && volX >= 1.5)) return no('No breakout: needs a close above the 20-day high on 1.5x volume'); why = [`Trend template passed, broke the 20-day high on ${swR(volX, 1)}x volume`];
  } else return no('Unknown strategy');
  const ex = SW_EXITS[exitMode] || SW_EXITS.natural, stopPct = ex.stopPct || ex.disaster;
  const stop = c * (1 - stopPct), target = ex.targetPct ? c * (1 + ex.targetPct) : null;
  return { entry: true, setup: name, strat: name, exitMode, trigger: c, ceiling: c + atr, stop, target, risk: c - stop, riskPct: stopPct, rr: target ? ex.targetPct / stopPct : null, atr, holdDays: SW.holdDays,
    stopPct, targetPct: ex.targetPct || null, exitSma: ex.targetPct ? null : (ex.sma ? { n: ex.sma, below: true } : (trend ? { n: 10, below: true } : { n: 5, below: false })), maxHold: ex.maxHold || null, score: 50, why, bar: i, t: X.t[i], volX: v / avgV };
}

// Walk one trade forward from the NEXT bar's open. Stop first if both are touched in one bar (the cautious assumption).
function swSimulate(X, sig, cost) {
  const j0 = sig.bar + 1; if (j0 >= X.c.length) return null;
  const open = X.o[j0]; if (open > sig.ceiling || open <= sig.stop) return { skipped: true };
  const entry = open; let exit = null, why = 'time', xb = null;
  const H = sig.maxHold || SW.holdDays, stopP = sig.stopPct ? entry * (1 - sig.stopPct) : sig.stop, stopD = entry - stopP;
  const tgt = sig.targetPct ? entry * (1 + sig.targetPct) : (sig.strat && !sig.rr ? null : entry + SW.rr * stopD);
  for (let j = j0; j < Math.min(X.c.length, j0 + H); j++) {
    if (X.l[j] <= stopP) { exit = X.o[j] < stopP ? X.o[j] : stopP; why = 'stop'; xb = j; break; }
    if (tgt !== null && X.h[j] >= tgt) { exit = tgt; why = 'target'; xb = j; break; }
    if (sig.exitSma) { const m = swSma(X.c, sig.exitSma.n, j + 1); if (m !== null && (sig.exitSma.below ? X.c[j] < m : X.c[j] > m)) { exit = X.c[j]; why = 'signal'; xb = j; break; } }
  }
  if (exit === null) { const jl = Math.min(X.c.length, j0 + H) - 1; if (jl - j0 + 1 < H) return null; exit = X.c[jl]; xb = jl; }   // trade still open at the end of the data: not counted
  const ret = exit / entry - 1 - (cost === undefined ? SW.cost : cost);
  return { entry, exit, ret, r: ret / (stopD / entry), why, bar: j0, exitBar: xb, t: X.t[j0] };
}

// Back-test one stock: after a trade closes the next signal is taken from the bar after the exit (no overlapping trades)
function swBacktestOne(candles, cost, cfg) {
  const X = swPrep(candles), trades = []; let i = SW.minBars - 1;
  while (i < X.c.length - 1) {
    const s = cfg && cfg.strat ? swStratSignal(X, i, cfg.strat, cfg.exit) : swingSignal(X, i, cfg); if (!s.entry) { i++; continue; }
    const tr = swSimulate(X, s, cost); if (!tr) break; if (tr.skipped) { i++; continue; }
    trades.push(Object.assign({ setup: s.setup }, tr)); i = tr.exitBar;
  }
  return trades;
}

function swStats(trades) {
  const n = trades.length; if (!n) return { trades: 0 };
  const wins = trades.filter(t => t.ret > 0), loss = trades.filter(t => t.ret <= 0), gw = wins.reduce((a, t) => a + t.ret, 0), gl = -loss.reduce((a, t) => a + t.ret, 0);
  let eq = 1, pk = 1, dd = 0; trades.slice().sort((a, b) => a.t - b.t).forEach(t => { eq *= 1 + Math.max(-0.5, t.ret) * 0.1; pk = Math.max(pk, eq); dd = Math.max(dd, 1 - eq / pk); });   // 10% of the account per trade
  return { trades: n, winRate: swR(wins.length / n * 100, 1), expectancy: swR(trades.reduce((a, t) => a + t.ret, 0) / n * 100, 3), avgWin: swR(wins.length ? gw / wins.length * 100 : 0, 2), avgLoss: swR(loss.length ? -gl / loss.length * 100 : 0, 2),
    profitFactor: gl > 0 ? swR(gw / gl, 2) : null, avgR: swR(trades.reduce((a, t) => a + t.r, 0) / n, 3), maxDrawdown10pct: swR(dd * 100, 1) };
}
// Does a back-test report clear the gate the tab needs before it will show entries?
function swValidated(rep) {
  if (!rep || !rep.out_of_sample || !rep.all) return { ok: false, why: 'No back-test has been run yet, so no entries are shown.' };
  const a = rep.all, o = rep.out_of_sample, b = rep.baseline || {};
  if (!(a.trades >= SW.gate.trades)) return { ok: false, why: `Back-test has only ${a.trades || 0} trades (need ${SW.gate.trades}).` };
  if (!(o.trades >= 40)) return { ok: false, why: `Out-of-sample part has only ${o.trades || 0} trades (need 40).` };
  if (!(o.expectancy > SW.gate.oosExpectancy)) return { ok: false, why: `Out-of-sample expectancy is ${o.expectancy}% per trade after costs: not positive, so no entries are shown.` };
  if (!(a.profitFactor !== null && a.profitFactor >= SW.gate.pf)) return { ok: false, why: `Profit factor ${a.profitFactor} is below ${SW.gate.pf}: not enough edge, so no entries are shown.` };
  if (b.expectancy !== undefined && !(o.expectancy > b.expectancy)) return { ok: false, why: `Out-of-sample expectancy (${o.expectancy}%) does not beat a random 10-day entry (${b.expectancy}%): no edge, so no entries are shown.` };
  return { ok: true, why: '' };
}

// ── The card ──────────────────────────────────────────────────
const _sw = { rows: [], report: null, amount: '', busy: false, at: null, skipped: [] };

async function swFetchCandles(symbol) {
  const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol, range: '1y' }) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  if (!Array.isArray(d.candles) || !d.candles.length) throw new Error('no volume candles from this data route');
  return d;
}
// Universe = stocks that are not inside a pie, with a quality pass. ETFs, crypto and commodities are left out.
async function swUniverse() {
  const out = new Map(), skipped = [];
  const vb = await api('value_buy_scores', '?select=ticker,display,pie,score,verdict,currency_symbol').catch(() => []);
  (vb || []).forEach(v => { const pie = String(v.pie || '').trim().toLowerCase(); if (['', 'individual', 'untagged', 'solo'].includes(pie)) { const q = swNum(v.score); if (q !== null && q >= SW.qualityMin) out.set(v.ticker, { symbol: v.ticker, name: v.display || v.ticker, cur: v.currency_symbol || '', quality: q, src: 'your holding' }); else skipped.push(`${v.display || v.ticker}: quality ${q === null ? 'unverified' : q + '/100'} (needs ${SW.qualityMin}+)`); } });
  const [wl, an] = await Promise.all([api('watchlist', '?select=*').catch(() => []), api('watchlist_analysis', '?select=*').catch(() => [])]);
  const A = Object.fromEntries((an || []).map(a => [a.ticker, a]));
  (wl || []).forEach(w => {
    const cat = String(w.category || 'stock').toLowerCase(); if (cat !== 'stock' || out.has(w.ticker)) return;
    const a = A[w.ticker] || {}, q = a.quality || {};
    if (q.label === 'Good') out.set(w.ticker, { symbol: w.ticker, name: a.name || w.name || w.ticker, cur: a.ccy || '', quality: swNum(q.score), src: 'watchlist' });
    else skipped.push(`${w.ticker}: quality ${q.label || 'unverified'} (needs Good)`);
  });
  return { list: [...out.values()], skipped };
}
function swPrice(v, cur) { return (cur || '') + Number(v).toFixed(2); }
function swGbp(n) { n = Number(n) || 0; return '£' + (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2)); }

async function loadSwing() {
  const el = document.getElementById('swing-content'); if (!el) return;
  if (typeof IS_GUEST !== 'undefined' && IS_GUEST) { el.innerHTML = '<div class="loading">Sign in to use the Swing tab.</div>'; return; }
  _sw.report = null;   // the back-test file lives in docs/data/: one level up from the generated pages, same level on the legacy page
  for (const base of ['data/', '../data/']) { try { const r = await fetch(base + 'swing_backtest.json?_=' + Math.floor(Date.now() / 3600000)); if (r.ok) { const j = await r.json(); if (j && j.all) { _sw.report = j; break; } } } catch (e) {} }
  renderSwing();
  swScan(false);
}
async function swScan(fresh) {
  if (_sw.busy) return; _sw.busy = true; renderSwing();
  try {
    const u = await swUniverse(); _sw.skipped = u.skipped; const rows = [];
    for (const s of u.list) {
      try {
        const d = await swFetchCandles(s.symbol), X = swPrep(d.candles);
        // drop today's unfinished bar for the signal; its price is the live check
        const meta = d.meta || {}, now = Date.now() / 1000, sess = meta.session; let last = X.c.length - 1;
        const open = sess && now >= sess.start && now <= sess.end; const Y = open ? swCols(d.candles.slice(0, -1)) : null;
        let XX = X; if (open && Y && Y.c.length >= SW.minBars) { Y.rsi = swRsiSeries(Y.c); Y.atr = swAtrSeries(Y.h, Y.l, Y.c); XX = Y; last = Y.c.length - 1; }
        const sig = swingSignal(XX, last), live = swNum(meta.price);
        if (sig.entry && live !== null) { if (live > sig.ceiling) { sig.entry = false; sig.reasons = [`Price has already run to ${swPrice(live, s.cur)}, above the entry ceiling ${swPrice(sig.ceiling, s.cur)}: missed`]; } else if (live <= sig.stop) { sig.entry = false; sig.reasons = ['Price is already through the stop']; } }
        rows.push(Object.assign({}, s, { sig, live, ccyOk: true }));
      } catch (e) { rows.push(Object.assign({}, s, { sig: { entry: false, reasons: ['Data unverified: ' + (e.message || 'no data')] }, live: null })); }
    }
    _sw.rows = rows; _sw.at = Date.now();
  } catch (e) { _sw.rows = []; _sw.err = e.message || String(e); }
  _sw.busy = false; renderSwing();
}
function swAmountChanged() { const i = document.getElementById('sw-amount'); _sw.amount = i ? i.value : ''; renderSwing(true); }

function renderSwing(keepFocus) {
  const el = document.getElementById('swing-content'); if (!el) return;
  const val = swValidated(_sw.report), amt = swNum(_sw.amount), rep = _sw.report;
  const entries = _sw.rows.filter(r => r.sig.entry).sort((a, b) => b.sig.score - a.sig.score), none = _sw.rows.filter(r => !r.sig.entry);
  const pill = (t, c) => `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:${c}22;color:${c};white-space:nowrap">${t}</span>`;
  const statBox = (t, s) => s && s.trades ? `<div class="stat-card"><div class="label">${t}</div><div class="value">${s.trades} trades</div><div class="sub">win ${s.winRate}% · avg ${s.expectancy >= 0 ? '+' : ''}${s.expectancy}% · PF ${s.profitFactor === null ? '—' : s.profitFactor}</div></div>` : '';
  const valHtml = `<div class="card" id="sw-validation"><h3>🧪 Validation: has this strategy been tested?</h3>
      ${rep ? `<div class="stats-strip" style="margin-bottom:8px">${statBox('All', rep.all)}${statBox('Out-of-sample', rep.out_of_sample)}${statBox('Random 10-day entry', rep.baseline && rep.baseline.trades ? rep.baseline : null)}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5">Back-tested ${swEsc(String(rep.generated || '').slice(0, 10))} on ${swEsc(rep.symbols)} liquid stocks, ${swEsc(rep.years)} years of daily data, ${swR((rep.cost || SW.cost) * 100, 2)}% round-trip cost per trade, next-day open entries, stop checked before target. Out-of-sample is the most recent 40% of dates, which the rules were never tuned on. ${swEsc(rep.caveat || '')}</div>`
        : '<div style="font-size:12px;color:var(--muted)">No back-test result found yet.</div>'}
      <div style="margin-top:8px;padding:8px 10px;border-radius:8px;border-left:3px solid ${val.ok ? '#22c55e' : '#f59e0b'};background:${val.ok ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.1)'};font-size:12px">${val.ok ? '✅ Cleared the gate: positive out-of-sample result after costs, profit factor ≥ ' + SW.gate.pf + ', and better than a random entry. Past results do not guarantee future ones.' : '⛔ ' + swEsc(val.why)}</div></div>`;
  let body;
  if (!val.ok) body = '<div style="padding:12px;font-size:13px">No entries are shown until the strategy passes its back-test.</div>';
  else if (_sw.busy && !_sw.rows.length) body = '<div class="loading busy">Reading live prices and volume…</div>';
  else if (_sw.err) body = `<div style="color:var(--red);font-size:12px">${swEsc(_sw.err)}</div>`;
  else if (!entries.length) body = `<div style="padding:12px;border-radius:9px;border:1px solid var(--border)"><div style="font-weight:800;font-size:14px">⚪ No entry today</div><div style="font-size:12px;color:var(--muted);margin-top:4px">${_sw.rows.length} stock${_sw.rows.length === 1 ? '' : 's'} checked, none has a valid entry right now. Doing nothing is a valid answer.</div></div>`;
  else body = entries.map(r => { const s = r.sig, sh = amt ? amt / s.trigger : null;
    return `<div class="card" style="border-color:#22c55e66;margin-bottom:10px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="flex:1 1 140px;min-width:0;word-break:break-word">${swEsc(r.name)}</b>${pill('ENTRY · ' + swEsc(s.setup), '#22c55e')}${pill('score ' + s.score, '#60a5fa')}</div>
      <div class="stats-strip" style="margin:8px 0"><div class="stat-card"><div class="label">Buy near</div><div class="value">${swPrice(s.trigger, r.cur)}</div><div class="sub">not above ${swPrice(s.ceiling, r.cur)}</div></div>
        <div class="stat-card"><div class="label">Stop</div><div class="value red">${swPrice(s.stop, r.cur)}</div><div class="sub">−${swR(s.riskPct * 100, 1)}%</div></div>
        <div class="stat-card"><div class="label">Target</div><div class="value green">${swPrice(s.target, r.cur)}</div><div class="sub">+${swR(s.riskPct * s.rr * 100, 1)}% (${s.rr}R)</div></div></div>
      <div style="font-size:11px;color:var(--muted);line-height:1.5">${s.why.map(swEsc).join(' · ')} · quality ${r.quality === null ? '—' : swR(r.quality, 0)}/100 (${swEsc(r.src)}) · live ${r.live === null ? '—' : swPrice(r.live, r.cur)}<br>Sell at the stop or target, or at the close on day ${s.holdDays}, whichever comes first.${sh ? `<br><b>With ${swGbp(amt)}:</b> about ${swR(sh, 2)} shares, risking about ${swGbp(amt * s.riskPct)} to the stop.` : ''}</div></div>`; }).join('');
  el.innerHTML = `
    <div class="card" id="swing-card"><h3>⚡ Swing trades (1–10 days)</h3>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Stocks outside your pies that pass the quality bar and have a valid entry today. No entry means no recommendation. Screening aid, not advice.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input id="sw-amount" type="number" inputmode="decimal" min="1" step="1" placeholder="Amount in £ per trade, e.g. 200" value="${swEsc(_sw.amount)}" oninput="swAmountChanged()" style="flex:1 1 160px;min-width:0;min-height:44px;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:16px">
        <button type="button" onclick="swScan(true)" style="min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">${_sw.busy ? 'Scanning…' : '↻ Scan now'}</button></div>
      <div id="sw-results" aria-live="polite">${body}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px">${_sw.at ? 'Scanned ' + new Date(_sw.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' from live Yahoo daily data.' : ''} Earnings dates are not checked: avoid holding through results.</div></div>
    ${val.ok && none.length ? `<div class="card"><h3>Checked, no entry (${none.length})</h3>${none.map(r => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><b>${swEsc(r.name)}</b> <span style="color:var(--muted)">${swEsc(r.sig.reasons[0])}</span></div>`).join('')}</div>` : ''}
    ${val.ok && _sw.skipped.length ? `<div class="card"><h3>Not checked: below the quality bar (${_sw.skipped.length})</h3><div style="font-size:11px;color:var(--muted);line-height:1.6">${_sw.skipped.map(swEsc).join('<br>')}</div></div>` : ''}
    ${valHtml}
    <div class="card"><h3>📖 The rules</h3><div style="font-size:11px;color:var(--muted);line-height:1.7">
      <b>Universe:</b> stocks not inside a pie (untagged holdings and watchlist stocks). Quality first: Entry Analysis ${SW.qualityMin}+ or a watchlist “Good” quality label.<br>
      <b>Every one of these must be true:</b> price above a rising 50-day average · RSI 70 or lower · not stretched far above the 20-day average · average daily turnover over 1m · daily range 1–6% of price · volume data present.<br>
      <b>Then one setup:</b> <i>Pullback bounce</i>: RSI fell from 58+ to 35–55, price at the 20/50-day zone, a green day back up on at least normal volume, room to run. <i>Breakout</i>: close above the 20-day high on 1.5× volume, not already stretched.<br>
      <b>Risk:</b> stop under the last 3 lows (never more than 3 ATR away) · target 2× the risk · exit at the close of day 10 if neither is hit · skip if price has run more than half an ATR past the signal.<br>
      <b>Not covered:</b> earnings dates, news, and the quality screen in the back-test (no history for it). The back-test universe is today’s liquid stocks, so survivorship bias flatters it somewhat.</div></div>`;
  if (keepFocus) { const i = document.getElementById('sw-amount'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (e) {} } }
}

if (typeof module !== 'undefined') module.exports = { swR, SW_STRATS, SW_EXITS, swStratSignal, swRsiN, swEma, swAdx, SW, swingSignal, swSimulate, swBacktestOne, swStats, swValidated, swPrep, swRsiSeries, swAtrSeries, swSma, swCols };
