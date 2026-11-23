// Run: node tests/zk_signals_test.mjs
// Market signals: 100/200-day average crosses and 52-week highs from daily closes; Live / Pre / Post views per exchange clock; honest with short or missing history.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), S = require('../docs/js/signals.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const DAY = 86400, T0 = Date.parse('2026-01-05T14:30:00Z') / 1000;
const mk = (closes, start = T0) => closes.map((c, i) => [start + i * DAY, c]);             // consecutive days (weekends ignored: fine for the engine)
const flat = (n, v) => Array(n).fill(v);
const lastDay = (pts) => new Date(pts[pts.length - 1][0] * 1000).toISOString().slice(0, 10);
const nowAt = (pts, hh = 23) => Date.parse(lastDay(pts) + `T${hh}:00:00Z`);               // evening of the last bar's day: market closed, last bar complete

// 250 flat closes at 100, then the last close jumps above both averages
let pts = mk([...flat(250, 100), 101]), a = S.analyse(pts, { currency: 'USD' }, nowAt(pts));
ok('close back above both averages → 100 SMA and 200 SMA "up" cross, level = the average', a.post.filter(e => e.kind === 'sma100' && e.dir === 'up').length === 1 && a.post.filter(e => e.kind === 'sma200' && e.dir === 'up').length === 1 && a.post.find(e => e.kind === 'sma100').level === 100.01);
ok('and a new 52-week high (above every close of the year); level = the close', a.post.some(e => e.kind === 'high52' && e.level === 101));
ok('market closed after today\'s session: Post = today, Live empty, Pre = what was true at the open (yesterday: nothing)', a.doneToday === true && a.live.length === 0 && a.pre.length === 0 && a.open === false);
pts = mk([...flat(250, 100), 99]); a = S.analyse(pts, {}, nowAt(pts));
ok('close under both averages → "down" crosses, no 52-week high', a.post.map(e => e.kind + e.dir).sort().join() === 'sma100down,sma200down');
pts = mk([...flat(250, 100), 101, 102]); a = S.analyse(pts, {}, nowAt(pts));
ok('a cross that already happened yesterday shows under Pre Market only, not again under Post', a.pre.some(e => e.kind === 'sma100') && !a.post.some(e => e.kind === 'sma100') && a.post.some(e => e.kind === 'high52'));
ok('no signal when it stays on the same side (touching is not crossing twice)', S.analyse(mk([...flat(250, 100), 101, 101.5, 102]), {}, nowAt(mk([...flat(253, 1)]))).post.every(e => e.kind === 'high52'));
// not enough history: never guess
pts = mk([...flat(150, 100), 101]); a = S.analyse(pts, {}, nowAt(pts));
ok('150 sessions: 100-day cross works, 200-day cross and 52-week high need more history and say nothing', a.post.some(e => e.kind === 'sma100') && !a.post.some(e => e.kind === 'sma200') && !a.post.some(e => e.kind === 'high52'));
pts = mk([...flat(60, 100), 101]); a = S.analyse(pts, {}, nowAt(pts));
ok('60 sessions: no averages at all', a.post.length === 0 && a.bars === 61);
// session clock
const ses = (pts, start, end) => ({ session: { start: pts[pts.length - 1][0] + start, end: pts[pts.length - 1][0] + end }, gmtoffset: 0 });
pts = mk([...flat(250, 100), 101]); const lastT = pts[pts.length - 1][0];
a = S.analyse(pts, ses(pts, -60, 8 * 3600), (lastT + 3600) * 1000);
ok('market OPEN: the last bar is today\'s live price → Live has the cross, Pre = yesterday\'s close (nothing), Post empty (not closed yet)', a.open === true && a.live.some(e => e.kind === 'sma100') && a.pre.length === 0 && a.post.length === 0 && a.doneToday === false);
a = S.analyse(pts, ses(pts, -60, 8 * 3600), (lastT + 9 * 3600) * 1000);
ok('same bar after the close: Live empty, Post has it', a.open === false && a.live.length === 0 && a.post.some(e => e.kind === 'sma100'));
const prev = mk([...flat(250, 100), 101]), tomorrow = (prev[prev.length - 1][0] + DAY + 3600) * 1000;
a = S.analyse(prev, ses(prev, DAY - 60, DAY + 8 * 3600), tomorrow - 7200 * 1000);
ok('next morning before the open: yesterday\'s close is "ready before the open" = Pre Market; nothing live or post', a.pre.some(e => e.kind === 'sma100') && a.post.length === 0 && a.live.length === 0);
a = S.analyse(pts, { gmtoffset: 3 * 3600 }, Date.parse(lastDay(pts) + 'T22:30:00Z'));
ok('exchange-local dates use the exchange offset (a bar stamped late UTC still belongs to its own local day)', a.bars === 251);
// junk
ok('junk input never throws and says nothing', S.analyse(null, null, 0).bars === 0 && S.analyse([[1, null], ['x', 2], null, [3, -5]], {}, 0).post.length === 0 && S.group(null, 'pre').sma100.length === 0 && S.html(S.group([], 'live'), { empty: 'nothing' }).includes('nothing'));
// scan + group
const calls = []; const series = {
  UP: { points: mk([...flat(250, 100), 101]), meta: { currency: 'USD' } }, DOWN: { points: mk([...flat(250, 100), 99]), meta: { currency: 'GBP' } }, SHORT: { points: mk(flat(10, 5)), meta: {} } };
const now = nowAt(series.UP.points);
S.clearCache();
const res = await S.scan([{ symbol: 'UP', name: 'UPCO', src: 'watch' }, { symbol: 'up', name: 'UPCO', src: 'holding' }, { symbol: 'DOWN', name: 'DOWNCO', src: 'holding' }, { symbol: 'NOPE', name: 'x', src: 'watch' }, { symbol: 'bad symbol!', name: 'y' }, null, { symbol: 'SHORT', name: 'S' }],
  { now, chart: async s => { calls.push(s); if (!series[s]) throw new Error('404'); return series[s]; }, onProgress: () => {} });
ok('scan: duplicates merged (a holding wins over a watchlist copy), invalid symbols skipped, one fetch per symbol', calls.filter(s => s.toUpperCase() === 'UP').length === 1 && res.total === 4 && !calls.includes('bad symbol!'));
ok('scan: an unreadable symbol is reported as failed (never shown as "clear"); a short history is read but produces no signals', res.failed.join() === 'NOPE' && res.rows.length === 3 && res.rows.find(r => r.symbol === 'SHORT').a.post.length === 0);
const before = calls.length; await S.scan([{ symbol: 'UP', name: 'UPCO', src: 'holding' }], { now: now + 60000, chart: async s => { calls.push(s); return series[s]; } });
ok('scan: results are cached for 10 minutes (no second fetch), "fresh" bypasses the cache', calls.length === before && (await S.scan([{ symbol: 'UP', name: 'U', src: 'holding' }], { now, fresh: true, chart: async s => { calls.push(s); return series[s]; } })).rows.length === 1 && calls.length === before + 1);
const g = S.group(res.rows, 'post');
ok('group: 100 SMA has UPCO (up, USD) before DOWNCO (down, GBP); 52-week high only UPCO', g.sma100.map(r => r.name + r.dir).join() === 'UPCOup,DOWNCOdown' && g.high52.length === 1 && g.high52[0].src === 'holding' && g.sma200.length === 2);
const h = S.html(g, {});
ok('cards: "Major Movement · SMA Crossover" with "100 SMA triggered" / "200 SMA triggered" and "Major Movement · 52 Week Breakout" with "52 Week High"', /Major Movement <span>· SMA Crossover/.test(h) && /100 SMA triggered/.test(h) && /200 SMA triggered/.test(h) && /Major Movement <span>· 52 Week Breakout/.test(h) && /52 Week High/.test(h));
ok('rows: ▲ green / ▼ red arrow before the name, tag, "Crossed £99.99…" / "New high of $101.00" in each stock\'s own currency', /sg-arr up" aria-label="up">▲<\/span> UPCO/.test(h) && /sg-arr down" aria-label="down">▼<\/span> DOWNCO/.test(h) && /Crossed <b>\$100\.01<\/b>/.test(h) && /Crossed <b>£100\.00<\/b>|Crossed <b>£99\.9/.test(h) && /New high of <b>\$101\.00<\/b>/.test(h) && /sg-tag">Holding/.test(h));
ok('no inline handlers; escaped names', !/\son[a-z]+=/.test(h) && !/<img/.test(S.html(S.group([{ symbol: 'X', name: '<img src=x onerror=1>', src: 'watch', a: { ccy: 'USD', post: [{ kind: 'sma100', dir: 'up', level: 1, price: 1, date: 'd' }] } }], 'post'), {})));
// view more
const many = S.group(Array.from({ length: 5 }, (_, i) => ({ symbol: 'S' + i, name: 'S' + i, src: 'watch', a: { ccy: 'USD', post: [{ kind: 'high52', dir: 'up', level: 10 + i, price: 10, date: 'd' }] } })), 'post');
ok('more than 3 rows: the rest are hidden behind "View more (N)" and shown when expanded', (S.html(many, {}).match(/ hidden>/g) || []).length === 2 && /View more \(2\)/.test(S.html(many, {})) && !/ hidden>/.test(S.html(many, { expanded: new Set(['high52']) })) && !/View more/.test(S.html(many, { expanded: new Set(['high52']) })));
ok('empty view shows the supplied explanation, never a cards-with-nothing', S.html(S.group([], 'live'), { empty: 'Markets are closed' }).includes('Markets are closed') && !/sg-card/.test(S.html(S.group([], 'live'), {})));
ok('money(): currency symbols, small prices keep 4 decimals, junk → n/a', S.money(1234.5, 'GBP') === '£1,234.50' && S.money(0.5, 'USD') === '$0.5000' && S.money(null, 'USD') === 'n/a' && S.money(5, 'ZZZ') === 'ZZZ 5.00');
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
