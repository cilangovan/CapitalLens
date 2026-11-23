// Run: node tests/zk_lots_test.mjs
// Purchases outside pies: every still-held buy with its own return, stop-loss and sell levels; a sold share disappears; honest when history is incomplete.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), L = require('../docs/js/lots.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const NOW = Date.parse('2026-11-23T10:00:00Z'), d = s => `2026-${s}T10:00:00Z`;
const o = (x) => ({ status: 'FILLED', ...x });
const un = [{ ticker: 'NVDA_US_EQ', display: 'NVIDIA', pie: null, dq: 3, current_price: 120, avg_price: 95 }];
const buys = [o({ id: 'a', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('08-01'), quantity: 1, price: 100, net_value: -80 }),
  o({ id: 'b', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('09-15'), quantity: 1, price: 80, net_value: -64 }),
  o({ id: 'c', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('11-10'), quantity: 1, price: 150, net_value: -120 })];
let r = L.rows(buys, un, NOW), s = r[0];
ok('one stock, three separate buys, oldest first', r.length === 1 && s.lots.length === 3 && s.lots.map(l => l.px).join() === '100,80,150');
ok('each buy has its own return: +20% / +50% / −20%', s.lots.map(l => l.pct).join() === '20,50,-20');
ok('£ estimate per buy = cash paid × return (£16 / £32 / −£24) and total £24', s.lots.map(l => l.gain).join() === '16,32,-24' && s.gain === 24 && s.cost === 264);
ok('stop-loss levels −5% / −10% below what was paid, with the £ at risk', s.lots[0].stops.map(x => x.price).join() === '95,90' && s.lots[0].stops.map(x => x.loss).join() === '4,8');
ok('a stop already hit is flagged (150 bought, now 120: below −10% = 135 and −5% = 142.5)', s.lots[2].stops.every(x => x.hit === true) && s.lots[0].stops.every(x => x.hit === false));
ok('sell steps +10/+20/+30% with prices and reached flags (100 → 110 ✓, 120 ✓, 130)', s.lots[0].steps.map(x => x.price).join() === '110,120,130' && s.lots[0].steps.map(x => x.hit).join() === 'true,true,false');
ok('next limit-sell target is the first step not yet reached (130 for the first buy; 165 for the −20% buy)', s.lots[0].next.price === 130 && s.lots[2].next.pct === 10 && s.lots[2].next.price === 165);
ok('stop from today\'s price is offered too (−5% = 114, −10% = 108)', s.fromNow.map(x => x.price).join() === '114,108');
ok('Trading 212 average is carried for reference, no gap when the buys add up to the shares held', s.t212_avg === 95 && s.gap === null && s.held === 3);
// sold completely: not held outside pies any more → not listed at all
ok('sold share (nothing held outside pies) is not listed', L.rows(buys, [{ ...un[0], dq: 0 }], NOW).length === 0 && L.rows(buys, [], NOW).length === 0 && L.html(L.rows(buys, [], NOW)) === '');
// FIFO: a sale takes the oldest buy first
const sold = [...buys, o({ id: 'd', ticker: 'NVDA_US_EQ', side: 'SELL', filled_at: d('11-12'), quantity: 1.5, price: 140, net_value: 210 })];
r = L.rows(sold, [{ ...un[0], dq: 1.5 }], NOW); s = r[0];
ok('FIFO: selling 1.5 sh removes the oldest buy and half of the next, leaving 0.5 + 1', s.lots.length === 2 && s.lots[0].qty === 0.5 && s.lots[0].of === 1 && s.lots[1].qty === 1 && s.gap === null);
ok('the part-sold buy keeps only its remaining share of the cash paid (£32 of £64)', s.lots[0].cost === 32 && s.lots[0].gain === 16);
// incomplete history
r = L.rows(buys.slice(1), un, NOW); s = r[0];
ok('shares missing from the synced history are reported, never invented', s.gap && s.gap.kind === 'earlier' && s.gap.qty === 1 && s.lots.length === 2);
r = L.rows([...buys, o({ id: 'e', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('11-11'), quantity: 2, price: 1, net_value: -2 })], un, NOW);
ok('orders listing more shares than held outside pies are flagged (maybe moved into a pie)', r[0].gap && r[0].gap.kind === 'extra' && r[0].gap.qty === 2);
ok('cancelled / unfilled / future / zero-quantity orders and other tickers are ignored', L.rows([...buys, o({ ticker: 'NVDA_US_EQ', side: 'BUY', status: 'CANCELLED', filled_at: d('11-01'), quantity: 5, price: 1 }), o({ ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: '2026-12-31T00:00:00Z', quantity: 5, price: 1 }),
  o({ ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('11-02'), quantity: 0, price: 1 }), o({ ticker: 'AMD_US_EQ', side: 'BUY', filled_at: d('11-02'), quantity: 9, price: 1 })], un, NOW)[0].lots.length === 3);
// honesty when something is missing
r = L.rows([o({ id: 'x', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: d('11-10'), quantity: 3, price: 100 })], [{ ...un[0], current_price: null }], NOW); s = r[0];
ok('no cash value → no £ (null); no latest price → no % (null); never zero', s.lots[0].cost === null && s.lots[0].gain === null && s.lots[0].pct === null && s.gain === null && s.fromNow === null);
ok('junk input never throws', L.rows(null, null, NOW).length === 0 && L.rows([null, {}, { side: 'BUY' }], [null, {}], NOW).length === 0 && L.html(null) === '' && L.html([]) === '');
// two stocks: biggest £ gain first
const two = L.rows([...buys, o({ id: 'z', ticker: 'AMD_US_EQ', side: 'BUY', filled_at: d('10-01'), quantity: 1, price: 100, net_value: -100 })], [...un, { ticker: 'AMD_US_EQ', display: 'AMD', dq: 1, current_price: 90 }], NOW);
ok('stocks sorted by £ gain, biggest first (NVIDIA +£24 before AMD −£10)', two.map(x => x.display).join() === 'NVIDIA,AMD');
const fm = { gbp: v => '£' + Number(v).toFixed(2), quote: (v) => '$' + Number(v).toFixed(2) };
const h = L.html(two, fm);
ok('card: ONE short line per stock (name, buys, shares, return, £), not one per buy', /Purchases outside pies/.test(h) && (h.match(/class="lt-row"/g) || []).length === 2 && !/lt-lot|SELL |Stop-loss/.test(h) && /3 buys · 3 sh/.test(h));
ok('card rows are real buttons with a data hook, no inline handler; total line for several stocks', /<button type="button" class="lt-row" data-lt="NVDA_US_EQ"/.test(h) && !/\son[a-z]+=/.test(h) && /All: /.test(h));
ok('stock return % = total £ gain / cash paid (+£24 on £264 = +9.1%)', two[0].pct === 9.09);
const mh = L.modalHtml(two[0], fm, null);
ok('pop-up: table with Bought / Shares / Paid / Return / £ and one row per buy, oldest first, plus an "All 3 buys" total', /<table class="lt-tbl">/.test(mh) && /<th>Bought<\/th><th>Shares<\/th><th>Paid<\/th><th>Return<\/th><th>£<\/th>/.test(mh) && (mh.match(/class="lt-tr"/g) || []).length === 3 && /All 3 buys/.test(mh) && mh.indexOf('$100.00') < mh.indexOf('$80.00') && /data-lt-close/.test(mh) && !/\son[a-z]+=/.test(mh));
ok('pop-up has a Close button and an ✕, and says tap a buy for levels', (mh.match(/data-lt-close/g) || []).length === 2 && /Tap a buy/.test(mh) && /oldest buys first/.test(mh) && /FX moves and fees are not included/.test(mh));
const dh = L.modalHtml(two[0], fm, 0);
ok('drill-down for one buy: back button, stops −5%/−10% with £ at risk, sell steps, copy-ready limit line, place-orders-yourself note', /data-lt-back/.test(dh) && /−5% \$95\.00 \(−£4\.00\)/.test(dh) && /−10% \$90\.00/.test(dh) && /\+30% \$130\.00/.test(dh) && /SELL 1 NVDA limit \$130\.00/.test(dh) && /place nothing|places nothing/.test(dh) && /Stop from today/.test(dh));
ok('drill-down with a missing index falls back to the table; junk stock gives nothing', /lt-tbl/.test(L.modalHtml(two[0], fm, 99)) && L.modalHtml(null, fm, 0) === '');
ok('gap warning lives in the pop-up and the card row says "incomplete history"', /incomplete history/.test(L.html(L.rows(buys.slice(1), un, NOW), fm)) && /not in the synced order history/.test(L.modalHtml(L.rows(buys.slice(1), un, NOW)[0], fm, null)));
const evil0 = L.rows([o({ id: 'q', ticker: '<img src=x onerror=alert(1)>_US_EQ', side: 'BUY', filled_at: d('11-10'), quantity: 1, price: 1, net_value: -1 })], [{ ticker: '<img src=x onerror=alert(1)>_US_EQ', display: '<b>x</b>', dq: 1, current_price: 2 }], NOW);
const evil = L.html(evil0, {}) + L.modalHtml(evil0[0], {}, null) + L.modalHtml(evil0[0], {}, 0);
ok('everything that goes into the HTML is escaped', !/<img|<b>x/.test(evil) && /&lt;b&gt;x/.test(evil));
// show(): reads orders through api(), appends the card, replaces itself, hides for guests, says nothing if orders cannot be read
const box = { _h: '', querySelector() { return this._old; }, insertAdjacentHTML(_, x) { this._h += x; } };
await L.show(box, un, { api: async (t, q) => { box.q = t + q; return buys; }, now: NOW, gbp: v => '£' + v, quote: v => '$' + v });
ok('show(): asks for the filled orders oldest first and adds the card at the end', /t212_orders/.test(box.q) && /order=filled_at\.asc/.test(box.q) && /Purchases outside pies/.test(box._h));
const b2 = { _h: '', querySelector() { return null; }, insertAdjacentHTML(_, x) { this._h += x; } };
await L.show(b2, un, { api: async () => { throw new Error('boom'); }, now: NOW }); await L.show(b2, un, { api: async () => buys, guest: true, now: NOW }); await L.show(b2, [], { api: async () => buys, now: NOW });
ok('orders unreadable, guest mode or nothing outside pies: no card, no claim', b2._h === '');
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
