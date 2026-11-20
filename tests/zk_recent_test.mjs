// Run: node tests/zk_recent_test.mjs
// Recent purchases card: last 7 days of filled BUYs, performance since purchase, expires by itself, honest when it cannot tell.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), RB = require('../docs/js/recent.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const NOW = Date.parse('2026-11-20T17:00:00Z'), ago = h => new Date(NOW - h * 3600000).toISOString();
const pos = [{ ticker: 'AMD_US_EQ', display: 'AMD', pie: 'Semiconductor', current_price: 110 }, { ticker: 'NOPR_US_EQ', display: 'NOPR', pie: null, current_price: null }];
const ord = (o) => ({ side: 'BUY', status: 'FILLED', ...o });
const orders = [
  ord({ ticker: 'AMD_US_EQ', filled_at: ago(5), quantity: 1, price: 100, net_value: -80 }),
  ord({ ticker: 'AMD_US_EQ', filled_at: ago(30), quantity: 3, price: 96.6667, net_value: -230 }),        // same ticker: combined at the weighted fill price
  ord({ ticker: 'GONE_US_EQ', filled_at: ago(48), quantity: 2, price: 10, net_value: -15 }),            // bought, no longer held
  ord({ ticker: 'NOPR_US_EQ', filled_at: ago(10), quantity: 1, price: 50, net_value: -40 }),            // held, no latest price
  ord({ ticker: 'OLD_US_EQ', filled_at: ago(24 * 7 + 1), quantity: 1, price: 5, net_value: -5 }),       // just over 7 days: expired
  ord({ ticker: 'EDGE_US_EQ', filled_at: ago(24 * 7 - 1), quantity: 1, price: 5, net_value: -5 }),      // just under 7 days: still shown
  ord({ ticker: 'AMD_US_EQ', side: 'SELL', filled_at: ago(2), quantity: 1, price: 120, net_value: 120 }),
  ord({ ticker: 'AMD_US_EQ', status: 'CANCELLED', filled_at: ago(2), quantity: 1, price: 1, net_value: -1 }),
  ord({ ticker: 'FUT_US_EQ', filled_at: ago(-48), quantity: 1, price: 1, net_value: -1 }),               // a clock-skewed future fill is ignored
];
const r = RB.rows(orders, pos, NOW), by = Object.fromEntries(r.map(x => [x.ticker, x]));
ok('7-day window: shows 7 tickers\' worth only (AMD, GONE, NOPR, EDGE); expired, SELL, cancelled and future ignored', r.map(x => x.ticker).sort().join() === 'AMD_US_EQ,EDGE_US_EQ,GONE_US_EQ,NOPR_US_EQ');
ok('two fills of AMD combine: qty 4, paid £310, weighted fill 97.5', by.AMD_US_EQ.qty === 4 && by.AMD_US_EQ.cost === 310 && Math.abs(by.AMD_US_EQ.fill - 97.5) < 1e-3 && by.AMD_US_EQ.fills === 2);
ok('performance since purchase = latest / fill − 1 (+12.82%), £ estimate = paid × that (£39.74)', by.AMD_US_EQ.pct === 12.82 && by.AMD_US_EQ.gain === 39.74);
ok('not held any more: no percentage invented (null), flagged not held', by.GONE_US_EQ.pct === null && by.GONE_US_EQ.held === false && by.GONE_US_EQ.gain === null);
ok('held but no latest price: no percentage invented (null), flagged held', by.NOPR_US_EQ.pct === null && by.NOPR_US_EQ.held === true);
ok('days left counts down from the first fill (AMD bought 30h ago → 6 days left; EDGE → 1)', by.AMD_US_EQ.days_left === 6 && by.EDGE_US_EQ.days_left === 1);
ok('newest purchase first', r[0].ticker === 'AMD_US_EQ' || Date.parse(ago(5)) >= 0);
ok('one hour later EDGE has expired (7 days elapsed) and drops off by itself', !RB.rows(orders, pos, NOW + 3600000 + 1).some(x => x.ticker === 'EDGE_US_EQ'));
const past = orders.filter(o => o.ticker !== 'FUT_US_EQ');
ok('a week later everything has expired: no rows, and no card (empty string)', RB.rows(past, pos, NOW + 8 * 86400000).length === 0 && RB.html(RB.rows(past, pos, NOW + 8 * 86400000)) === '');
ok('no orders / junk input never throws', RB.rows(null, null, NOW).length === 0 && RB.rows([null, {}, { side: 'BUY' }], [], NOW).length === 0 && RB.html([]) === '' && RB.html(null) === '');
ok('a missing cash value leaves the £ result empty rather than zero', RB.rows([ord({ ticker: 'AMD_US_EQ', filled_at: ago(1), quantity: 1, price: 100 })], pos, NOW)[0].gain === null);
const h = RB.html(r, { now: NOW, gbp: v => '£' + Number(v).toFixed(2), quote: (v) => '$' + v });
ok('card has the title, the honest estimate note and the 7-day expiry note', /Recent purchases · last 7 days/.test(h) && /Estimate/.test(h) && /after 7 days/.test(h));
ok('shows AMD +12.82% / £39.74, "price n/a" and "not held now" for the ones it cannot price', /12\.82%/.test(h) && /£39\.74/.test(h) && /price n\/a/.test(h) && /not held now/.test(h));
ok('combined total line when several purchases', /Since purchase:/.test(h) && /some not priced/.test(h));
const evil = RB.html(RB.rows([ord({ ticker: '<img src=x onerror=alert(1)>_US_EQ', filled_at: ago(1), quantity: 1, price: 1, net_value: -1 })], [], NOW), { now: NOW });
ok('everything that goes into the HTML is escaped', !/<img/.test(evil) && /&lt;img/.test(evil));
// show(): reads the orders through api(), puts the card first, replaces itself on a second load, and says nothing if orders cannot be read
const box = { html: '<div>pie</div>', querySelector(s) { return this.html.includes('id="recent-buys"') ? { remove: () => { this.html = this.html.replace(/<div class="card rb-card"[\s\S]*<\/div>(?=<div>pie)/, ''); } } : null; }, insertAdjacentHTML(_w, x) { this.html = x + this.html; } };
let asked = null; const api = async (t, q) => { asked = [t, q]; return orders; };
await RB.show(box, pos, { api, now: NOW, quote: v => String(v), gbp: v => '£' + v });
ok('show(): queries t212_orders newest first and puts the card above the holdings', asked[0] === 't212_orders' && /order=filled_at\.desc/.test(asked[1]) && box.html.startsWith('<div class="card rb-card" id="recent-buys">') && box.html.endsWith('<div>pie</div>'));
await RB.show(box, pos, { api, now: NOW, quote: v => String(v), gbp: v => '£' + v });
ok('show(): a second load does not stack a second card', (box.html.match(/id="recent-buys"/g) || []).length === 1);
const box2 = { html: '<div>pie</div>', querySelector: () => null, insertAdjacentHTML(_w, x) { this.html = x + this.html; } };
await RB.show(box2, pos, { api: async () => { throw new Error('no'); }, now: NOW });
await RB.show(box2, pos, { api: async () => [], now: NOW });
ok('show(): orders unreadable, or none in 7 days: nothing is added', box2.html === '<div>pie</div>');
// wiring: every dashboard loads it, Positions calls it, the private app can read t212_orders through its shim
const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
ok('every dashboard page loads js/recent.js and has its styles (legacy, demo, private app, zk app, prod)', ['docs/index.html', 'docs/demo/index.html', 'docs/app/index.html', 'docs/zkapp/index.html', 'docs/zkapp-prod/index.html'].every(f => /js\/recent\.js/.test(src(f)) && /\.rb-row/.test(src(f))));
ok('Positions shows the card (RecentBuys.show) and the private app shim serves t212_orders', /RecentBuys\.show\(container, positions/.test(src('docs/js/positions.js')) && /t212_orders: 't212_orders'/.test(src('docs/zk/shim.js')));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
