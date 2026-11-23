// Port of services/watchlist_service.py: this week's call for every bookmarked symbol (verified prices, RSI/MAs, volume read, quality,
// verdict, entry points, sizing, drill-down). The watchlist itself is the customer's own data and lives encrypted.
(function (root) {
  'use strict';
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d);
  const VB = () => root.ZKValueBuy, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const TRANCHES = [0.40, 0.30, 0.30], MIN_SESSIONS = 60, SUBUNITS = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' }, MAX_STALE_DAYS = 4;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const truthy = v => v !== null && v !== undefined && v !== 0 && v !== '' && !Number.isNaN(v) && v !== false;
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== undefined;
  const g = (o, k) => (o && o[k] !== undefined ? o[k] : null);
  // Python format helpers
  const fx = (x, d) => rnd(x, d).toFixed(d);
  const fc = (x, d) => { const [i, f] = rnd(Math.abs(x), d).toFixed(d).split('.'); return (x < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+$)/g, ',') + (f ? '.' + f : ''); };
  const fs = (x, d) => { const neg = x < 0 || Object.is(x, -0) || rnd(x, d) < 0; return (neg ? '-' : '+') + Math.abs(rnd(x, d)).toFixed(d); };
  const num = v => { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; const f = Number(v); return Number.isNaN(f) || !Number.isFinite(f) ? null : f; };
  const rndPx = v => v === null || v === undefined ? null : rnd(v, v >= 1 ? 2 : 4);
  const dday = (nowDate, iso) => Math.floor((Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()) - Date.parse(iso + 'T00:00:00Z')) / 86400000);

  function fmtPx(v, ccy, quote) {
    if (v === null || v === undefined) return '—';
    if (quote === 'GBp' || quote === 'GBX') return `${fc(v * 100, 2)}p`;
    const sym = { GBP: '£', USD: '$', EUR: '€' }[ccy];
    return sym ? `${sym}${fc(v, 2)}` : `${fc(v, 2)} ${ccy}`;
  }
  function classifyRsi(r) { if (r === null) return 'n/a'; if (r < 30) return 'Low — oversold'; if (r < 40) return 'Low'; if (r <= 60) return 'Neutral'; if (r <= 70) return 'Elevated'; return 'High — overbought'; }
  function classifyVolume(ratio, daily) {
    if (ratio === null) return ['No data', 'No reliable volume data for this line.'];
    const lab = ratio < 0.7 ? 'Low' : ratio > 1.5 ? 'High' : 'Normal'; let note;
    if (lab === 'High' && daily <= -1.5) note = 'Heavy volume on a down day — selling pressure; let it settle.';
    else if (lab === 'High' && daily >= 1.5) note = 'Heavy volume on an up day — strong buying interest.';
    else if (lab === 'High') note = 'Unusually busy session — check the news.';
    else if (lab === 'Low' && daily < 0) note = 'Quiet pullback on light volume — usually healthy.';
    else if (lab === 'Low' && daily > 0) note = 'Rally on light volume — weak conviction.';
    else if (lab === 'Low') note = 'Light trading — fewer buyers and sellers than usual.';
    else note = 'Normal trading activity.';
    return [lab, note];
  }

  // chart: unadjusted daily series from ZKMarket.chart(sym,'1y'); det: { info, rec_counts } from ZKMarket.detail(sym)
  function prepare(chart, det, nowDate, category) {
    if (!chart || !chart.close || !chart.close.length) return [null, 'no price history'];
    const idx = []; chart.close.forEach((c, i) => { if (c !== null && c !== undefined && !Number.isNaN(c)) idx.push(i); });
    if (idx.length < MIN_SESSIONS) return [null, `only ${idx.length} sessions of history (need ${MIN_SESSIONS})`];
    const dates = idx.map(i => chart.dates[i]), lastDate = dates[dates.length - 1];
    if (dday(nowDate, lastDate) > (category === 'crypto' ? 2 : MAX_STALE_DAYS)) { const d = new Date(lastDate + 'T00:00:00Z'); return [null, `latest close is stale (${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]})`]; }
    const quote = (chart.currency || '').trim(); if (!quote) return [null, 'listing currency unknown'];
    const scale = quote in SUBUNITS ? 0.01 : 1.0, ccy = quote in SUBUNITS ? SUBUNITS[quote] : quote.toUpperCase();
    const closes = idx.map(i => Number(chart.close[i]) * scale), window = closes.slice(-20), jumps = [];
    for (let i = 0; i < window.length - 1; i++) if (window[i] > 0) jumps.push(window[i + 1] / window[i]);
    if (Math.min(...window) <= 0 || jumps.some(j => j > 8 || j < 1 / 8)) return [null, 'inconsistent price units in history'];
    const vols = idx.map(i => chart.volume && chart.volume[i] !== null && chart.volume[i] !== undefined ? Number(chart.volume[i]) : NaN);
    const st = chart.regularStart, en = chart.regularEnd, nowS = nowDate.getTime() / 1000;
    let partial = !!(st && en && st <= nowS && nowS < en);
    if (category === 'crypto') partial = lastDate === nowDate.toISOString().slice(0, 10);
    const vser = partial ? vols.slice(0, -1) : vols;
    let volRatio = null, volLast = null, volAvg = null;
    if (vser.length >= 21 && mean(vser.slice(-21, -1)) > 0) { volLast = vser[vser.length - 1]; volAvg = mean(vser.slice(-21, -1)); volRatio = volAvg ? volLast / volAvg : null; }
    const info = Object.assign({}, (det && det.info) || {}), rc = det && det.rec_counts;
    if (rc) info._rec_counts = { strongBuy: Math.trunc(rc.strongBuy || 0), buy: Math.trunc(rc.buy || 0), hold: Math.trunc(rc.hold || 0), sell: Math.trunc(rc.sell || 0), strongSell: Math.trunc(rc.strongSell || 0) };
    return [{ closes, dates, ccy, quote_ccy: quote, last_date: lastDate, info, scale, volumes: vols, exchange: chart.exchange || null, vol_ratio: volRatio, vol_last: volLast, vol_avg: volAvg, partial }, null];
  }

  function quality(info, price, ma200, closes, isEtf, category) {
    const reasons = []; let score = 0;
    if (category === 'crypto' || category === 'commodity' || isEtf) {
      const [calm, wild] = ({ crypto: [60, 100], commodity: [25, 45] })[category] || [22, 35];
      if (ma200 && price > ma200) { score++; reasons.push('✓ Above its 200-day average (uptrend)'); } else if (ma200) { score--; reasons.push('✗ Below its 200-day average (downtrend)'); }
      const r1y = (closes[closes.length - 1] / closes[0] - 1) * 100;
      if (r1y > 0) { score++; reasons.push(`✓ 1-year return ${fs(r1y, 1)}%`); } else { score--; reasons.push(`✗ 1-year return ${fs(r1y, 1)}%`); }
      const rets = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]), mu = mean(rets), vol = Math.sqrt(mean(rets.map(r => (r - mu) * (r - mu)))) * Math.sqrt(252) * 100;
      if (vol < calm) { score++; reasons.push(`✓ Moderate volatility for its class (${fx(vol, 0)}%/yr)`); } else if (vol > wild) { score--; reasons.push(`✗ Very volatile (${fx(vol, 0)}%/yr)`); } else reasons.push(`• Volatility ${fx(vol, 0)}%/yr`);
      if (category === 'crypto') { const mc = info.marketCap; if (mc && mc >= 10e9) { score++; reasons.push(`✓ Large market cap ($${fc(mc / 1e9, 0)}bn)`); } else if (mc && mc < 1e9) { score--; reasons.push(`✗ Small market cap ($${fc(mc / 1e9, 2)}bn) — higher risk`); } }
      return [score >= 2 ? 'Good' : score >= 0 ? 'Mixed' : 'Weak', score, reasons];
    }
    const rec = (info.recommendationKey || 'none').toLowerCase(), n = info.numberOfAnalystOpinions || 0;
    if ((rec === 'strong_buy' || rec === 'buy') && n >= 3) { score += 2; reasons.push(`✓ Analysts: ${rec.replace(/_/g, ' ')} (${n})`); }
    else if (['sell', 'underperform', 'strong_sell'].includes(rec)) { score -= 2; reasons.push(`✗ Analysts: ${rec} (${n})`); }
    else if (rec !== 'none') reasons.push(`• Analysts: ${rec.replace(/_/g, ' ')} (${n})`); else reasons.push('• No analyst coverage');
    const pm = g(info, 'profitMargins'), rg = g(info, 'revenueGrowth'), roe = g(info, 'returnOnEquity'), de = g(info, 'debtToEquity');
    if (pm !== null) { if (pm > 0.10) { score++; reasons.push(`✓ Profit margin ${fx(pm * 100, 0)}%`); } else if (pm < 0) { score--; reasons.push(`✗ Loss-making (margin ${fx(pm * 100, 0)}%)`); } }
    if (rg !== null) { if (rg > 0.05) { score++; reasons.push(`✓ Revenue growth ${fs(rg * 100, 0)}%`); } else if (rg < 0) { score--; reasons.push(`✗ Revenue shrinking ${fs(rg * 100, 0)}%`); } }
    if (roe !== null && roe > 0.15) { score++; reasons.push(`✓ Return on equity ${fx(roe * 100, 0)}%`); }
    if (de !== null && de > 200) { score--; reasons.push(`✗ High debt (D/E ${fx(de, 0)}%)`); }
    if (ma200) { if (price > ma200) { score++; reasons.push('✓ Above its 200-day average (uptrend)'); } else { score--; reasons.push('✗ Below its 200-day average (downtrend)'); } }
    return [score >= 3 ? 'Good' : score >= 0 ? 'Mixed' : 'Weak', score, reasons];
  }
  function supportLevels(price, ma20, ma50, ma200, low20, low52, high52) {
    const spread = (high52 - low52) || price * 0.3;
    let cands = [['20-day average', ma20], ['50-day average', ma50], ['200-day average', ma200], ['20-day low', low20], ['Lower quarter of 52-week range', low52 + spread * 0.25]]
      .filter(([, v]) => truthy(v) && v < price * 0.995).sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const [n, v] of cands) if (picked.every(p => Math.abs(v / p[1] - 1) >= 0.03)) picked.push([n, v]);
    for (const f of [0.95, 0.90, 0.85, 0.80]) { if (picked.length >= 3) break; const v = price * f; if (picked.every(p => Math.abs(v / p[1] - 1) >= 0.03)) picked.push([`${Math.round((1 - f) * 100)}% below today`, v]); }
    return picked.sort((a, b) => b[1] - a[1]).slice(0, 3);
  }

  const REC_LABEL = [[1.5, 'Strong buy'], [2.5, 'Buy'], [3.5, 'Hold'], [4.5, 'Sell'], [9, 'Strong sell']];
  const maxOf = a => Math.max(...a), minOf = a => Math.min(...a);
  function buildDrilldown(d, price, ccy, isEtf, category, perf0) {
    const info = d.info, scale = d.scale, c = d.closes, px = k => num(info[k]) !== null ? num(info[k]) * scale : null;
    const shares = num(info.sharesOutstanding); let mcap = num(info.marketCap);
    if (shares && price) { const calc = shares * price; if (!mcap || !(0.2 < mcap / calc && mcap / calc < 5)) mcap = calc; }
    const or = (a, b) => truthy(a) ? a : b;
    const stats = { prev_close: or(px('previousClose'), c.length > 1 ? c[c.length - 2] : null), open: or(px('open'), px('regularMarketOpen')), day_low: px('dayLow'), day_high: px('dayHigh'), volume: num(info.volume), avg_volume: num(info.averageVolume),
      market_cap: mcap, shares_out: shares, pe: num(info.trailingPE), fwd_pe: num(info.forwardPE), div_yield: num(info.dividendYield), beta: num(info.beta),
      high52: or(px('fiftyTwoWeekHigh'), maxOf(c.slice(-252))), low52: or(px('fiftyTwoWeekLow'), minOf(c.slice(-252))) };
    for (const k of ['prev_close', 'open', 'day_low', 'day_high', 'high52', 'low52']) if (truthy(stats[k]) && price && !(0.33 < stats[k] / price && stats[k] / price < 3)) stats[k] = null;
    stats.high52 = or(stats.high52, maxOf(c.slice(-252))); stats.low52 = or(stats.low52, minOf(c.slice(-252)));
    const f = {}; for (const k of ['profitMargins', 'operatingMargins', 'returnOnAssets', 'returnOnEquity', 'debtToEquity', 'currentRatio', 'quickRatio', 'revenueGrowth', 'earningsGrowth']) f[k] = num(info[k]);
    const fundamentals = { net_margin: f.profitMargins, op_margin: f.operatingMargins, roa: f.returnOnAssets, roe: f.returnOnEquity, debt_to_equity: f.debtToEquity, current_ratio: f.currentRatio, quick_ratio: f.quickRatio, revenue_growth: f.revenueGrowth, earnings_growth: f.earningsGrowth };
    let mean0 = num(info.recommendationMean); const rc = info._rec_counts || {}, keys = ['strongBuy', 'buy', 'hold', 'sell', 'strongSell'], nRc = Object.values(rc).reduce((a, b) => a + b, 0);
    if (mean0 === null && nRc) mean0 = rnd(keys.reduce((a, k, i) => a + (i + 1) * (rc[k] || 0), 0) / nRc, 2);
    if (mean0 === null) { const m = { strong_buy: 1.3, buy: 2.0, hold: 3.0, underperform: 4.0, sell: 4.5, strong_sell: 4.8 }[(info.recommendationKey || '').toLowerCase()]; mean0 = m === undefined ? null : m; }
    const tgt = k => truthy(num(info[k])) ? num(info[k]) * scale : null;
    const hit = REC_LABEL.find(([t]) => truthy(mean0) && mean0 <= t);
    const analyst = { mean: mean0, label: hit ? hit[1] : null, count: Math.trunc(info.numberOfAnalystOpinions || nRc || 0), breakdown: Object.keys(rc).length ? rc : null, target_mean: tgt('targetMeanPrice'), target_low: tgt('targetLowPrice'), target_high: tgt('targetHighPrice') };
    if (truthy(analyst.target_mean) && price && !(-90 < (analyst.target_mean / price - 1) * 100 && (analyst.target_mean / price - 1) * 100 < 300)) { analyst.target_mean = null; analyst.target_low = null; analyst.target_high = null; }
    const summary = String(info.longBusinessSummary || '').trim(), chars = Array.from(summary);
    const profile = { sector: or(info.sector, info.category) === undefined ? null : or(info.sector, g(info, 'category')), industry: g(info, 'industry'), summary: chars.slice(0, 900).join('') + (chars.length > 900 ? '…' : ''), website: g(info, 'website'), employees: g(info, 'fullTimeEmployees'), country: g(info, 'country'), fund_family: g(info, 'fundFamily'), expense_ratio: num(info.annualReportExpenseRatio) };
    const perf = {}; for (const [lbl, n] of [['1M', 21], ['6M', 126], ['1Y', 251]]) if (c.length > n) perf[lbl] = rnd((c[c.length - 1] / c[c.length - n - 1] - 1) * 100, 1);
    return { stats, fundamentals, analyst_detail: analyst, profile, performance: perf, insights: insights(stats, fundamentals, analyst, perf, price, isEtf, category),
      history: { dates: d.dates.slice(-260), closes: c.slice(-260).map(x => rnd(x, 6)) } };
  }
  function insights(st, fu, an, perf, price, isEtf, category) {
    const good = [], bad = [], score = {}, clamp = x => Math.max(0, Math.min(6, rnd(x, 0)));
    if ((an.label === 'Strong buy' || an.label === 'Buy') && an.count >= 3) good.push(`Analysts rate it ${an.label} (${an.count} analysts)`);
    else if (an.label === 'Sell' || an.label === 'Strong sell') bad.push(`Analysts rate it ${an.label} (${an.count} analysts)`);
    if (truthy(an.target_mean) && price) { const up = (an.target_mean / price - 1) * 100; if (up >= 10) good.push(`Average analyst target ${fs(up, 0)}% above today's price`); else if (up < 0) bad.push(`Average analyst target ${fs(up, 0)}% below today's price`); }
    const pe = st.pe, fpe = st.fwd_pe;
    if (pe !== null) {
      let v = (0 < pe && pe < 10) ? 6 : pe < 15 ? 5 : pe < 20 ? 4 : pe < 25 ? 3 : pe < 35 ? 2 : pe < 60 ? 1 : 0; if (pe <= 0) v = 0;
      if (truthy(fpe) && truthy(pe) && 0 < fpe && fpe < pe) { v += 1; good.push(`Earnings expected to grow (forward P/E ${fx(fpe, 1)} below trailing ${fx(pe, 1)})`); }
      if (0 < pe && pe < 15) good.push(`Low P/E of ${fx(pe, 1)}`); else if (pe > 40) bad.push(`Expensive on earnings (P/E ${fx(pe, 1)})`);
      score.valuation = clamp(v);
    }
    const nm = fu.net_margin, roa = fu.roa, roe = fu.roe;
    if (nm !== null || roa !== null) {
      let e = 0;
      if (nm !== null) { e += nm > .2 ? 3 : nm > .1 ? 2 : nm > 0 ? 1 : 0; if (nm > .1) good.push(`Healthy net profit margin (${fx(nm * 100, 1)}%)`); else if (nm < .05) bad.push(`Thin net profit margin (${fx(nm * 100, 1)}%)`); }
      if (roa !== null) { e += roa > .08 ? 2 : roa > .03 ? 1 : 0; if (roa < .03) bad.push(`Low return on assets (${fx(roa * 100, 1)}%)`); }
      if (roe !== null && roe > .15) { e += 1; good.push(`Strong return on equity (${fx(roe * 100, 0)}%)`); }
      score.earnings = clamp(e);
    }
    const rg = fu.revenue_growth, eg = fu.earnings_growth;
    if (rg !== null || eg !== null) {
      let gg = 0;
      if (rg !== null) { gg += rg > .2 ? 3 : rg > .08 ? 2 : rg > 0 ? 1 : 0; if (rg > .08) good.push(`Revenue growing ${fs(rg * 100, 0)}% year on year`); else if (rg < -.01) bad.push(`Revenue shrinking ${fs(rg * 100, 0)}% year on year`); }
      if (eg !== null) { gg += eg > .2 ? 3 : eg > .05 ? 2 : eg > 0 ? 1 : 0; if (eg < 0) bad.push(`Earnings shrinking (${fs(eg * 100, 0)}%)`); }
      score.growth = clamp(gg);
    }
    if (Object.keys(perf).length) {
      const y = g(perf, '1Y'), m6 = g(perf, '6M'), Y = y || 0, M = m6 || 0;
      const p = 3 + (Y > 15 ? 1.5 : Y > 0 ? .5 : Y < -15 ? -1.5 : -.5) + (M > 10 ? 1.5 : M > 0 ? .5 : M < -10 ? -1.5 : -.5);
      score.performance = clamp(p);
      if (y !== null) (y > 0 ? good : bad).push(`${y > 0 ? 'Up' : 'Down'} ${fx(Math.abs(y), 0)}% over the past year`);
    }
    const cr = fu.current_ratio, de = fu.debt_to_equity;
    if (cr !== null || de !== null) {
      let h = 3;
      if (cr !== null) { if (cr < 1) { h -= 2; bad.push(`Short-term liabilities exceed short-term assets (current ratio ${fx(cr, 2)})`); } else if (cr > 1.5) { h += 1; good.push(`Covers short-term liabilities comfortably (current ratio ${fx(cr, 2)})`); } }
      if (de !== null) { if (de > 150) { h -= 2; bad.push(`High debt (debt/equity ${fx(de, 0)}%)`); } else if (de < 50) { h += 2; good.push(`Low debt (debt/equity ${fx(de, 0)}%)`); } }
      score.health = clamp(h);
    }
    if ((isEtf || category === 'commodity' || category === 'crypto') && !score.valuation) good.push('Fund/asset: judged on price trend and volatility — no company fundamentals');
    return { items: good.map(t => ({ good: true, text: t })).concat(bad.map(t => ({ good: false, text: t }))), scores: score };
  }

  // item: watchlist row; chart/det: market data; perGbp: rate or null
  function analyse(item, chart, det, perGbp, nowDate) {
    const sym = item.ticker, category = item.category || 'stock', [d, reason] = prepare(chart, det, nowDate, category);
    const base = { symbol: sym, exchange: g(item, 'exchange'), name: g(item, 'name'), t212_ticker: g(item, 't212_ticker'), category, alternatives: item.alternatives || [] };
    if (reason) return ['unverified', null, Object.assign({}, base, { reason })];
    const c = d.closes, info = d.info, ccy = d.ccy, price = c[c.length - 1], prev = c[c.length - 2], daily = (price / prev - 1) * 100, rsi = VB().calcRsi(c);
    const ma20 = mean(c.slice(-20)), ma50 = mean(c.slice(-50)), ma200 = c.length >= 200 ? mean(c.slice(-200)) : null, high52 = maxOf(c), low52 = minOf(c), low20 = minOf(c.slice(-20)), high20 = maxOf(c.slice(-20));
    const rangePos = high52 > low52 ? (price - low52) / (high52 - low52) : 0.5, isEtf = item.type === 'ETF' || info.quoteType === 'ETF';
    if (d.exchange) base.exchange = d.exchange;
    const [qLabel, qScore, qReasons] = quality(info, price, ma200, c, isEtf, category), [volLabel, volNote] = classifyVolume(d.vol_ratio, daily), rsiLabel = classifyRsi(rsi), rec = (info.recommendationKey || 'none').toLowerCase();
    let tgt = info.targetMeanPrice; tgt = truthy(tgt) ? tgt * ((info.currency in SUBUNITS) ? 0.01 : 1) : null;
    let upside = tgt ? (tgt / price - 1) * 100 : null;
    if (upside !== null && !(-90 < upside && upside < 300)) { tgt = null; upside = null; }
    const downtrend = !!(ma200 && price < ma200 && ma50 < ma200), r50 = rsi || 50, overbought = r50 > 70 || (rangePos > 0.9 && price > ma20 * 1.05), selling = volLabel === 'High' && daily <= -1.5;
    const why = [], trendOnly = isEtf || category === 'commodity' || category === 'crypto', smallCoin = category === 'crypto' && (info.marketCap || 0) < 1e9;
    let verdict;
    if (qLabel === 'Weak' && (!trendOnly || smallCoin) && rec !== 'strong_buy' && rec !== 'buy') { verdict = 'AVOID'; why.push(smallCoin ? 'Small, weak coin — not worth the risk.' : 'Quality checks are weak — not worth the risk this week.'); }
    else if (qLabel === 'Weak' && trendOnly) { verdict = 'HOLD'; why.push("In a downtrend (below its 200-day average, negative 1-year return) — wait for it to turn; the price points below are where it gets interesting."); }
    else if (overbought) { verdict = 'HOLD'; why.push(`Stretched: RSI ${fx(rsi, 0)} and trading near its highs — wait for a pullback.`); }
    else if (downtrend) { if (qLabel === 'Good') { verdict = 'ACCUMULATE'; why.push("Good business in a downtrend — build slowly in small steps, don't rush."); } else { verdict = 'HOLD'; why.push('Downtrend (below falling 200-day average) — wait for the trend to turn.'); } }
    else if (rsi !== null && rsi < 35) { verdict = 'ENTER'; if (ma200 && price < ma200) why.push(`RSI ${fx(rsi, 0)} is oversold, but it's below its 200-day average — enter small and add only if it stabilises.`); else why.push(`RSI ${fx(rsi, 0)} is oversold while the longer trend holds — a reasonable entry.`); }
    else if (rsi !== null && rsi < 50) { verdict = 'ACCUMULATE'; why.push(`RSI ${fx(rsi, 0)} — momentum has cooled; buy gradually at the price points.`); }
    else if (rsi !== null && rsi < 60 && qLabel === 'Good' && !downtrend) { verdict = 'ACCUMULATE'; why.push(`Healthy uptrend, RSI ${fx(rsi, 0)} — small first buy, add on dips.`); }
    else { verdict = 'HOLD'; why.push(`RSI ${fx(rsi, 0)} — no edge at today's price; set alerts at the entry points.`); }
    if (verdict === 'ENTER' && selling) { verdict = 'ACCUMULATE'; why.push('Heavy selling volume today — stage the buys instead of all at once.'); }
    if ((verdict === 'ENTER' || verdict === 'ACCUMULATE') && qLabel === 'Mixed') why.push('Quality is mixed — keep the position small.');
    const alts = item.alternatives || [];
    if (category === 'crypto') why.push('Crypto swings hard — keep it a small slice of the portfolio.');
    if (!truthy(item.t212_ticker) && ['ENTER', 'ACCUMULATE', 'HOLD'].includes(verdict)) {
      if (alts.length) why.push('On Trading 212 buy it via ' + alts.slice(0, 3).map(a => (a.symbol || '').replace(/\.L/g, '')).join(', ') + (category === 'crypto' ? ' (ETPs that track the coin)' : ' (ETCs that track the price)') + '.');
      else if (category === 'crypto') why.push('Not buyable directly on Trading 212 Invest — use a crypto exchange, or check the app for an ETP.');
      else if (category === 'commodity') why.push('This is the futures price (for reference) — buy exposure through an ETC on Trading 212.');
      else why.push('Not found on your Trading 212 exchanges — check the app or buy via another broker.');
    }
    if (upside !== null && verdict !== 'AVOID') why.push(`Analyst average target ${fmtPx(tgt, ccy, d.quote_ccy)} (${fs(upside, 0)}% from here).`);
    const levels = supportLevels(price, ma20, ma50, ma200, low20, low52, high52); let entries = [];
    if (verdict === 'ENTER') entries = [['Buy now (market)', price]].concat(levels.slice(0, 2));
    else if (verdict === 'ACCUMULATE') entries = [['Small first buy now', price]].concat(levels.slice(0, 2));
    else if (verdict === 'HOLD') entries = levels.slice(0, 3);
    const invalidation = minOf(levels.map(l => l[1]).concat([price])) * 0.93, takeProfit = truthy(tgt) && tgt > price ? tgt : high52 > price * 1.03 ? high52 : null;
    const out = Object.assign({}, base, { type: isEtf ? 'ETF' : 'Stock', ccy, per_gbp: perGbp, price: rndPx(price), daily_pct: rnd(daily, 2), as_of: d.last_date, rsi, rsi_label: rsiLabel,
      volume: { ratio: truthy(d.vol_ratio) ? rnd(d.vol_ratio, 2) : null, label: volLabel, note: volNote, partial_excluded: d.partial },
      ma20: rndPx(ma20), ma50: rndPx(ma50), ma200: rndPx(ma200), high52: rndPx(high52), low52: rndPx(low52), range_pos: rnd(rangePos * 100, 0), drawdown20: rnd((price / high20 - 1) * 100, 2),
      quality: { label: qLabel, score: qScore, reasons: qReasons }, analyst: { rec, count: info.numberOfAnalystOpinions || 0, target: rndPx(tgt), upside: upside !== null ? rnd(upside, 1) : null },
      why, entries_raw: entries.map(([n, v]) => [n, rndPx(v)]), invalidation: rndPx(invalidation), take_profit: rndPx(takeProfit), sector: g(info, 'sector'), quote_ccy: d.quote_ccy }, buildDrilldown(d, price, ccy, isEtf, category));
    return ['ok', verdict, out];
  }

  // Relative sizing only; there is no fixed budget. Each actionable name gets its share of whatever you decide to invest in the section (shares add up to 1)
  // and a split across its price points. The £ are worked out on the dashboard from the amount you enter.
  function sizePositions(results) {
    const w = { ENTER: 2, ACCUMULATE: 1 }, rawW = results.reduce((a, [st, v]) => a + (st === 'ok' ? (w[v] || 0) : 0), 0), totalW = rawW || 1, nHold = results.filter(([st, v]) => st === 'ok' && v === 'HOLD').length;
    for (const [status, verdict, data] of results) {
      if (status !== 'ok') continue; let share, basis;
      if (verdict in w) { share = w[verdict] / totalW; basis = 'this week'; } else if (verdict === 'HOLD') { share = 1 / Math.max(rawW + nHold, 1); basis = 'only if the price points are hit'; } else { share = 0; basis = 'no buys'; }
      const steps = [], raw = data.entries_raw; delete data.entries_raw;
      raw.forEach(([label, px], i) => { if (i >= TRANCHES.length) return; const pct = truthy(data.price) ? rnd((px / data.price - 1) * 100, 1) : 0; steps.push({ label, price: px, pct_from_now: pct, share: TRANCHES[i] }); });
      data.entries = steps;
      data.weight = { share: rnd(share, 4), basis };
    }
  }

  // inp: { items, data:{sym:{chart,det}}, fx:{ccy:rate|null}, now:Date } -> [{ticker,status,verdict,data}]
  function compute(inp) {
    const results = inp.items.map(item => {
      const dd = inp.data[item.ticker] || {};
      try { const prepared = prepare(dd.chart, dd.det, inp.now, item.category || 'stock'); const ccy = prepared[0] ? prepared[0].ccy : null;
        return analyse(item, dd.chart, dd.det, ccy ? (ccy === 'GBP' ? 1.0 : (inp.fx[ccy] === undefined ? null : inp.fx[ccy])) : null, inp.now); }
      catch (e) { return ['error', null, { reason: `${e.name}: ${e.message}`.slice(0, 200) }]; }
    });
    for (const cat of ['stock', 'commodity', 'crypto']) {
      const group = results.filter((r, i) => (inp.items[i].category || 'stock') === cat); if (!group.length) continue;
      sizePositions(group);
    }
    return inp.items.map((item, i) => ({ ticker: item.ticker, status: results[i][0], verdict: results[i][1], data: results[i][2] }));
  }

  // opts: { store, market }
  async function run(opts, nowDate) {
    const { store, market } = opts, now = nowDate || new Date(), items = await store.load('watchlist');
    if (!items.length) return { rows: [], empty: true };
    const data = {}, fx = {};
    await Promise.all(items.map(async it => { const [chart, det] = await Promise.all([market.chart(it.ticker, '1y'), market.detail(it.ticker)]); data[it.ticker] = { chart, det }; }));
    const ccys = new Set(); for (const it of items) { const c = data[it.ticker].chart; if (c && c.currency) { const q = c.currency.trim(); ccys.add(q in SUBUNITS ? SUBUNITS[q] : q.toUpperCase()); } }
    await Promise.all([...ccys].filter(c => c !== 'GBP').map(async c => { const ch = await market.chart(`GBP${c}=X`, '5d'); const v = ch ? ch.close.filter(x => x !== null && x !== undefined && !Number.isNaN(x)) : []; fx[c] = v.length ? v[v.length - 1] : null; }));
    const rows = compute({ items, data, fx, now });
    await store.put('watchlist_analysis', rows.map(r => Object.assign({ updated_at: now.toISOString() }, r)), r => r.ticker);
    return { rows };
  }
  root.ZKWatchlist = { compute, run, analyse, prepare, sizePositions, quality, supportLevels, insights, fmtPx };
  if (typeof module !== 'undefined') module.exports = root.ZKWatchlist;
})(typeof window !== 'undefined' ? window : globalThis);
