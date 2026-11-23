// Port of services/value_buy_service.py: entry zones, this-week buy target and 0-100 scorecard per holding.
(function (root) {
  'use strict';
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d);
  const pyFloat = x => Number.isInteger(x) ? x.toFixed(1) : String(x);
  const truthy = v => v !== null && v !== undefined && v !== 0 && v !== '' && !Number.isNaN(v);
  const or = (v, d) => truthy(v) ? v : d;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  function calcRsi(closes, period = 14) {
    if (closes.length < period + 1) return null;
    const deltas = closes.slice(1).map((c, i) => c - closes[i]), gains = deltas.map(d => d > 0 ? d : 0.0), losses = deltas.map(d => d < 0 ? -d : 0.0);
    let ag = mean(gains.slice(0, period)), al = mean(losses.slice(0, period));
    for (let i = period; i < deltas.length; i++) { ag = (ag * (period - 1) + gains[i]) / period; al = (al * (period - 1) + losses[i]) / period; }
    if (al === 0) return 100.0;
    return rnd(100 - 100 / (1 + ag / al), 1);
  }
  // h: { c, h, l } 1y daily adjusted; info: relay /yahoo-info result
  function yahooData(h, info, yahoo) {
    if (!h || h.c.length < 20) return null;
    const c = h.c, n = c.length; info = info || {};
    const returns = c.slice(1).map((x, i) => (x - c[i]) / c[i]), mu = mean(returns), vol = Math.sqrt(mean(returns.map(r => (r - mu) * (r - mu))));
    const v = h.v || [], volRatio = v.length >= 20 && mean(v.slice(-20, -5)) > 0 ? rnd(mean(v.slice(-5)) / mean(v.slice(-20, -5)), 2) : null;     // 5-day vs prior 15-day average volume (same as holding decisions)
    return { vol_ratio: volRatio, mom_4w: n >= 20 ? rnd((c[n - 1] / c[n - 20] - 1) * 100, 1) : null, mom_1w: n >= 5 ? rnd((c[n - 1] / c[n - 5] - 1) * 100, 1) : null,
      current: rnd(c[n - 1], 4), week_high: rnd(Math.max(...h.h.slice(-5)), 4), week_low: rnd(Math.min(...h.l.slice(-5)), 4), high_52w: rnd(Math.max(...h.h), 4), low_52w: rnd(Math.min(...h.l), 4),
      ma20: n >= 20 ? rnd(mean(c.slice(-20)), 4) : null, ma50: n >= 50 ? rnd(mean(c.slice(-50)), 4) : null, rsi: calcRsi(c), vol_annual_pct: rnd(vol * Math.sqrt(252) * 100, 1),
      pe_ratio: info.trailingPE === undefined ? null : info.trailingPE, forward_pe: info.forwardPE === undefined ? null : info.forwardPE, target_mean: info.targetMeanPrice === undefined ? null : info.targetMeanPrice,
      recommendation: (info.recommendationKey || 'none').toLowerCase(), analyst_count: info.numberOfAnalystOpinions || 0, market_cap: info.marketCap === undefined ? null : info.marketCap,
      sector: info.sector === undefined || info.sector === null ? '' : info.sector, short_name: info.shortName || info.longName || yahoo };
  }
  function entryZones(current, low, high, avgCost, sym) {
    let spread = high - low; if (spread <= 0) spread = current * 0.3;
    const z2 = rnd(low + spread * 0.20, 2), z3 = rnd(low + spread * 0.40, 2), z4 = rnd(low + spread * 0.60, 2), z5 = rnd(low + spread * 0.80, 2), F = pyFloat;
    const rating = (lb, hb) => {
      const mid = hb ? (lb + hb) / 2 : lb * 1.1;
      if (truthy(avgCost) && avgCost > 0) return mid < avgCost * 0.95 ? 'high' : mid < avgCost * 1.05 ? 'medium' : 'low';
      const pir = spread > 0 ? (mid - low) / spread : 0.5; return pir < 0.3 ? 'high' : pir < 0.6 ? 'medium' : 'low';
    };
    return [{ label: `Below ${sym}${F(z2)}`, low: null, high: z2, rating: 'high', note: 'Deep value — strong accumulate' },
      { label: `${sym}${F(z2)} – ${sym}${F(z3)}`, low: z2, high: z3, rating: rating(z2, z3), note: 'Good entry zone' },
      { label: `${sym}${F(z3)} – ${sym}${F(z4)}`, low: z3, high: z4, rating: rating(z3, z4), note: 'Fair value' },
      { label: `${sym}${F(z4)} – ${sym}${F(z5)}`, low: z4, high: z5, rating: rating(z4, z5), note: 'Above fair value — wait for dip' },
      { label: `Above ${sym}${F(z5)}`, low: z5, high: null, rating: 'low', note: 'Near 52w high — avoid / trim' }];
  }
  function thisWeekTarget(current, ma20, ma50, rsi, avgCost) {
    let action = 'HOLD', target = current; const why = [], F = pyFloat;
    if (rsi !== null && rsi !== undefined) {
      if (rsi < 35) { action = 'BUY NOW'; why.push(`RSI ${F(rsi)} — oversold, momentum reversal likely`); target = current; }
      else if (rsi < 50) { action = 'ACCUMULATE'; why.push(`RSI ${F(rsi)} — weakening momentum, good gradual entry`); target = rnd(Math.min(current, or(ma20, current)) * 0.99, 2); }
      else if (rsi < 65) { action = 'WAIT FOR DIP'; why.push(`RSI ${F(rsi)} — neutral, target a small pullback`); target = rnd(or(ma20, current) * 0.97, 2); }
      else { action = 'HOLD / AVOID'; why.push(`RSI ${F(rsi)} — overbought, high entry risk this week`); target = rnd(or(ma20, current) * 0.93, 2); }
    }
    if (truthy(ma20) && truthy(ma50)) {
      if (current < ma20) { why.push(`Price below MA20 (${F(ma20)}) — support broken, cautious`); if (action === 'ACCUMULATE') target = rnd(current * 0.98, 2); }
      else if (current < ma50) why.push(`Price below MA50 (${F(ma50)}) — potential recovery play`);
      else if (current > ma20 && current > ma50) { why.push('Above both MAs — momentum extended, prefer pullback entry'); if (action !== 'BUY NOW' && action !== 'ACCUMULATE') target = rnd(ma20 * 0.99, 2); }
    }
    if (truthy(avgCost) && avgCost > 0) {
      const diff = rnd((current - avgCost) / avgCost * 100, 1);
      if (diff < -10) { why.push(`Currently ${F(Math.abs(diff))}% below your avg cost — DCA opportunity`); if (action !== 'BUY NOW') action = 'DCA — ADD'; }
      else if (diff < 0) why.push(`Slightly below avg cost (${F(diff)}%) — good add opportunity`);
      else if (diff < 10) why.push(`Near your avg cost (+${F(diff)}%) — neutral position`);
      else why.push(`${F(diff)}% above avg cost — only add on significant pullback`);
    }
    return { action, price: target, rationale: why };
  }
  function scorecard(d, avgCost) {
    const rsi = or(d.rsi, 50), ma20 = or(d.ma20, d.current), ma50 = or(d.ma50, d.current), current = d.current, low = d.low_52w, high = d.high_52w, vol = or(d.vol_annual_pct, 30);
    const rec = d.recommendation === undefined ? 'none' : d.recommendation, ac = d.analyst_count || 0, pe = d.pe_ratio, spread = truthy(high) && truthy(low) ? high - low : current * 0.3;
    let bq = ({ strong_buy: 20, buy: 17, hold: 12, underperform: 7, sell: 3, none: 10 })[rec]; if (bq === undefined) bq = 10;
    if (ac > 20) bq = Math.min(bq + 2, 20); else if (ac === 0) bq = Math.max(bq - 3, 5);
    let fs = 14; if (truthy(pe)) fs = pe < 15 ? 19 : pe < 25 ? 17 : pe < 35 ? 14 : pe < 50 ? 10 : 6; else if (pe === null || pe === undefined) fs = 12;
    let mom = rsi < 30 ? 18 : rsi < 45 ? 16 : rsi < 55 ? 13 : rsi < 65 ? 10 : rsi < 75 ? 7 : 4;
    if (current > ma20 && ma20 > ma50) mom = Math.min(mom + 2, 20); else if (current < ma20 && ma20 < ma50) mom = Math.max(mom - 2, 0);
    const pir = spread > 0 ? (current - low) / spread : 0.5; let val = pir < 0.2 ? 20 : pir < 0.35 ? 17 : pir < 0.55 ? 13 : pir < 0.75 ? 9 : 5;
    if (truthy(avgCost) && avgCost > 0) { const b = (avgCost - current) / avgCost * 100; if (b > 10) val = Math.min(val + 2, 20); else if (b < -15) val = Math.max(val - 2, 0); }
    let risk = vol < 15 ? 18 : vol < 25 ? 16 : vol < 35 ? 13 : vol < 50 ? 9 : vol < 70 ? 6 : 3;
    const down = current > 0 ? (current - low) / current * 100 : 0; if (down > 30) risk = Math.max(risk - 2, 0);
    const total = bq + fs + mom + val + risk;
    const verdict = total >= 82 ? 'Strong Buy' : total >= 68 ? 'Value Buy' : total >= 55 ? 'Accumulate' : total >= 42 ? 'Hold' : total >= 30 ? 'Wait for Dip' : 'Avoid';
    return [total, verdict, [{ category: 'Business quality', score: bq, max: 20 }, { category: 'Financial strength', score: fs, max: 20 }, { category: 'Momentum (RSI/MA)', score: mom, max: 20 }, { category: 'Valuation', score: val, max: 20 }, { category: 'Risk', score: risk, max: 20 }]];
  }
  function warning(d, avgCost) {
    const w = [], rsi = or(d.rsi, 50), vol = d.vol_annual_pct || 0, current = d.current, F = pyFloat;
    if (rsi > 70) w.push(`RSI ${F(rsi)} — overbought. High risk of pullback this week.`);
    if (vol > 50) w.push(`Annual volatility ${F(vol)}% — high risk asset, size position carefully.`);
    if (truthy(avgCost) && current > avgCost * 1.2) w.push(`Current price is ${F(rnd((current / avgCost - 1) * 100, 1))}% above your avg cost — adding here increases your avg significantly.`);
    if (current === d.low_52w || current < d.low_52w * 1.03) w.push('Near 52-week low — potential value but could signal fundamental deterioration. Verify.');
    return w.length ? w.join(' ') : null;
  }

  // inp: { positions:[{ticker,display,pie,exchange,avg_price}], data:{yahooTicker: yahooData|null}, nowIso }
  function compute(inp) {
    const S = root.ZKSymbols, seen = new Map(); for (const p of inp.positions) seen.set(p.ticker, p);
    const rows = [], active = [];
    for (const pos of seen.values()) {
      const pie = (pos.pie || 'Individual').trim(), [yahoo, cur] = S.t212ToYahoo(pos.ticker, pos.exchange === undefined ? '' : pos.exchange); active.push(yahoo);
      let avgCost = pos.avg_price || pos.avg_cost || null; if (avgCost) avgCost = rnd(Number(avgCost), 4);
      const d = inp.data[yahoo]; if (!d) continue;
      const current = d.current, zones = entryZones(current, d.low_52w, d.high_52w, avgCost, cur), week = thisWeekTarget(current, d.ma20, d.ma50, d.rsi, avgCost), [score, verdict, card] = scorecard(d, avgCost);
      rows.push({ ticker: yahoo, display: d.short_name || pos.display || yahoo, pie, currency_symbol: cur, score, score_max: 100, verdict, entry_zones: JSON.stringify(zones), scorecard: JSON.stringify(card), earnings: JSON.stringify({}),
        this_week: JSON.stringify({ action: week.action, price: week.price, rationale: week.rationale, current, avg_cost: avgCost, quantity: 0, rsi: d.rsi, ma20: d.ma20, ma50: d.ma50, vol_pct: d.vol_annual_pct, high_52w: d.high_52w, low_52w: d.low_52w, week_high: d.week_high, week_low: d.week_low,
          pe: d.pe_ratio === undefined ? null : d.pe_ratio, fwd_pe: d.forward_pe === undefined ? null : d.forward_pe, vol_ratio: d.vol_ratio, mom_4w: d.mom_4w, mom_1w: d.mom_1w, t212: pos.ticker }),   // signals for the Dip Planner (docs/js/dipplan.js)
        warning: warning(d, avgCost), notes: null, updated_at: inp.nowIso });
    }
    return { rows, active };
  }

  // opts: { store, market }
  async function run(opts, nowDate) {
    const { store, market } = opts, S = root.ZKSymbols, d = nowDate || new Date();
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = (await store.load('positions')).filter(p => p.snapshot_id === snap.id).sort((a, b) => String(a.pie).localeCompare(String(b.pie)) || String(a.ticker).localeCompare(String(b.ticker)));
    if (!positions.length) return { error: 'no positions' };
    const data = {};
    await Promise.all(positions.map(async p => {
      const y = S.t212ToYahoo(p.ticker, p.exchange || '')[0], c = await market.chart(y, '1y'); if (!c) return;
      const r = c.close.map((x, i) => c.adjclose[i] / x), info = await market.info(y);
      data[y] = yahooData({ c: c.adjclose, h: c.high.map((x, i) => (x == null ? c.close[i] : x) * r[i]), l: c.low.map((x, i) => (x == null ? c.close[i] : x) * r[i]), v: (c.volume || []).map(x => x || 0) }, info, y);
    }));
    const out = compute({ positions, data, nowIso: d.toISOString() });
    await store.put('value_buy_scores', out.rows, r => r.ticker);
    const keep = new Set(out.active); for (const e of await store.load('value_buy_scores')) if (!keep.has(e.ticker)) await store.remove('value_buy_scores', e.ticker);
    return out;
  }
  root.ZKValueBuy = { compute, run, yahooData, calcRsi };
  if (typeof module !== 'undefined') module.exports = root.ZKValueBuy;
})(typeof window !== 'undefined' ? window : globalThis);
