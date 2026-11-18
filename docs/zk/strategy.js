// Port of services/strategy_service.py: weekly allocator (pie quality, dip size, market mood, growth pace).
// compute() is pure; run() gathers prices/news through the relay and ratings/returns from the encrypted store.
(function (root) {
  'use strict';
  const MONTHLY_BUDGET_MAX = 300, TARGET_BASE = 10.0, TARGET_STRETCH = 15.0, MIN_ALLOC = 5, MAX_PIE_SHARE = 0.35, TIER_1 = ['Magnificent 7', 'Wider ETF', 'Global ETF'], TIER_1_FLOOR = 8, GROWTH_PIES = ['Magnificent 7', 'Semiconductor'];
  const STAR_WEIGHT = { 1: 0.0, 2: 0.5, 3: 1.5, 4: 2.5, 5: 3.5 };
  const NEG_WORDS = ['crash', 'selloff', 'sell-off', 'plunge', 'tumble', 'slump', 'rout', 'fear', 'recession', 'war', 'tariff', 'downgrade', 'panic', 'sinks', 'slides', 'losses', 'bear', 'volatility', 'crisis', 'default', 'layoffs', 'inflation surge'];
  const POS_WORDS = ['rally', 'record high', 'surge', 'soar', 'gains', 'rebound', 'beat', 'jumps', 'bull', 'optimism', 'upgrade', 'rate cut', 'climbs', 'strong earnings'];
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d), fmt = (x, d) => rnd(x, d).toFixed(d);
  const sgn = (x, d) => (x < 0 || Object.is(x, -0) ? '-' : '+') + fmt(Math.abs(x), d);
  const pyFloat = x => Number.isInteger(x) ? x.toFixed(1) : String(x), pyOpt = x => x === null || x === undefined ? 'None' : pyFloat(x);
  const sum = a => a.reduce((x, y) => x + y, 0), ymd = s => s.split('-').map(Number);

  function mondaysInMonth(y, m) { let n = 0; const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); for (let d = 1; d <= days; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) n++; return n; }
  function weekOfMonth(y, m, dd) { let n = 0; for (let d = 1; d <= dd; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1) n++; return n || 1; }
  function tickerStats(c) {
    if (!c || c.length < 60) return null;
    const mx = Math.max(...c), dd = (mx - c[c.length - 1]) / mx * 100, base = c.length >= 126 ? c[c.length - 126] : c[0], ret6 = (c[c.length - 1] / base - 1) * 100;
    return { dd, ann: (Math.pow(1 + ret6 / 100, 2) - 1) * 100 };
  }
  function sentiment(titles) {
    titles = [...new Set(titles.map(t => t.toLowerCase()))];
    return [titles.filter(t => POS_WORDS.some(w => t.includes(w))).length - titles.filter(t => NEG_WORDS.some(w => t.includes(w))).length, titles.length];
  }
  function mood(vixCloses, spxCloses, titles) {
    const vix = vixCloses && vixCloses.length ? vixCloses[vixCloses.length - 1] : null, spx = tickerStats(spxCloses), [net, n] = sentiment(titles);
    let level = 1; if (vix !== null) level = vix < 15 ? 0 : vix < 20 ? 1 : vix < 30 ? 2 : 3;
    if (spx && spx.dd >= 10) level += 1; if (n && net <= -3) level += 1; if (n && net >= 3 && level > 0) level -= 1;
    level = Math.max(0, Math.min(3, level));
    return { level, label: ['Greed / calm', 'Normal', 'Fear', 'Extreme fear'][level], vix: vix ? rnd(vix, 1) : null, spx_drawdown: spx ? rnd(spx.dd, 1) : null, news_net: net, news_count: n };
  }
  function pieProfile(pie, ratings, closesOf) {
    const rows = ratings.get(pie) || [], stars = rows.map(r => r.star_rating || 0);
    const stats = rows.filter(r => r.yahoo_ticker).map(r => tickerStats(closesOf(r.yahoo_ticker))).filter(Boolean);
    return { star: stars.length ? rnd(sum(stars) / stars.length, 1) : null, dd: stats.length ? rnd(sum(stats.map(s => s.dd)) / stats.length, 1) : 0.0, ann: stats.length ? rnd(sum(stats.map(s => s.ann)) / stats.length, 1) : null, n: rows.length };
  }
  function starWeight(star) { const lo = Math.trunc(star), hi = Math.min(5, lo + 1), frac = star - lo; return (STAR_WEIGHT[lo] || 0) * (1 - frac) + (STAR_WEIGHT[hi] || 0) * frac; }
  function weigh(pie, prof, md, annRet) {
    const why = []; let w, star;
    if (prof.star === null) { w = STAR_WEIGHT[3]; why.push('new pie — seed funding'); star = 3.0; } else { star = prof.star; w = starWeight(star); why.push(`⭐${pyFloat(star)}`); }
    if (w === 0) return [0.0, [...why, 'weak trend — no new money']];
    const dd = prof.dd, lvl = md.level;
    if (star >= 3 && dd >= 4) { let m = dd >= 15 ? 1.8 : dd >= 8 ? 1.4 : 1.15; if (lvl >= 2) m += 0.3; w *= m; why.push(`${fmt(dd, 0)}% off high ×${fmt(m, 2)}`); }
    if (lvl >= 2) { if (TIER_1.includes(pie)) { w *= 1.2; why.push('fear → core boost'); } else if (star < 3) { w *= 0.5; why.push('fear → trim weak'); } }
    else if (lvl === 0 && dd < 2 && (prof.ann || 0) > 30) { w *= 0.8; why.push("greed → don't chase"); }
    if (annRet !== null && annRet < TARGET_BASE && GROWTH_PIES.includes(pie)) { w *= 1.25; why.push(`behind ${fmt(TARGET_BASE, 0)}% → growth tilt`); }
    if (prof.ann !== null) { const tag = prof.ann >= TARGET_STRETCH ? '≥15%' : prof.ann >= TARGET_BASE ? '≥10%' : '<10%'; why.push(`trend ${sgn(prof.ann, 0)}%/yr (${tag})`); }
    return [w, why];
  }
  function allocate(weekly, weights) {            // weights: Map pie -> weight (insertion order matters, as in Python)
    const totalW = sum([...weights.values()]); if (totalW <= 0) return new Map();
    let alloc = new Map(); for (const [p, w] of weights) if (w > 0) alloc.set(p, weekly * w / totalW);
    for (let it = 0; it < 5; it++) {
      const cap = weekly * MAX_PIE_SHARE;
      for (const [p, a] of alloc) if (a > cap) alloc.set(p, cap);
      for (const p of TIER_1) if (alloc.has(p) && alloc.get(p) < TIER_1_FLOOR) alloc.set(p, TIER_1_FLOOR);
      alloc = new Map([...alloc].filter(([p, a]) => a >= MIN_ALLOC || TIER_1.includes(p)));
      const spare = weekly - sum([...alloc.values()]), free = new Map([...alloc].filter(([, a]) => a < cap).map(([p]) => [p, weights.get(p)])), fw = sum([...free.values()]);
      if (Math.abs(spare) < 0.5 || fw <= 0) break;
      for (const [p, w] of free) alloc.set(p, alloc.get(p) + spare * w / fw);
    }
    const rounded = new Map([...alloc].map(([p, a]) => [p, rnd(a, 0)])), diff = rnd(weekly, 0) - sum([...rounded.values()]);
    if (rounded.size && diff) { let top = null; for (const p of rounded.keys()) if (top === null || weights.get(p) > weights.get(top)) top = p; rounded.set(top, rounded.get(top) + diff); }
    return new Map([...rounded].filter(([, a]) => a > 0));
  }

  // inp: { today:'YYYY-MM-DD', ratings: Map pie->rows, livePies:[], annRaw, closes:{sym:[...]}, vix1m:[...], titles:[...], nowIso }
  function compute(inp) {
    const [y, m, d] = ymd(inp.today), weeks = mondaysInMonth(y, m), week = weekOfMonth(y, m, d), weekly = MONTHLY_BUDGET_MAX / weeks;
    const pies = inp.livePies.length ? inp.livePies : [...inp.ratings.keys()];
    const annRet = [null, undefined, '', 0, '0', '0.0'].includes(inp.annRaw) ? null : Number(inp.annRaw);
    const md = mood(inp.vix1m, inp.closes['^GSPC'], inp.titles);
    const weights = new Map(), reasons = {};
    for (const pie of pies) { const prof = pieProfile(pie, inp.ratings, s => inp.closes[s]), [w, why] = weigh(pie, prof, md, annRet); weights.set(pie, w); reasons[pie] = why; }
    const alloc = allocate(weekly, weights);
    const recs = [...alloc].sort((a, b) => b[1] - a[1]).map(([pie, amt]) => { const share = amt / weekly; return { pie, amount: amt, reason: reasons[pie].join(' · '), priority: share >= 0.25 ? 'HIGH' : share >= 0.12 ? 'MEDIUM' : 'LOW' }; });
    const skipped = pies.filter(p => !alloc.has(p));
    const notes = [`Aggressive mode · £${MONTHLY_BUDGET_MAX}/month → £${fmt(weekly, 0)} this week (week ${week} of ${weeks})`,
      `Market mood: ${md.label} — VIX ${pyOpt(md.vix)}, S&P ${pyOpt(md.spx_drawdown)}% off high, news ${md.news_net >= 0 ? '+' : '-'}${Math.abs(md.news_net)} across ${md.news_count} headlines`];
    if (md.level >= 2) notes.push('😨 Fear in the market — leaning into quality dips and core pies.'); else if (md.level === 0) notes.push('😎 Calm/greedy market — favouring pies off their highs over stretched ones.');
    if (annRet === null) notes.push(`ℹ️ Not enough history for an annualised return yet — pace tilt off until it builds up (targets ${fmt(TARGET_BASE, 0)}% base / ${fmt(TARGET_STRETCH, 0)}% stretch).`);
    else if (annRet < TARGET_BASE) notes.push(`⚠️ Annualised ${fmt(annRet, 1)}% is below the ${fmt(TARGET_BASE, 0)}% base — tilting to growth pies.`);
    else if (annRet < TARGET_STRETCH) notes.push(`📈 Annualised ${fmt(annRet, 1)}% — above ${fmt(TARGET_BASE, 0)}% base, chasing ${fmt(TARGET_STRETCH, 0)}% stretch.`);
    else notes.push(`✅ Annualised ${fmt(annRet, 1)}% — at or above the ${fmt(TARGET_STRETCH, 0)}% stretch target.`);
    if (skipped.length) notes.push('No money this week: ' + skipped.map(p => `${p} (${reasons[p].slice(-1).join(' · ')})`).join(', '));
    return { row: { week_number: week, total_suggested: sum([...alloc.values()]), on_track: annRet !== null ? annRet >= TARGET_BASE : null, annualised_return: annRet, recommendations: recs, notes, weeks_in_month: weeks, weekly_budget: rnd(weekly, 2), market_mood: md, updated_at: inp.nowIso } };
  }

  // opts: { store, market, ratings: [analyst_ratings rows] }  (pie membership comes from the customer's own snapshot)
  async function run(opts, nowDate) {
    const { store, market } = opts, d = nowDate || new Date();
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const pies = ((snap && snap.raw && snap.raw.pies) || []).filter(p => p.name), livePies = pies.map(p => p.name.trim()), pieOf = {};
    for (const p of pies) for (const i of p.instruments || []) pieOf[i.ticker] = p.name.trim();
    const ratings = new Map();
    for (const r of opts.ratings || []) { const pie = (pieOf[r.ticker] || 'Solo').trim(); if (!ratings.has(pie)) ratings.set(pie, []); ratings.get(pie).push(r); }
    const syms = new Set(['^GSPC']); for (const rows of ratings.values()) for (const r of rows) if (r.yahoo_ticker) syms.add(r.yahoo_ticker);
    const closes = {}; await Promise.all([...syms].map(async s => { const c = await market.chart(s, '1y'); closes[s] = c ? c.close : []; }));
    const vix = await market.chart('^VIX', '1mo'), titles = [];
    for (const s of ['^GSPC', 'SPY', 'QQQ']) titles.push(...(await market.headlines(s)));
    const ret = (await store.load('returns_summary'))[0] || {};
    const out = compute({ today: d.toISOString().slice(0, 10), ratings, livePies, annRaw: ret.annualised_pct, closes, vix1m: vix ? vix.close : [], titles, nowIso: d.toISOString() });
    await store.put('strategy_recommendations', [out.row], () => 'main');
    return out;
  }
  root.ZKStrategy = { compute, run, allocate, weigh, mondaysInMonth, weekOfMonth };
  if (typeof module !== 'undefined') module.exports = root.ZKStrategy;
})(typeof window !== 'undefined' ? window : globalThis);
