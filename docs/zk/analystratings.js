// Port of services/analyst_service.py: star rating per holding from Yahoo analyst consensus, or a price-trend rating for ETFs/uncovered tickers.
(function (root) {
  'use strict';
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d);
  const stars = b => b >= 70 ? 5 : b >= 55 ? 4 : b >= 40 ? 3 : b >= 25 ? 2 : 1;
  const REC_MAP = { strong_buy: [85, 10, 5], buy: [65, 25, 10], hold: [30, 50, 20], underperform: [15, 35, 50], sell: [10, 20, 70], none: [40, 40, 20] };
  const truthy = v => v !== null && v !== undefined && v !== 0 && v !== '' && !Number.isNaN(v);

  // info: relay /yahoo-info result (or null on failure). trend: info.trend = rows newest-first ['0m','-1m','-2m','-3m'] (yfinance order)
  function fromAnalysts(info) {
    if (!info) return null;
    const recommendation = (info.recommendationKey || 'none').toLowerCase(), targetMean = truthy(info.targetMeanPrice) ? info.targetMeanPrice : null, analystCount = info.numberOfAnalystOpinions || 1;
    let buy = null, hold = null, sell = null;
    const recs = Array.isArray(info.trend) ? info.trend : [];
    if (recs.length) {
      const recent = recs.length >= 3 ? recs.slice(-3) : recs, sum = k => recent.reduce((a, r) => a + (Number(r[k]) || 0), 0);
      const sb = sum('strongBuy'), b = sum('buy'), h = sum('hold'), s = sum('sell'), ss = sum('strongSell'), total = (sb + b + h + s + ss) || analystCount || 1;
      buy = rnd((sb + b) / total * 100, 1); hold = rnd(h / total * 100, 1); sell = rnd((s + ss) / total * 100, 1);
    }
    if (buy === null) [buy, hold, sell] = REC_MAP[recommendation] || [40, 40, 20];
    if (recommendation === 'none' && !targetMean) return null;
    return { recommendation, star_rating: stars(buy), target_mean: targetMean, buy_pct: buy, hold_pct: hold, sell_pct: sell, analyst_count: analystCount };
  }
  // closes: 1y daily adjusted closes
  function trendRating(closes) {
    if (!closes || closes.length < 60) return null;
    const n = closes.length, price = closes[n - 1], sumOf = a => a.reduce((x, y) => x + y, 0);
    const ma50 = sumOf(closes.slice(-50)) / 50, ma200 = sumOf(closes.slice(-200)) / Math.min(n, 200), base6 = n >= 126 ? closes[n - 126] : closes[0], ret6 = (price / base6 - 1) * 100;
    let points = 0; if (price > ma200) points++; if (ma50 > ma200) points++; if (ret6 > 3) points++; if (ret6 > 10) points++;
    if (price < ma50 && price > ma200) points++;
    points = Math.min(points, 4); const knife = ret6 < -25; if (knife) points = 0;
    const buy = knife ? 15.0 : [25.0, 40.0, 55.0, 65.0, 80.0][points], sell = knife ? 55.0 : [35.0, 25.0, 15.0, 10.0, 5.0][points], hold = rnd(100 - buy - sell, 1);
    const rec = knife ? 'sell' : points === 4 ? 'strong_buy' : points >= 2 ? 'buy' : points === 1 ? 'hold' : 'underperform';
    return { recommendation: rec, star_rating: stars(buy), target_mean: null, buy_pct: buy, hold_pct: hold, sell_pct: sell, analyst_count: 0 };
  }
  // inp: { positions:[{ticker,pie,exchange}], data:{yahoo: {info, closes}}, nowIso }
  function compute(inp) {
    const seen = new Map(); for (const p of inp.positions) seen.set(p.ticker, p);
    const rows = [], rated = [];
    for (const pos of seen.values()) {
      const pie = (pos.pie || 'Solo holdings').trim(), y = root.ZKSymbols.t212ToYahoo(pos.ticker, pos.exchange === undefined ? '' : pos.exchange)[0], d = inp.data[y] || {};
      const data = fromAnalysts(d.info) || trendRating(d.closes);
      if (!data) continue;
      rows.push({ ticker: pos.ticker, yahoo_ticker: y, pie, recommendation: data.recommendation, star_rating: data.star_rating, target_mean: data.target_mean, buy_pct: data.buy_pct, hold_pct: data.hold_pct,
        sell_pct: data.sell_pct, analyst_count: data.analyst_count, source: (data.analyst_count || 0) > 0 ? 'analysts' : 'trend', updated_at: inp.nowIso });
      rated.push(pos.ticker);
    }
    return { rows, rated };
  }
  // opts: { store, market }
  async function run(opts, nowDate) {
    const { store, market } = opts, d = nowDate || new Date();
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = (await store.load('positions')).filter(p => p.snapshot_id === snap.id);
    if (!positions.length) return { error: 'no positions' };
    const data = {};
    await Promise.all(positions.map(async p => {
      const y = root.ZKSymbols.t212ToYahoo(p.ticker, p.exchange || '')[0];
      if (data[y]) return; data[y] = {};
      data[y].info = await market.info(y);
      if (!fromAnalysts(data[y].info)) { const c = await market.chart(y, '1y'); data[y].closes = c ? c.adjclose.filter(x => x !== null && x !== undefined && !Number.isNaN(x)) : null; }
    }));
    const out = compute({ positions, data, nowIso: d.toISOString() });
    await store.put('analyst_ratings', out.rows, r => r.ticker);
    if (out.rated.length) { const keep = new Set(out.rated); for (const e of await store.load('analyst_ratings')) if (!keep.has(e.ticker)) await store.remove('analyst_ratings', e.ticker); }
    return out;
  }
  root.ZKAnalystRatings = { compute, run, fromAnalysts, trendRating };
  if (typeof module !== 'undefined') module.exports = root.ZKAnalystRatings;
})(typeof window !== 'undefined' ? window : globalThis);
