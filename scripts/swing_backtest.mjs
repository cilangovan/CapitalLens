// Back-test of the Swing rules (docs/js/swing.js, the SAME functions the tab runs) on daily history for a liquid universe.
// Run: node scripts/swing_backtest.mjs [--out docs/data/swing_backtest.json] [--years 5]
// Fixed rules, no tuning. Costs per trade, next-day-open entries, stop before target. Reports all / in-sample / out-of-sample
// (the most recent 40% of dates) and a random-entry baseline. Exits non-zero (and writes nothing) if too little data came back.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const SWG = require('../docs/js/swing.js');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('--out', 'docs/data/swing_backtest.json'), YEARS = +arg('--years', 5), RANGE = YEARS > 5 ? '10y' : YEARS > 2 ? '5y' : '2y';
const U = JSON.parse(fs.readFileSync(new URL('../config/swing_universe.json', import.meta.url), 'utf8')).symbols;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUB = { GBp: 0.01, GBX: 0.01 };

async function candles(sym) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${RANGE}&interval=1d&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CapitalLens-backtest/1.0)', Accept: 'application/json' } });
      if (r.status === 429) { await sleep(2500 * (t + 1)); continue; }
      if (!r.ok) return null;
      const res = ((await r.json()).chart || {}).result; const c = res && res[0]; if (!c) return null;
      const q = c.indicators.quote[0], k = SUB[(c.meta || {}).currency] || 1;
      return (c.timestamp || []).map((ts, i) => q.close[i] == null || q.high[i] == null || q.low[i] == null || q.open[i] == null ? null : [ts, q.open[i] * k, q.high[i] * k, q.low[i] * k, q.close[i] * k, q.volume ? q.volume[i] : null]).filter(Boolean);
    } catch (e) { await sleep(1500); }
  }
  return null;
}

// Three variants declared BEFORE looking at any result (plus the original). Nothing is tuned: each is one idea, run once.
const idxC = await candles('^GSPC'); if (!idxC || idxC.length < 200) { console.error('No S&P 500 data: cannot test the market-trend variants'); process.exit(2); }
const IDX = { t: idxC.map(b => b[0]), c: idxC.map(b => b[4]) };
const VARIANTS = { original: {}, wide_stop: { stopAtr: 2.5 }, market_up: { regime: true, ctx: { idx: IDX } }, leaders: { rs: 0.05, ctx: { idx: IDX } },
  // published book strategies, each with the book's own exit and with a fixed +5% target (stop -4%), all declared before any result was seen
  connors_natural: { strat: 'connors', exit: 'natural' }, connors_5pct: { strat: 'connors', exit: 'target5' },
  ibs_natural: { strat: 'ibs', exit: 'natural' }, ibs_5pct: { strat: 'ibs', exit: 'target5' },
  grail_natural: { strat: 'grail', exit: 'natural' }, grail_5pct: { strat: 'grail', exit: 'target5' },
  minervini_natural: { strat: 'minervini', exit: 'natural' }, minervini_5pct: { strat: 'minervini', exit: 'target5' } };
const V = Object.fromEntries(Object.keys(VARIANTS).map(k => [k, []])); const base = [], times = []; let ok = 0; const failed = [];
for (const sym of U) {
  const cs = await candles(sym); await sleep(250);
  if (!cs || cs.length < 120) { failed.push(sym); continue; }
  ok++; cs.forEach(b => times.push(b[0]));
  for (const [k, cfg] of Object.entries(VARIANTS)) for (const t of SWG.swBacktestOne(cs, undefined, cfg)) V[k].push(Object.assign({ sym }, t));
  // baseline: enter at the next open on every 10th bar, same cost, hold 10 bars (no signal, no stop)
  const X = SWG.swPrep(cs);
  for (let i = SWG.SW.minBars; i + 1 + SWG.SW.holdDays <= X.c.length; i += SWG.SW.holdDays) {
    const e = X.o[i + 1], x = X.c[i + SWG.SW.holdDays]; base.push({ ret: x / e - 1 - SWG.SW.cost, t: X.t[i + 1] });
  }
}
if (ok < 40) { console.error(`Only ${ok} of ${U.length} symbols returned data: not writing a report`); process.exit(2); }
times.sort((a, b) => a - b); const cut = times[Math.floor(times.length * 0.6)];
const boos = base.filter(t => t.t >= cut), baseline = SWG.swStats(boos);
const variants = {};
for (const [k, tr] of Object.entries(V)) {
  const r = { all: SWG.swStats(tr), in_sample: SWG.swStats(tr.filter(t => t.t < cut)), out_of_sample: SWG.swStats(tr.filter(t => t.t >= cut)), baseline,
    by_setup: Object.fromEntries([...new Set(tr.map(t => t.setup))].map(n => [n, SWG.swStats(tr.filter(t => t.setup === n))])),
    exits: tr.reduce((m, t) => (m[t.why] = (m[t.why] || 0) + 1, m), {}), pct_5plus: tr.length ? SWG.swR(tr.filter(t => t.ret >= 0.045).length / tr.length * 100, 1) : 0,
    by_year: Object.fromEntries(Object.entries(tr.reduce((m, t) => ((m[new Date(t.t * 1000).getUTCFullYear()] = m[new Date(t.t * 1000).getUTCFullYear()] || []).push(t), m), {})).map(([y, v]) => [y, SWG.swStats(v)])) };
  r.validation = SWG.swValidated(r); variants[k] = r;
}
// Choose by IN-SAMPLE expectancy only (needs 100+ in-sample trades); the out-of-sample part then confirms or rejects it. 12 variants were tried.
const eligible = Object.entries(variants).filter(([, r]) => r.in_sample.trades >= 100).sort((a, b) => b[1].in_sample.expectancy - a[1].in_sample.expectancy);
const chosen = eligible.length ? eligible[0][0] : 'original', C = variants[chosen];
const rep = {
  generated: new Date().toISOString(), symbols: ok, requested: U.length, failed, years: YEARS, cost: SWG.SW.cost, cut: new Date(cut * 1000).toISOString().slice(0, 10),
  variants_tried: Object.keys(variants).length, chosen, config: Object.fromEntries(Object.entries(VARIANTS[chosen]).filter(([k]) => k !== 'ctx')),
  all: C.all, in_sample: C.in_sample, out_of_sample: C.out_of_sample, baseline, by_setup: C.by_setup, variants,
  caveat: 'Today\u2019s surviving stocks only (survivorship bias), the quality screen and earnings dates are not in the test, and fills at the stop are assumed with no extra slippage on gaps beyond the open price. Twelve rule sets were tried and the one with the best in-sample result was kept, so the out-of-sample figure is the one to trust.'
};
rep.validation = SWG.swValidated(rep);
fs.mkdirSync(OUT.replace(/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
console.log(JSON.stringify({ symbols: ok, chosen, baseline, summary: Object.fromEntries(Object.entries(variants).map(([k, r]) => [k, { all: [r.all.trades, r.all.expectancy, r.all.profitFactor], in: [r.in_sample.trades, r.in_sample.expectancy, r.in_sample.profitFactor], oos: [r.out_of_sample.trades, r.out_of_sample.expectancy, r.out_of_sample.profitFactor], ok: r.validation.ok, p5: r.pct_5plus }])), validation: rep.validation }, null, 1));
