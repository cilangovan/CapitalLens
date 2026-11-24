// Run: node tests/zk_paper_test.mjs
// Paper trading (docs/js/paper.js): fake-money forward test. Weekly deposits, next-open fills, fees, stop / 50-day / time exits, honest cancels, no look-ahead, idempotent re-runs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SWG = require('../docs/js/swing.js'), PA = require('../docs/js/paper.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const DAY = 86400, MON = Date.UTC(2026, 0, 5);                                // Monday 5 Jan 2026 (ms)
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// candles: bar i is at day (t0 + i). closes -> [t,o,h,l,c,v]
function bars(closes, t0, o = {}) { return closes.map((x, i) => { const op = o.opens ? o.opens[i] : (i ? closes[i - 1] : x), rg = (o.range || 0.012) * x; return [t0 + i * DAY, op, Math.max(op, x) + rg / 2, Math.min(op, x) - rg / 2, x, o.vols ? o.vols[i] : 2e6]; }); }
function breakoutCloses() { const c = []; let p = 50; for (let i = 0; i < 300; i++) { p *= 1.003; c.push(p); } for (let i = 0; i < 20; i++) c.push(p * (1 + 0.002 * (i % 2 ? 1 : -1))); c.push(p * 1.04); return c; }
const BC = breakoutCloses(), N = BC.length;                                     // signal bar = index N-1
const T0 = Math.floor(MON / 1000) - (N - 1) * DAY + 3 * DAY;                      // so the signal bar lands on Thursday 8 Jan 2026
const sigVols = BC.map((x, i) => i === N - 1 ? 4e6 : 2e6);
const stockBars = (extraCloses = [], extraOpts = {}) => { const cl = BC.concat(extraCloses), v = sigVols.concat(extraCloses.map(() => 2e6)); const opens = cl.map((x, i) => i === 0 ? x : (i >= N && extraOpts.opens && extraOpts.opens[i - N] !== undefined ? extraOpts.opens[i - N] : cl[i - 1])); return bars(cl, T0, { vols: v, opens }); };
const etfBars = (n, t0, px0 = 100, step = 0.5) => bars(Array.from({ length: n }, (_, i) => px0 + i * step), t0, { range: 0.004 });
const prep = c => SWG.swPrep(c);
const NOW = (T0 + (N - 1) * DAY + 10 * 3600) * 1000;                              // morning of the signal day, after the bar is complete in the data
const mkData = (stock, etf, extra = {}) => ({ etf: etf ? { X: prep(etf), live: extra.etfLive || null, sessionOpen: false } : null, stocks: stock ? [{ sym: 'AAA', name: 'Alpha Co', X: prep(stock), live: extra.live || null, sessionOpen: !!extra.sessionOpen }] : [] });
const etfFull = etfBars(N + 40, T0 - 40 * DAY);
const fresh = (w = 30, start = NOW) => PA.paperInit(w, start);

// ── init and deposits ──
let threw = false; try { PA.paperInit(0, NOW); } catch (e) { threw = true; } ok('a weekly amount below £1 is refused (no default amount exists in the code)', threw);
let r = PA.paperStep(fresh(30), mkData(stockBars(), etfFull), NOW);
ok('first week: both accounts get the same deposit', r.state.dep === 30 && near(r.state.trend.cash, 30) && r.state.weeks.length === 1);
ok('the first week buys the ETF at the price when the account starts, minus the 0.2% fee', near(r.state.etf.units, 30 * 0.998 / etfFull[etfFull.length - 1][4]));
const old = PA.paperStep(fresh(30, NOW - 21 * DAY * 1000), mkData(stockBars(), etfFull), NOW);
ok('missed weeks are credited (account started 3 weeks ago = 4 deposits)', old.state.weeks.length === 4 && old.state.dep === 120);
ok('a missed week is bought at THAT week\'s open, not today\'s price', old.state.etf.buys.filter(b => !b.est).length >= 3 && old.state.etf.buys.some(b => b.price !== etfFull[etfFull.length - 1][4]));
const noEtf = PA.paperStep(fresh(30), mkData(stockBars(), null), NOW);
ok('no ETF prices = no deposit at all (neither account is credited alone)', noEtf.state.dep === 0 && noEtf.state.trend.cash === 0 && noEtf.events.some(e => e.type === 'wait'));
const again = PA.paperStep(r.state, mkData(stockBars(), etfFull), NOW + 3600 * 1000);
ok('re-running with the same data credits no second deposit and changes no holdings', again.state.dep === 30 && near(again.state.etf.units, r.state.etf.units) && again.state.trend.pos.length === r.state.trend.pos.length);

// ── signal -> pending -> next-open fill ──
ok('a trend-template breakout on the last completed bar queues an order but does NOT buy on that bar', r.state.trend.pending.length === 1 && r.state.trend.pos.length === 0 && near(r.state.trend.cash, 30));
const nextOpen = BC[N - 1] * 1.01, withNext = stockBars([BC[N - 1] * 1.02], { opens: [nextOpen] });
r = PA.paperStep(r.state, mkData(withNext, etfFull), NOW + 86400000);
ok('the order fills at the NEXT session\'s open, with the 0.2% fee', r.state.trend.pos.length === 1 && near(r.state.trend.pos[0].entry, nextOpen) && near(r.state.trend.pos[0].qty, 30 * 0.998 / nextOpen) && near(r.state.trend.cash, 0));
ok('a second run does not buy again (no duplicate position or order)', PA.paperStep(r.state, mkData(withNext, etfFull), NOW + 2 * 86400000).state.trend.pos.length === 1);
const ran = PA.paperStep(PA.paperStep(fresh(30), mkData(stockBars(), etfFull), NOW).state, mkData(stockBars([BC[N - 1] * 1.2], { opens: [BC[N - 1] * 1.15] }), etfFull), NOW + 86400000);
ok('if it opens far above the entry ceiling the order is cancelled (price ran away), not chased', ran.state.trend.pos.length === 0 && ran.state.trend.pending.length === 0 && ran.events.some(e => e.type === 'cancel' && /ran away/.test(e.text)));
const thru = PA.paperStep(PA.paperStep(fresh(30), mkData(stockBars(), etfFull), NOW).state, mkData(stockBars([BC[N - 1] * 0.7], { opens: [BC[N - 1] * 0.7] }), etfFull), NOW + 86400000);
ok('if it opens through the stop the order is cancelled', thru.state.trend.pos.length === 0 && thru.events.some(e => e.type === 'cancel'));
const partial = PA.paperStep(fresh(30), mkData(stockBars([BC[N - 1] * 1.02], { opens: [nextOpen] }), etfFull, { sessionOpen: true }), NOW);
ok('while today\'s bar is still forming the signal is read from the last COMPLETED bar', partial.state.trend.pending.length === 1 && partial.state.trend.pending[0].signalT === T0 + (N - 1) * DAY);
const broke = fresh(30); broke.weekly = 30; const noCash = PA.paperStep(Object.assign(fresh(30), { weeks: [PA.ppWeekKey(NOW)], dep: 30 }), mkData(stockBars(), etfFull), NOW);
ok('no fake cash = no order', noCash.state.trend.pending.length === 0);

// ── exits ──
const held = r.state, pos = held.trend.pos[0], e0 = pos.entry;
const up = i => BC[N - 1] * (1.02 + i * 0.004);
const calm = Array.from({ length: 6 }, (_, i) => up(i));
let x = PA.paperStep(held, mkData(stockBars([BC[N - 1] * 1.02].concat(calm), { opens: [nextOpen] }), etfFull), NOW + 3 * 86400000);
ok('a quiet uptrend keeps the position open', x.state.trend.pos.length === 1 && x.state.trend.closed.length === 0);
const crash = [BC[N - 1] * 1.02, e0 * 0.8]; const sbars = stockBars(crash, { opens: [nextOpen, e0 * 0.97] });
x = PA.paperStep(held, mkData(sbars, etfFull), NOW + 3 * 86400000);
ok('a 15% fall exits at the stop price', x.state.trend.pos.length === 0 && x.state.trend.closed.length === 1 && /stop/.test(x.state.trend.closed[0].why) && near(x.state.trend.closed[0].exit, e0 * 0.85, 1e-6));
ok('a stop-out pays the fee and shows a loss, and cash comes back', x.state.trend.closed[0].pnl < 0 && near(x.state.trend.cash, pos.qty * e0 * 0.85 * 0.998, 1e-6));
// close under the 50-day: long slide that stays above the 15% stop, then exit at the NEXT open
const slide = []; { let p = BC[N - 1] * 1.02; for (let i = 0; i < 60; i++) { p *= 0.9985; slide.push(p); } }
const slideBars = stockBars(slide, { opens: [nextOpen] });
const sx = PA.paperStep(held, mkData(slideBars, etfFull), NOW + 70 * 86400000);
ok('a close under the 50-day average sells at the next open (not at that close)', sx.state.trend.closed.length === 1 && /50-day/.test(sx.state.trend.closed[0].why) && sx.state.trend.closed[0].exitT > 0);
const sxc = sx.state.trend.closed[0], sb = SWG.swPrep(slideBars), ji = sb.t.indexOf(sxc.exitT);
ok('...and the sale price is that day\'s OPEN', near(sxc.exit, sb.o[ji], 1e-9));
const lim = []; { let p = BC[N - 1] * 1.02; for (let i = 0; i < 130; i++) { p *= 1.0012; lim.push(p); } }
const lx = PA.paperStep(held, mkData(stockBars(lim, { opens: [nextOpen] }), etfFull), NOW + 140 * 86400000);
ok('a position that is still fine after 120 days is sold at the time limit', lx.state.trend.closed.length === 1 && /120-day/.test(lx.state.trend.closed[0].why));
const idem = PA.paperStep(x.state, mkData(sbars, etfFull), NOW + 3 * 86400000 + 3600 * 1000);
ok('re-running after an exit does not sell twice', idem.state.trend.closed.length === 1 && near(idem.state.trend.cash, x.state.trend.cash));

// ── limits and valuation ──
const crowd = Object.assign(fresh(30), { weeks: [PA.ppWeekKey(NOW)], dep: 150, trend: { cash: 150, pos: Array.from({ length: 5 }, (_, i) => ({ sym: 'Z' + i, name: 'Z' + i, entry: 10, qty: 3, entryT: 1, checkedT: 1, exitPending: null })), pending: [], closed: [] } });
ok('never more than 5 positions open or queued', PA.paperStep(crowd, mkData(stockBars(), etfFull), NOW).state.trend.pending.length === 0);
ok('the equity point equals cash + positions at the latest price and keeps one point per day', (() => { const e = held.equity; const h2 = PA.paperStep(held, mkData(withNext, etfFull), NOW + 86400000); const last = h2.state.equity[h2.state.equity.length - 1]; return near(last.trend, h2.state.trend.cash + pos.qty * withNext[withNext.length - 1][4], 1e-6) && h2.state.equity.filter(q => q.d === last.d).length === 1; })());
ok('the whole account survives JSON (it is stored in the settings row)', JSON.stringify(JSON.parse(JSON.stringify(held))) === JSON.stringify(held));
ok('ETF account value = units x latest price', (() => { const last = held.equity[held.equity.length - 1]; return near(last.etf, held.etf.units * etfFull[etfFull.length - 1][4], 1e-6); })());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
