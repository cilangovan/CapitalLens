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

const all = [], base = [], times = []; let ok = 0; const failed = [];
for (const sym of U) {
  const cs = await candles(sym); await sleep(250);
  if (!cs || cs.length < 120) { failed.push(sym); continue; }
  ok++; cs.forEach(b => times.push(b[0]));
  for (const t of SWG.swBacktestOne(cs)) all.push(Object.assign({ sym }, t));
  // baseline: enter at the next open on every 10th bar, same cost, hold 10 bars (no signal, no stop)
  const X = SWG.swPrep(cs);
  for (let i = SWG.SW.minBars; i + 1 + SWG.SW.holdDays <= X.c.length; i += SWG.SW.holdDays) {
    const e = X.o[i + 1], x = X.c[i + SWG.SW.holdDays]; base.push({ ret: x / e - 1 - SWG.SW.cost, t: X.t[i + 1] });
  }
}
if (ok < 40) { console.error(`Only ${ok} of ${U.length} symbols returned data: not writing a report`); process.exit(2); }
times.sort((a, b) => a - b); const cut = times[Math.floor(times.length * 0.6)];
const ins = all.filter(t => t.t < cut), oos = all.filter(t => t.t >= cut), boos = base.filter(t => t.t >= cut);
const by = f => { const m = {}; all.forEach(t => (m[f(t)] = m[f(t)] || []).push(t)); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, SWG.swStats(v)])); };
const rep = {
  generated: new Date().toISOString(), symbols: ok, requested: U.length, failed, years: YEARS, cost: SWG.SW.cost, cut: new Date(cut * 1000).toISOString().slice(0, 10),
  all: SWG.swStats(all), in_sample: SWG.swStats(ins), out_of_sample: SWG.swStats(oos), baseline: SWG.swStats(boos),
  by_setup: by(t => t.setup), by_exit: by(t => t.why), by_year: by(t => new Date(t.t * 1000).getUTCFullYear()),
  caveat: 'Today’s surviving stocks only (survivorship bias), the quality screen and earnings dates are not in the test, and fills at the stop are assumed with no extra slippage on gaps beyond the open price.'
};
rep.validation = SWG.swValidated(rep);
fs.mkdirSync(OUT.replace(/[^/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
console.log(JSON.stringify({ symbols: ok, all: rep.all, in_sample: rep.in_sample, out_of_sample: rep.out_of_sample, baseline: rep.baseline, by_setup: rep.by_setup, validation: rep.validation }, null, 1));
