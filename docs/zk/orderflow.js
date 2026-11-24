// ORDER-FLOW ESTIMATE from daily candles (epic: order flow). Same algorithm as services/orderflow.py (shared golden vectors: tests/data/orderflow_golden.json).
//
// IMPORTANT, and the UI says so: this is an ESTIMATE inferred from each candle's volume and where it closed inside its range. Yahoo's free data has no
// order book, no tape and no buy/sell split, so real order flow ("buy orders of 20k lots") cannot be measured here. What can be seen is the footprint a big
// buyer or seller leaves: volume far above normal, a wide candle, a close near the high (or low) and a price move the same way. Threshold is RELATIVE
// (x times that stock's own 20-day average volume), never a fixed lot count: 20k shares is nothing for NVIDIA and a lot for a small stock.
// Real block-trade / Level 2 data needs a licensed feed (tracked next to the market-data licensing issues).
//
// It can only ever make a buy more careful or add a supporting reason; it never creates a buy on its own (it is not back-tested).
(function (root) {
  'use strict';
  const LOOKBACK = 20, RECENT = 5, EVENT_RVOL = 2.5, CLOSE_LOC = 0.5, PRESSURE = 0.15, MIN_BARS = LOOKBACK + 1;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const rnd = (x, d) => { const f = Math.pow(10, d); return Math.round(x * f) / f; };
  const fmtShares = x => (x >= 1e6 ? rnd(x / 1e6, 1) + 'M' : x >= 1e3 ? Math.round(x / 1e3) + 'k' : String(Math.round(x)));
  const fmtDate = d => { if (!d) return 'that day'; const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = String(d).slice(0, 10).split('-'); return p.length === 3 ? `${+p[2]} ${M[+p[1] - 1]}` : String(d); };
  const NOTE = {
    unverified: 'Order flow cannot be estimated: not enough reliable volume history.',
    neutral: 'No unusual large-order footprint in the last 5 sessions (estimated from candles).',
    buyers: 'Buying pressure over the last 20 days (estimated): closes sit in the upper part of the daily range on volume.',
    sellers: 'Selling pressure over the last 20 days (estimated): closes sit in the lower part of the daily range on volume.',
  };
  const SCORE = { accumulation_new: 1, accumulation_old: 0.9, buyers: 0.7, neutral: 0.5, sellers: 0.3, distribution_old: 0.2, distribution_new: 0.1 };

  // c/h/l/v: daily arrays, oldest first. dates: optional 'YYYY-MM-DD' per bar. partial: the last bar is today's unfinished session (dropped).
  function estimate(h, l, c, v, dates, partial) {
    const out = { state: 'unverified', score: null, rvol: null, pressure: null, date: null, age: null, extra_shares: null, estimated: true, note: NOTE.unverified };
    if (!h || !l || !c || !v) return out;
    let n = Math.min(h.length, l.length, c.length, v.length); if (partial) n -= 1;
    if (n < MIN_BARS + 1) return out;
    const num = a => a.slice(0, n).map(x => (x === null || x === undefined || x === '' ? NaN : Number(x)));   // a missing bar is NaN (Number(null) would be 0)
    const H = num(h), L = num(l), C = num(c), V = num(v);
    const first = n - (LOOKBACK + RECENT);
    for (let i = Math.max(first, 0); i < n; i++) if (![H[i], L[i], C[i], V[i]].every(Number.isFinite) || V[i] < 0 || C[i] <= 0) return out;
    let have = 0; for (let i = n - LOOKBACK - 1; i < n; i++) if (V[i] > 0) have++;
    if (have < LOOKBACK) return out;
    const clv = i => { const r = H[i] - L[i]; return r > 0 ? ((C[i] - L[i]) - (H[i] - C[i])) / r : 0; };
    let ev = null;
    for (let i = n - RECENT; i < n; i++) {
      const av = mean(V.slice(i - LOOKBACK, i)), ar = mean(H.slice(i - LOOKBACK, i).map((x, k) => x - L[i - LOOKBACK + k]));
      if (!(av > 0) || !(ar > 0)) continue;
      const rvol = V[i] / av, rng = H[i] - L[i], loc = clv(i), chg = C[i] / C[i - 1] - 1;
      if (rvol >= EVENT_RVOL && rng >= ar && ((loc >= CLOSE_LOC && chg > 0) || (loc <= -CLOSE_LOC && chg < 0))) ev = { i, dir: loc > 0 ? 1 : -1, rvol, extra: V[i] - av };
    }
    let sv = 0, svc = 0; for (let i = n - LOOKBACK; i < n; i++) { sv += V[i]; svc += V[i] * clv(i); }
    const pressure = sv > 0 ? svc / sv : 0, lastAvg = mean(V.slice(n - 1 - LOOKBACK, n - 1)), lastR = lastAvg > 0 ? V[n - 1] / lastAvg : null;
    out.pressure = rnd(pressure, 2); out.rvol = lastR === null ? null : rnd(lastR, 2);
    if (ev) {
      const age = n - 1 - ev.i, d = dates ? dates[ev.i] : null, extra = fmtShares(ev.extra);
      out.state = ev.dir > 0 ? 'accumulation' : 'distribution'; out.age = age; out.date = d ? String(d).slice(0, 10) : null; out.rvol = rnd(ev.rvol, 2); out.extra_shares = Math.round(ev.extra);
      out.score = SCORE[out.state + (age <= 1 ? '_new' : '_old')];
      out.note = ev.dir > 0
        ? `Large-buyer footprint (estimated): volume ${rnd(ev.rvol, 1)}× normal on ${fmtDate(d)} (about ${extra} more shares than usual), price up and closing near the day's high. Inferred from the candle, not from actual orders.`
        : `Large-seller footprint (estimated): volume ${rnd(ev.rvol, 1)}× normal on ${fmtDate(d)} (about ${extra} more shares than usual), price down and closing near the day's low. Inferred from the candle, not from actual orders.`;
    } else if (pressure >= PRESSURE) { out.state = 'buyers'; out.score = SCORE.buyers; out.note = NOTE.buyers; }
    else if (pressure <= -PRESSURE) { out.state = 'sellers'; out.score = SCORE.sellers; out.note = NOTE.sellers; }
    else { out.state = 'neutral'; out.score = SCORE.neutral; out.note = NOTE.neutral; }
    return out;
  }
  root.ZKOrderflow = { estimate, LOOKBACK, RECENT, EVENT_RVOL };
  if (typeof module !== 'undefined') module.exports = root.ZKOrderflow;
})(typeof window !== 'undefined' ? window : globalThis);
