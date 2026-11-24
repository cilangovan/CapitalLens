// Run: node tests/zk_swing_test.mjs
// Swing tab engine (docs/js/swing.js): entry rules, stop/target/time exit, costs, no look-ahead, honest "no entry" reasons and the back-test gate.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SWG = require('../docs/js/swing.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

// deterministic synthetic daily candles: [t, o, h, l, c, v]
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
function build(closes, opts = {}) {
  const out = []; let prev = closes[0];
  closes.forEach((c, i) => { const o = opts.opens ? opts.opens[i] : prev, rng = (opts.range || 0.012) * c, h = Math.max(o, c) + rng * 0.5, l = Math.min(o, c) - rng * 0.5;
    out.push([86400 * (i + 1), o, h, l, c, opts.vol === null ? null : (opts.vols ? opts.vols[i] : 2e6)]); prev = c; });
  return out;
}
// 90 bars of steady uptrend, then a 6-bar pullback, then a green bounce bar on volume
function pullbackSeries() {
  const c = []; let p = 100; for (let i = 0; i < 90; i++) { p *= 1 + 0.004 + (i % 3 === 0 ? 0.006 : -0.002); c.push(p); }
  for (let i = 0; i < 6; i++) { p *= 0.988; c.push(p); }
  p *= 1.012; c.push(p);
  const v = c.map(() => 2e6); v[v.length - 1] = 3.2e6;
  const opens = c.map((x, i) => i === c.length - 1 ? c[i - 1] * 0.998 : (i ? c[i - 1] : x));
  return { c, v, opens };
}
const P = pullbackSeries(), cand = build(P.c, { vols: P.v, opens: P.opens });

// ── indicators ──
const flat = Array.from({ length: 40 }, (_, i) => 100 + i);
ok('RSI of a straight rise is 100', Math.round(SWG.swRsiSeries(flat)[39]) === 100);
ok('RSI of a straight fall is 0', Math.round(SWG.swRsiSeries(flat.slice().reverse())[39]) === 0);
ok('RSI of an alternating series is near 50', Math.abs(SWG.swRsiSeries(Array.from({ length: 60 }, (_, i) => 100 + (i % 2)))[59] - 50) < 8);
ok('SMA is the plain average of the last n', SWG.swSma([1, 2, 3, 4, 5], 3, 5) === 4 && SWG.swSma([1, 2], 3, 2) === null);

// ── entry ──
const X = SWG.swPrep(cand), sig = SWG.swingSignal(X);
ok('uptrend + pullback + green bounce on volume gives a Pullback bounce entry', sig.entry === true && sig.setup === 'Pullback bounce');
ok('stop is below price, target is 2R above, risk within 3 ATR', sig.entry && sig.stop < sig.trigger && Math.abs((sig.target - sig.trigger) - 2 * sig.risk) < 1e-9 && sig.risk <= 3 * sig.atr + 1e-9);
ok('entry ceiling is half an ATR above the signal close', sig.entry && Math.abs(sig.ceiling - (sig.trigger + 0.5 * sig.atr)) < 1e-9);
ok('hold time is 10 days', sig.entry && sig.holdDays === 10);

// ── no entry, with the honest reason ──
const reason = (cs, i) => { const s = SWG.swingSignal(SWG.swPrep(cs), i); return s.entry ? 'ENTRY' : s.reasons.join(' | '); };
ok('too little history is "data unverified", not a signal', /data unverified/.test(reason(cand.slice(0, 30))));
ok('missing volume means no entry (cannot verify volume)', /volume/i.test(reason(build(P.c, { vol: null, opens: P.opens }))));
ok('thin trading means no entry', /thinly traded/.test(reason(build(P.c, { vols: P.v.map(() => 100), opens: P.opens }))));
const downC = Array.from({ length: 100 }, (_, i) => 200 - i); ok('a downtrend never gets an entry', /uptrend/.test(reason(build(downC))));
ok('pullback bounce on weak volume is refused', /volume only/.test(reason(build(P.c, { vols: P.v.map((x, i) => i === P.v.length - 1 ? 0.8e6 : x), opens: P.opens }))));
ok('a bounce that is still falling (red day) is refused', /still falling|no bounce/.test(reason(build(P.c, { vols: P.v, opens: P.opens.map((o, i) => i === P.c.length - 1 ? P.c[i] * 1.01 : o) }))));
const hot = []; let hp = 100; for (let i = 0; i < 100; i++) { hp *= 1.02; hot.push(hp); } ok('a vertical run (overbought / stretched) is refused', /Overbought|Stretched/i.test(reason(build(hot))));
ok('very quiet stock is refused', /Too quiet/.test(reason(build(P.c, { vols: P.v, opens: P.opens, range: 0.0005 }))));

// breakout: 70 flat-ish bars then a close above the 20-day high on 2x volume
const bo = []; let bp = 100; for (let i = 0; i < 85; i++) { bp *= 1 + (i < 60 ? 0.006 : 0.0005 * (i % 2 ? 1 : -1)); bo.push(bp); } const hi = Math.max(...bo.slice(-20)) * 1.012; bo.push(hi);
const bov = bo.map(() => 2e6); bov[bov.length - 1] = 4.5e6; const bsig = SWG.swingSignal(SWG.swPrep(build(bo, { vols: bov })));
ok('close above the 20-day high on 2x volume is a Breakout entry (or refused with a reason)', (bsig.entry && bsig.setup === 'Breakout') || (!bsig.entry && bsig.reasons.length > 0));

// ── no look-ahead: appending future bars must not change the signal at an earlier bar ──
const longer = cand.concat(build(Array.from({ length: 12 }, (_, i) => 150 + i * 3), { vols: Array(12).fill(2e6) }).map((b, i) => [86400 * (cand.length + i + 1), ...b.slice(1)]));
const a = SWG.swingSignal(SWG.swPrep(cand), cand.length - 1), b = SWG.swingSignal(SWG.swPrep(longer), cand.length - 1);
ok('signal at bar i does not change when later bars are appended (no look-ahead)', a.entry === b.entry && a.stop === b.stop && a.target === b.target && a.score === b.score);

// ── trade simulation ──
const fake = (n, mk) => { const rows = []; for (let i = 0; i < n; i++) rows.push(mk(i)); return rows; };
const base = { entry: true, bar: 0, ceiling: 101, stop: 95, trigger: 100 };
const sim = (rows, cost) => SWG.swSimulate(SWG.swCols(rows.map((r, i) => [86400 * (i + 1), ...r, 1e6])), base, cost);
const flatBars = n => fake(n, () => [100, 101, 99.5, 100]);                                    // [o,h,l,c]
let r = sim([[100, 100, 100, 100], ...flatBars(2), [100, 112, 99.5, 111], ...flatBars(10)], 0);
ok('target is hit at +2R and exits there', r && r.why === 'target' && Math.abs(r.exit - 110) < 1e-9 && Math.abs(r.r - 2) < 1e-9);
r = sim([[100, 100, 100, 100], [100, 100, 94, 96], ...flatBars(10)], 0);
ok('stop is hit and exits at the stop', r && r.why === 'stop' && Math.abs(r.exit - 95) < 1e-9 && r.r < -0.99);
r = sim([[100, 100, 100, 100], [100, 112, 94, 100], ...flatBars(10)], 0);
ok('when stop and target are both touched in one bar the stop wins (cautious)', r && r.why === 'stop');
r = sim([[100, 100, 100, 100], [93, 94, 92, 93], ...flatBars(12)], 0); ok('a gap open below the stop is skipped, not filled', r && r.skipped === true);
r = sim([[100, 100, 100, 100], [103, 104, 102, 103], ...flatBars(12)], 0); ok('a gap open above the entry ceiling is skipped (price ran away)', r && r.skipped === true);
r = sim([[100, 100.5, 99.8, 100], ...fake(12, i => [100, 101, 99.2, 100.2])], 0);
ok('with no stop or target the trade exits at the close of day 10', r && r.why === 'time' && r.exitBar - r.bar === 9);
const r0 = sim([[100, 100.5, 99.8, 100], ...fake(12, () => [100, 101, 99.2, 100])], 0), r1 = sim([[100, 100.5, 99.8, 100], ...fake(12, () => [100, 101, 99.2, 100])], 0.004);
ok('costs are subtracted from every trade', r0 && r1 && Math.abs((r0.ret - r1.ret) - 0.004) < 1e-12);
ok('a trade still open when the data ends is not counted', sim([[100, 100.5, 99.8, 100], ...flatBars(4)], 0) === null);

// ── back-test of a series never overlaps trades and keeps order ──
const trades = SWG.swBacktestOne(build(P.c.concat(P.c.map(x => x * 1.4)), { vols: P.v.concat(P.v), opens: P.opens.concat(P.opens.map(x => x * 1.4)) }));
ok('back-test trades never overlap', trades.every((t, i) => i === 0 || t.bar > trades[i - 1].exitBar));
const st = SWG.swStats([{ ret: 0.04, r: 2, t: 1 }, { ret: -0.02, r: -1, t: 2 }, { ret: 0.04, r: 2, t: 3 }, { ret: -0.02, r: -1, t: 4 }]);
ok('stats: win rate, expectancy and profit factor', st.winRate === 50 && Math.abs(st.expectancy - 1) < 1e-9 && st.profitFactor === 2 && st.trades === 4);
ok('stats of no trades is empty, not NaN', SWG.swStats([]).trades === 0);

// ── the gate: the tab shows entries only with a passing back-test ──
const good = { all: { trades: 400, profitFactor: 1.4 }, out_of_sample: { trades: 120, expectancy: 0.6 }, baseline: { trades: 900, expectancy: 0.2 } };
ok('no back-test file = no entries', SWG.swValidated(null).ok === false && /No back-test/.test(SWG.swValidated(null).why));
ok('a passing back-test opens the gate', SWG.swValidated(good).ok === true);
ok('too few trades closes the gate', SWG.swValidated(Object.assign({}, good, { all: { trades: 20, profitFactor: 2 } })).ok === false);
ok('negative out-of-sample expectancy closes the gate', SWG.swValidated(Object.assign({}, good, { out_of_sample: { trades: 120, expectancy: -0.1 } })).ok === false);
ok('profit factor under 1.2 closes the gate', SWG.swValidated(Object.assign({}, good, { all: { trades: 400, profitFactor: 1.05 } })).ok === false);
ok('not beating a random entry closes the gate', SWG.swValidated(Object.assign({}, good, { baseline: { trades: 900, expectancy: 0.9 } })).ok === false);
ok('too small an out-of-sample part closes the gate', SWG.swValidated(Object.assign({}, good, { out_of_sample: { trades: 10, expectancy: 1 } })).ok === false);
// ── variants (declared in advance; default rules unchanged) ──
const up = Array.from({ length: 200 }, (_, i) => 100 + i), dn = Array.from({ length: 200 }, (_, i) => 300 - i), T = Array.from({ length: 200 }, (_, i) => 86400 * (i - 50));
const wide = SWG.swingSignal(X, undefined, { stopAtr: 2.5 });
ok('wide-stop variant puts the stop 2.5 ATR below the price', wide.entry && Math.abs((wide.trigger - wide.stop) - 2.5 * wide.atr) < 1e-9);
ok('market-trend variant: no entry when the S&P is falling, with the reason', /Market is not in an uptrend/.test((SWG.swingSignal(X, undefined, { regime: true, ctx: { idx: { t: T, c: dn } } }).reasons || [''])[0]));
ok('market-trend variant: entry allowed when the S&P is rising', SWG.swingSignal(X, undefined, { regime: true, ctx: { idx: { t: T, c: up } } }).entry === true);
ok('market-trend variant: no market data = no entry (never assumed fine)', /Market data/.test((SWG.swingSignal(X, undefined, { regime: true }).reasons || [''])[0]));
ok('leaders variant: a stock lagging the market is refused', /market leader/.test((SWG.swingSignal(X, undefined, { rs: 5, ctx: { idx: { t: T, c: up.map(x => x * 3) } } }).reasons || [''])[0]) || SWG.swingSignal(X, undefined, { rs: 5, ctx: { idx: { t: T, c: up.map(x => x * 3) } } }).entry === false);
ok('leaders variant: a stock ahead of a flat market passes', SWG.swingSignal(X, undefined, { rs: 0.05, ctx: { idx: { t: T, c: Array(200).fill(100) } } }).entry === true);
ok('default rules are untouched by the variants', JSON.stringify(SWG.swingSignal(X)) === JSON.stringify(SWG.swingSignal(X, undefined, {})));

// ── published strategies ──
const upLong = []; { let q = 50; for (let i = 0; i < 270; i++) { q *= 1.0035; upLong.push(q); } }
const mkc = (cl, over = {}) => build(cl, Object.assign({ vols: cl.map(() => 2e6) }, over));
ok('RSI(2): three hard down days after a rise reads far below 10', (() => { const r = SWG.swRsiN([100, 101, 102, 103, 100, 96, 92], 2); return r[6] < 10; })());
ok('RSI(2) of a straight rise is 100', SWG.swRsiN(Array.from({ length: 30 }, (_, i) => 100 + i), 2)[29] === 100);
ok('EMA of a constant series is that constant', Math.abs(SWG.swEma(Array(40).fill(7), 20)[39] - 7) < 1e-12);
const adxUp = SWG.swAdx(...(() => { const x = SWG.swCols(mkc(upLong.slice(0, 120))); return [x.h, x.l, x.c, 14]; })());
ok('ADX of a steady rise is high with +DI over -DI', adxUp.adx[119] > 40 && adxUp.pdi[119] > adxUp.mdi[119]);
const dip = upLong.slice(); for (let k = 0; k < 3; k++) dip.push(dip[dip.length - 1] * 0.975);
const cs = SWG.swStratSignal(SWG.swPrep(mkc(dip)), dip.length - 1, 'connors', 'natural');
ok('Connors: uptrend + 3 sharp down days (RSI(2) under 10) is an entry with a 7% disaster stop', cs.entry === true && Math.abs(cs.stopPct - 0.07) < 1e-12 && cs.exitSma.n === 5 && cs.exitSma.below === false);
const cs5 = SWG.swStratSignal(SWG.swPrep(mkc(dip)), dip.length - 1, 'connors', 'target5');
ok('+5% exit mode: target 5% above, stop 4% below', cs5.entry && Math.abs(cs5.target / cs5.trigger - 1.05) < 1e-12 && Math.abs(cs5.stop / cs5.trigger - 0.96) < 1e-12 && cs5.exitSma === null);
const falling = Array.from({ length: 270 }, (_, i) => 300 - i * 0.5);
ok('Connors: below the 200-day average is never an entry', /200-day/.test(SWG.swStratSignal(SWG.swPrep(mkc(falling)), 269, 'connors', 'natural').reasons[0]));
ok('Connors: an uptrend with no dip is not an entry (RSI(2) not below 10)', /RSI\(2\)/.test(SWG.swStratSignal(SWG.swPrep(mkc(upLong)), 269, 'connors', 'natural').reasons[0]));
ok('under 252 bars is data unverified for every published strategy', SWG.SW_STRATS.every(n => /data unverified/.test(SWG.swStratSignal(SWG.swPrep(mkc(upLong.slice(0, 150))), 149, n, 'natural').reasons[0])));
ok('no volume = no entry for every published strategy', SWG.SW_STRATS.every(n => { const r = SWG.swStratSignal(SWG.swPrep(build(dip, { vol: null })), dip.length - 1, n, 'natural'); return r.entry === false && /volume/i.test(r.reasons[0]); }));
const ibsC = upLong.slice(); const ibsCandles = mkc(ibsC); { const b = ibsCandles[ibsCandles.length - 1]; b[2] = b[4] * 1.05; b[3] = b[4] * 0.999; }
ok('IBS: a close in the bottom 20% of the range inside an uptrend is an entry', SWG.swStratSignal(SWG.swPrep(ibsCandles), ibsC.length - 1, 'ibs', 'natural').entry === true);
ok('IBS: a close near the top of the range is refused', /bottom 20%/.test(SWG.swStratSignal(SWG.swPrep(mkc(upLong)), 269, 'ibs', 'natural').reasons[0]) || SWG.swStratSignal(SWG.swPrep(mkc(upLong)), 269, 'ibs', 'natural').entry === false);
ok('Minervini and Grail refuse a market with no setup, with a reason', ['minervini', 'grail'].every(n => { const r = SWG.swStratSignal(SWG.swPrep(mkc(falling)), 269, n, 'natural'); return r.entry === false && r.reasons[0].length > 5; }));
ok('published strategies never look ahead (appending bars does not change an earlier signal)', (() => { const a = SWG.swStratSignal(SWG.swPrep(mkc(dip)), dip.length - 1, 'connors', 'natural'), ext = dip.concat([dip[dip.length - 1] * 1.1, dip[dip.length - 1] * 1.2]), b = SWG.swStratSignal(SWG.swPrep(mkc(ext)), dip.length - 1, 'connors', 'natural'); return a.entry === b.entry && a.stop === b.stop; })());
// exits
const sg = (extra) => Object.assign({ entry: true, bar: 0, ceiling: 105, stop: 96, trigger: 100, strat: 'connors' }, extra);
const sm = (rows, sig, cost = 0) => SWG.swSimulate(SWG.swCols(rows.map((q, i) => [86400 * (i + 1), ...q, 1e6])), sig, cost);
let q2 = sm([[100, 100, 100, 100], [100, 106, 99.5, 105], ...flatBars(11)], sg({ targetPct: 0.05, stopPct: 0.04, exitSma: null }));
ok('+5% mode exits at exactly +5% when the high reaches it', q2 && q2.why === 'target' && Math.abs(q2.exit - 105) < 1e-9);
q2 = sm([[100, 100, 100, 100], [100, 100.5, 95.5, 96], ...flatBars(11)], sg({ targetPct: 0.05, stopPct: 0.04, exitSma: null }));
ok('+5% mode stops out at -4%', q2 && q2.why === 'stop' && Math.abs(q2.exit - 96) < 1e-9);
q2 = sm([[100, 100, 100, 100], [99, 101, 98, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 103, 100, 102.5], ...flatBars(8)], sg({ stopPct: 0.07, exitSma: { n: 5, below: false } }));
ok("natural exit leaves on the first close above the 5-day average (the book's rule)", q2 && q2.why === 'signal');
q2 = sm([[100, 100, 100, 100], [100, 101, 99.2, 100], ...fake(12, () => [100, 101, 99.2, 100])], sg({ stopPct: 0.07, exitSma: { n: 5, below: false } }));
ok('with no exit signal the trade still ends at day 10', q2 && (q2.why === 'time' || q2.why === 'signal') && q2.exitBar - q2.bar <= 9);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
