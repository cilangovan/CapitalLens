// Run: node tests/zk_dipplan_test.mjs
// Dip Planner (Strategy tab): no fixed budget; the amount you type is split across pies and stocks from RSI, momentum, volume, PE, entry point, dip depth, overbought and the market mood.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const DP = require('../docs/js/dipplan.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const sum = a => a.reduce((x, y) => x + y, 0), r2 = x => Math.round(x * 100) / 100;

// A stock row as the Entry Analysis saves it (this_week carries the signals)
const S = (ticker, pie, score, w, extra = {}) => ({ ticker, t212: extra.t212 === undefined ? ticker + '_US_EQ' : extra.t212, display: extra.display || ticker, pie, score, verdict: score >= 75 ? 'Value Buy' : 'Accumulate', currency_symbol: '$',
  w: Object.assign({ action: 'ACCUMULATE', price: 100, current: 100, high_52w: 130, low_52w: 80, rsi: 38, mom_4w: -6, mom_1w: 1.2, vol_ratio: 1.4, pe: 18, fwd_pe: 16 }, w) });
const FEAR = { level: 3, label: 'Extreme fear', vix: 34, spx_drawdown: 11, news_net: -4, news_count: 20 };
const CALM = { level: 1, label: 'Normal', vix: 16, spx_drawdown: 1, news_net: 0, news_count: 10 };
const stocks = [
  S('AAA', 'Chips', 82, { rsi: 28, current: 90, price: 92, high_52w: 130, mom_4w: -14, mom_1w: 2, vol_ratio: 1.6, pe: 14 }),       // oversold, bouncing, cheap: strong buy
  S('BBB', 'Chips', 70, { rsi: 44, current: 100, price: 101, high_52w: 120, pe: 24 }),                                                // fair: accumulate / buy
  S('CCC', 'Chips', 60, { rsi: 78, current: 128, price: 110, high_52w: 130, mom_4w: 18, mom_1w: 3, vol_ratio: 1.0, pe: 60, action: 'HOLD / AVOID' }),  // overbought
  S('ETF1', 'World', 75, { rsi: 36, current: 95, price: 96, high_52w: 110, pe: null, fwd_pe: null }, { display: 'World ETF' }),    // ETF: no PE
  S('ETF2', 'World', 72, { rsi: 41, current: 98, price: 99, high_52w: 112, pe: null, fwd_pe: null }, { display: 'World ETF 2' }),
  S('HOT1', 'Hot', 65, { rsi: 74, current: 200, price: 170, high_52w: 201, mom_4w: 22, vol_ratio: 0.9, pe: 70, action: 'HOLD / AVOID' }),  // whole pie overbought
  S('HOT2', 'Hot', 62, { rsi: 71, current: 150, price: 130, high_52w: 151, mom_4w: 19, vol_ratio: 0.9, pe: 55, action: 'HOLD / AVOID' }),
  S('SOLO', 'Individual', 78, { rsi: 33, current: 80, price: 82, high_52w: 100, pe: 16 }, { t212: 'SOLO_US_EQ' })];
const pies = {
  'Chips': [{ ticker: 'AAA_US_EQ', expected: 0.4, current: 0.38 }, { ticker: 'BBB_US_EQ', expected: 0.3, current: 0.3 }, { ticker: 'CCC_US_EQ', expected: 0.3, current: 0.32 }],
  'World': [{ ticker: 'ETF1_US_EQ', expected: 0.5, current: 0.5 }, { ticker: 'ETF2_US_EQ', expected: 0.5, current: 0.5 }],
  'Hot': [{ ticker: 'HOT1_US_EQ', expected: 0.5, current: 0.55 }, { ticker: 'HOT2_US_EQ', expected: 0.5, current: 0.45 }]};

// ── signals ──
const one = (w, extra) => DP.dpScoreStock(S('X', 'P', 70, w, extra), CALM);
ok('RSI 28 is oversold (best), RSI 72 is overbought (worst, no new money)', one({ rsi: 28 }).signals.rsi.score === 1 && one({ rsi: 72 }).signals.rsi.score === 0 && one({ rsi: 72 }).decision === 'HOLD' && /overbought/.test(one({ rsi: 72 }).holdReason));
ok('RSI 66 at the 52-week high counts as overbought too; RSI 66 well below the high does not', one({ rsi: 66, current: 129, high_52w: 130 }).overbought === true && one({ rsi: 66, current: 100, high_52w: 130 }).overbought === false);
ok('Entry Analysis "hold / avoid" blocks a buy', one({ action: 'HOLD / AVOID', rsi: 40 }).decision === 'HOLD');
ok('momentum: down and bouncing beats down and still falling hard', one({ mom_4w: -10, mom_1w: 2 }).signals.momentum.score > one({ mom_4w: -20, mom_1w: -3 }).signals.momentum.score);
ok('volume: heavy volume on a bounce is bullish, heavy volume on a fall is not', one({ vol_ratio: 1.6, mom_1w: 2 }).signals.volume.score === 1 && one({ vol_ratio: 1.6, mom_1w: -2 }).signals.volume.score < 0.5);
ok('PE: 14 cheap > 24 fair > 60 very expensive; no PE (ETF) means the signal is left out, not zero', one({ pe: 14 }).signals.pe.score > one({ pe: 24 }).signals.pe.score && one({ pe: 24 }).signals.pe.score > one({ pe: 60 }).signals.pe.score && one({ pe: null }).signals.pe === undefined);
ok('entry point: at/below target in the lower 52-week range scores higher than 10% above target near the high', one({ current: 90, price: 92, high_52w: 130, low_52w: 80 }).signals.entry.score > one({ current: 125, price: 110, high_52w: 130, low_52w: 80 }).signals.entry.score);
const full = DP.dpSignals(S('X', 'P', 70, {}), CALM), wsum = sum(Object.keys(full).map(k => DP.DP_WEIGHTS[k]));
ok('weights add up to 100 and all seven signals are used when the data is there', wsum === 100 && Object.keys(full).length === 7);
const noPe = one({ pe: null });
ok('missing PE: score is re-weighted over the other signals (coverage 88), still a 0-100 number', noPe.coverage === 88 && noPe.buyScore >= 0 && noPe.buyScore <= 100);
const bare = DP.dpScoreStock({ ticker: 'N', pie: 'P', score: null, w: {} }, CALM);
ok('a stock with no data at all is HOLD with "no signals available" (nothing invented)', bare.buyScore === null && bare.decision === 'HOLD' && /no signals/.test(bare.holdReason));

// ── money split ──
ok('dpSplit adds up to the penny (100 ÷ 3, 0.05 ÷ 3) and handles no weights', r2(sum(DP.dpSplit(100, [1, 1, 1]))) === 100 && r2(sum(DP.dpSplit(0.05, [1, 1, 1]))) === 0.05 && DP.dpSplit(10, []).length === 0 && sum(DP.dpSplit(10, [0, 0])) === 0);

// ── a dip (extreme fear): the full amount is deployed ──
const A = DP.dpPlanCompute({ amount: 200, stocks, pies, mood: FEAR });
const inv = A.pies.filter(p => p.verdict === 'INVEST'), hold = A.pies.filter(p => p.verdict === 'HOLD');
ok('extreme fear = strong dip: all £200 is deployed, nothing held back', A.market.level === 'strong' && A.deployable === 200 && A.holdCash === 0 && A.fraction === 1);
ok('pie amounts add up to exactly the amount to invest', r2(sum(inv.map(p => p.amount))) === 200);
ok('the all-overbought pie (Hot) is HOLD with £0 and says why; the others are INVEST', hold.length === 1 && hold[0].pie === 'Hot' && hold[0].amount === 0 && /overbought/.test(hold[0].holdReason) && inv.map(p => p.pie).sort().join() === 'Chips,Not in a pie,World');
ok('inside each pie the per-stock amounts add up to the pie amount (custom and whole-pie views)', inv.every(p => r2(sum(p.stocks.map(s => s.amountCustom))) === p.amount && (p.direct || r2(sum(p.stocks.map(s => s.amountWhole))) === p.amount)));
const chips = inv.find(p => p.pie === 'Chips'), ccc = chips.stocks.find(s => s.ticker === 'CCC'), aaa = chips.stocks.find(s => s.ticker === 'AAA');
ok('the overbought stock inside an invested pie gets £0 and the strongest stock gets the most', ccc.decision === 'HOLD' && ccc.amountCustom === 0 && aaa.amountCustom === Math.max(...chips.stocks.map(s => s.amountCustom)) && aaa.amountCustom > 0);
ok('Chips: the overbought stock is 30% of the pie, so the pie says CUSTOM balance and names what to skip', chips.mode === 'CUSTOM' && chips.skipped.join() === 'CCC' && chips.tilt >= 0.15);
const world = inv.find(p => p.pie === 'World');
ok('World (two similar ETFs on equal weights): invest in the WHOLE pie, whole-pie amounts follow its 50/50 weights', world.mode === 'WHOLE' && Math.abs(world.stocks[0].amountWhole - world.stocks[1].amountWhole) <= 0.01);
const solo = inv.find(p => p.direct);
ok('a holding outside any pie is bought directly (no whole/custom choice)', solo.mode === 'DIRECT' && solo.stocks[0].ticker === 'SOLO' && solo.stocks[0].amountCustom === solo.amount);
ok('target and current weights come from the snapshot pies', chips.stocks.find(s => s.ticker === 'AAA').target === 0.4 && chips.stocks.find(s => s.ticker === 'AAA').now === 0.38);
ok('no pie gets more than 50% of the money when three or more pies are invested', inv.length >= 3 && inv.every(p => p.amount <= 100.01));
const cap2 = DP.dpPlanCompute({ amount: 100, stocks: stocks.filter(s => s.pie !== 'World' && s.pie !== 'Hot' && s.pie !== 'Individual').concat([S('Z1', 'Tiny', 99, { rsi: 20 }), S('Z2', 'Tiny', 99, { rsi: 20 })]), pies, mood: FEAR });
ok('two pies: the cap is 65%', cap2.pies.filter(p => p.verdict === 'INVEST').length === 2 && cap2.pies.every(p => p.amount <= 65.01) && r2(sum(cap2.pies.map(p => p.amount))) === 100);

// ── no dip / moderate dip / plan anyway ──
const calmStocks = stocks.map(s => ({ ...s, w: { ...s.w, current: s.w.high_52w * 0.97 } }));
const B = DP.dpPlanCompute({ amount: 100, stocks: calmStocks, pies, mood: CALM });
ok('no market dip: nothing is deployed, all £100 stays in cash, and it says so', B.market.level === 'none' && B.deployable === 0 && B.holdCash === 100 && B.pies.every(p => p.amount === 0) && B.notes.some(n => /No market dip/.test(n)));
const Bf = DP.dpPlanCompute({ amount: 100, stocks: calmStocks, pies, mood: CALM, force: true });
ok('"plan anyway" deploys it all and labels it as not a dip signal', Bf.deployable === 100 && Bf.forced === true && Bf.notes.some(n => /Planned anyway/.test(n)) && r2(sum(Bf.pies.map(p => p.amount))) === 100);
const M = DP.dpPlanCompute({ amount: 100, stocks: calmStocks, pies, mood: { ...CALM, spx_drawdown: 5 } });
ok('S&P 5% below its high = moderate dip: half is used, half kept back', M.market.level === 'moderate' && M.deployable === 50 && M.holdCash === 50 && r2(sum(M.pies.map(p => p.amount))) === 50);
const wide = DP.dpPlanCompute({ amount: 100, stocks, pies, mood: CALM });
ok('calm VIX but 40%+ of holdings 8%+ below their highs is a moderate dip (breadth)', wide.market.level === 'moderate' && wide.market.breadth.pct >= 40);
const nomood = DP.dpPlanCompute({ amount: 100, stocks: calmStocks, pies, mood: null });
ok('no market reading yet: says so, relies on the holdings only, never claims a mood', nomood.market.fearGreed.label === 'Not available' && /no market reading/.test(nomood.market.reasons.join(' ')));
const allHot = DP.dpPlanCompute({ amount: 100, stocks: stocks.filter(s => s.pie === 'Hot'), pies, mood: FEAR });
ok('everything overbought: nothing is bought, the cash stays, with a warning', allHot.deployable === 0 && allHot.holdCash === 100 && allHot.warnings.some(w => /Nothing passes/.test(w)));

// ── input handling and honesty ──
ok('bad or empty amount is refused', DP.dpPlanCompute({ amount: '', stocks, pies, mood: FEAR }).error && DP.dpPlanCompute({ amount: -5, stocks, pies, mood: FEAR }).error && DP.dpPlanCompute({ amount: 'abc', stocks, pies, mood: FEAR }).error);
ok('no Entry Analysis rows: tells you to Refresh instead of inventing a plan', /Refresh/.test(DP.dpPlanCompute({ amount: 100, stocks: [], pies, mood: FEAR }).error));
const noW = DP.dpPlanCompute({ amount: 100, stocks: stocks.filter(s => s.pie === 'Chips'), pies: {}, mood: FEAR });
ok('pie weights not found: equal weights assumed and the card warns', noW.pies[0].weightsGuessed && noW.warnings.some(w => /equal weights/.test(w)));
const fb = DP.dpPlanCompute({ amount: 100, stocks: [S('VUSA.AS', 'World', 75, { rsi: 35, pe: null }, { t212: null }), S('VWCE.DE', 'World', 74, { rsi: 37, pe: null }, { t212: null })], pies: { World: [{ ticker: 'VUSAa_EQ', expected: 0.7, current: 0.7 }, { ticker: 'VWCEd_EQ', expected: 0.3, current: 0.3 }] }, mood: FEAR });
ok('rows without a saved Trading 212 ticker still find their pie weight (VUSA.AS ↔ VUSAa_EQ)', fb.pies[0].weightsKnown && fb.pies[0].stocks.find(s => s.ticker === 'VUSA.AS').target === 0.7);
ok('key helpers', DP.dpKey('VUSA.AS') === 'VUSA' && DP.dpKey('NVDA') === 'NVDA' && DP.dpKeyT212('VUSAa_EQ') === 'VUSA' && DP.dpKeyT212('NVDA_US_EQ') === 'NVDA' && DP.dpKeyT212('BAE_US_EQ') === 'BAE');
const same = JSON.stringify(DP.dpPlanCompute({ amount: 200, stocks, pies, mood: FEAR })) === JSON.stringify(A);
ok('same inputs, same plan (deterministic)', same);
ok('no fixed budget anywhere: a different amount scales the plan (same pies, £100 vs £200)', JSON.stringify(DP.dpPlanCompute({ amount: 100, stocks, pies, mood: FEAR }).pies.map(p => p.pie + p.verdict)) === JSON.stringify(A.pies.map(p => p.pie + p.verdict)) && DP.dpPlanCompute({ amount: 100, stocks, pies, mood: FEAR }).deployable === 100);

// ── rendering: escapes everything, shows the key facts ──
const evil = stocks.map(s => s.ticker === 'AAA' ? { ...s, display: '<img src=x onerror=alert(1)>', pie: 'Chips' } : s);
const html = DP.dpRenderPlan(DP.dpPlanCompute({ amount: 150, stocks: evil, pies, mood: FEAR }));
ok('names are HTML-escaped (no raw tag from data reaches the page)', !/<img/i.test(html) && /&lt;img/.test(html));
ok('the card shows the dip banner, invest/hold sections, amounts and signal chips', /Market dip: deploy/.test(html) && /Invest \(3\)/.test(html) && /Hold, no new money \(1\)/.test(html) && /£150/.test(html) && /RSI/.test(html) && /PE/.test(html) && /Fear &amp; Greed/.test(html));
ok('whole-pie vs custom amounts are both shown for a custom-balance pie', /whole pie £\d/.test(html) && /custom £\d/.test(html) && /Custom balance/.test(html));
ok('no inline code beyond the whitelisted handler calls (CSP)', !/on\w+="[^"]*(=>|function|eval)/.test(html) && /onclick="dipPlanToggle\('dp-pie-\d'\)"/.test(html));

console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
