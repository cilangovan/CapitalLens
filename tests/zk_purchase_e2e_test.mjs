// Run: node tests/zk_purchase_e2e_test.mjs
// Issue #53: "I invested in a pie, ran Refresh, and the purchase is not in Positions / the strategy". End to end with the REAL modules (sync, snapshot, analyst,
// returns, strategy, value-buy, holding decisions, alerts) against a fake Trading 212 and fake market data: refresh, buy something, refresh again.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const f of ['zkcrypto', 'zk/alertfmt', 'zk/symbols', 'zk/t212sync', 'zk/monitor', 'zk/analystratings', 'zk/returns', 'zk/piehistory', 'zk/profitbooking', 'zk/strategy', 'zk/flow', 'zk/holdingdecision', 'zk/valuebuy', 'zk/watchlist', 'zk/alertreport', 'zk/notify', 'zk/lynch']) { try { require(`../docs/${f.startsWith('zk/') ? f : 'js/' + f}.js`); } catch (e) { console.log('  (could not load ' + f + ': ' + e.message.split('\n')[0] + ')'); } }
const P = require('../docs/zk/pipeline.js'), T = require('../docs/zk/t212sync.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

function mkStore() {
  const rows = new Map(); const b = k => (rows.has(k) || rows.set(k, new Map()), rows.get(k));
  return { put: async (k, arr, keyOf) => { for (const r of arr) b(k).set(String(keyOf(r)), JSON.parse(JSON.stringify(r))); return arr.length; },
    get: async (k, id) => b(k).get(String(id)) || null, load: async k => [...b(k).values()].map(r => JSON.parse(JSON.stringify(r))),
    remove: async (k, id) => { b(k).delete(String(id)); }, del: async (k, id) => { b(k).delete(String(id)); } };
}
// ── fake Trading 212 ──
const A = { cash: { total: 3000, free: 50, invested: 2800, ppl: 150 }, portfolio: [], pies: [], orders: [], portfolioStatus: 200, accountStatus: 200, piesStatus: 200 };
const pos = (t, q, avg, cur) => ({ ticker: t, quantity: q, averagePrice: avg, currentPrice: cur, ppl: +(q * (cur - avg)).toFixed(2) });
const buy = (i, t, q, p, day) => ({ order: { id: 7000 + i, ticker: t, side: 'BUY', status: 'FILLED', createdAt: `2026-11-${day}T10:00:00Z` }, fill: { id: 4000 + i, quantity: q, price: p, filledAt: `2026-11-${day}T10:00:01Z`, walletImpact: { netValue: -(q * p), realisedProfitLoss: 0, fxRate: 1 } } });
const pie = (id, name, tickers) => ({ id, detail: { settings: { name }, instruments: tickers.map(t => ({ ticker: t, ownedQuantity: 1, expectedShare: 1 / tickers.length, currentShare: 1 / tickers.length, result: { priceAvgValue: 100, priceAvgInvestedValue: 90 } })) } });
const api = { setCreds() {}, clear() {}, nowMs: () => Date.parse('2026-11-20T10:00:00Z'),
  get: async path => {
    const p = path.split('?')[0];
    if (p === '/api/v0/equity/account/cash') { if (A.accountStatus !== 200) throw new Error(`T212 /api/v0/equity/account/cash -> ${A.accountStatus}: x`); return A.cash; }
    if (p === '/api/v0/equity/portfolio') { if (A.portfolioStatus !== 200) throw new Error(`T212 /api/v0/equity/portfolio -> ${A.portfolioStatus}: not allowed`); return A.portfolio; }
    if (p === '/api/v0/equity/pies') { if (A.piesStatus !== 200) throw new Error(`T212 /api/v0/equity/pies -> ${A.piesStatus}: x`); return A.pies.map(x => ({ id: x.id })); }
    if (p.startsWith('/api/v0/equity/pies/')) return (A.pies.find(x => String(x.id) === p.split('/').pop()) || {}).detail;
    if (p === '/api/v0/equity/history/orders') { const cur = +(new URL('http://t' + path).searchParams.get('cursor') || 0); return { items: A.orders.slice(cur, cur + 50), nextPagePath: cur + 50 < A.orders.length ? `${p}?limit=50&cursor=${cur + 50}` : null }; }
    if (p === '/api/v0/equity/metadata/instruments') return [];
    if (p === '/api/v0/history/transactions') return { items: [{ reference: 'dep1', type: 'DEPOSIT', amount: 2800, dateTime: '2026-01-01T00:00:00Z' }], nextPagePath: null };
    return { items: [], nextPagePath: null };
  } };
// ── fake market data ──
const series = (sym, n = 260) => { const base = 50 + (sym.length * 7) % 40, close = Array.from({ length: n }, (_, i) => +(base + Math.sin(i / 9) * 4 + i * 0.03).toFixed(2));
  return { symbol: sym, currency: 'GBP', longName: sym, shortName: sym, price: close[n - 1], dates: close.map((_, i) => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10)), close, adjclose: close, high: close.map(x => x * 1.01), low: close.map(x => x * 0.99), volume: close.map(() => 1e6), splits: [] }; };
const market = { chart: async s => series(s), info: async () => ({}), detail: async () => null, headlines: async () => [] };
let clock = 0; const store = mkStore(); const logs = [];
const mods = { T212: { create: o => T.create({ store: o.store, client: api, log: o.log, now: () => new Date(Date.UTC(2026, 10, 20, 9, clock)).toISOString() }) }, Client: { client: () => api }, Flow: { latest: async () => ({ markets: [] }) } };
const refresh = async () => { clock++; return P.create({ store, market, call: async () => ({ ok: false, status: 404, d: null }), token: 't', relayUrl: 'r', log: m => logs.push(m), nowDate: () => new Date(Date.UTC(2026, 10, 20, 9, clock)), mods }).run('KEY', 'SECRET'); };
const latest = async () => { const s = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]; return { s, pos: (await store.load('positions')).filter(p => p.snapshot_id === s.id) }; };

// day 1: three holdings in one pie
A.portfolio = [pos('AAAl_EQ', 10, 100, 110), pos('BBBl_EQ', 5, 200, 190), pos('CCCl_EQ', 8, 50, 55)];
A.pies = [pie(1, 'Core', ['AAAl_EQ', 'BBBl_EQ', 'CCCl_EQ'])];
A.orders = [buy(3, 'CCCl_EQ', 8, 50, '10'), buy(2, 'BBBl_EQ', 5, 200, '09'), buy(1, 'AAAl_EQ', 10, 100, '08')];
const r1 = await refresh(); const d1 = await latest(); if (!r1.ok) console.log('   not OK:', r1.results.filter(x => !x.ok).map(x => x.name + ': ' + x.note).join(' | '));
ok('first refresh: everything OK, 3 positions, 3 orders', r1.ok && d1.pos.length === 3 && (await store.load('t212_orders')).length === 3);

// day 2: the owner invests in a NEW pie (new instrument + a top-up of one already held) and refreshes
A.portfolio = [pos('AAAl_EQ', 12, 101.7, 112), pos('BBBl_EQ', 5, 200, 190), pos('CCCl_EQ', 8, 50, 55), pos('NEWTl_EQ', 4, 75, 76)];
A.pies = [pie(1, 'Core', ['AAAl_EQ', 'BBBl_EQ', 'CCCl_EQ']), pie(2, 'New pie', ['NEWTl_EQ'])];
A.cash = { total: 3300, free: 20, invested: 3100, ppl: 160 };
A.orders = [buy(5, 'NEWTl_EQ', 4, 75, '20'), buy(4, 'AAAl_EQ', 2, 105, '20'), ...A.orders];
const r2 = await refresh(); const d2 = await latest();
ok('second refresh reports OK', r2.ok);
ok('AC1 Positions: the new snapshot has the new holding and the top-up', d2.pos.length === 4 && d2.pos.find(p => p.ticker === 'NEWTl_EQ') && d2.pos.find(p => p.ticker === 'AAAl_EQ').quantity === 12);
ok('AC1 Positions: the new pie is in the snapshot', (d2.s.raw.pies || []).some(p => p.name === 'New pie'));
ok('AC1 snapshot totals follow Trading 212 (value 3300, invested 3100 incl. unrealised)', d2.s.total_value === 3300 && Math.abs(d2.s.invested - 3260) < 0.01);
const orders = await store.load('t212_orders');
ok('AC2 the two new orders (one a new pie holding) are stored', orders.length === 5 && orders.some(o => o.ticker === 'NEWTl_EQ' && o.side === 'BUY'));
const ratings = await store.load('analyst_ratings');
ok('analyst ratings include the new holding', ratings.some(r => r.ticker === 'NEWTl_EQ'));
const vb = await store.load('value_buy_scores');
console.log('   value_buy tickers:', vb.map(r => r.ticker).join());
ok('value-buy / entry analysis includes the new holding', vb.some(r => r.ticker === 'NEWT.L'));
const hd = await store.load('holding_decisions');
ok('holding decisions include the new holding', hd.some(r => r.ticker === 'NEWTl_EQ'));
const strat = (await store.load('strategy_recommendations'))[0];
ok('strategy recommendations cover the new pie', !!strat && JSON.stringify(strat.recommendations || strat).includes('New pie'));

// AC4: the refresh says what changed
const L2 = (r2.changes || {}).lines || [];
ok('AC4 "what changed": snapshot saved, new position, quantity change, new orders (2 buys)', L2.some(l => /snapshot saved: 4 positions/.test(l)) && L2.some(l => l === 'New positions: NEWTl (4)') && L2.some(l => l === 'Quantity changed: AAAl 10 → 12') && L2.some(l => /New orders from Trading 212: 2 \(2 buys, 0 sells\): NEWTl, AAAl/.test(l)));
const r2b = await refresh();
ok('AC4 nothing new: says so plainly (no change in holdings, no new orders)', r2b.changes.lines.some(l => /No change in holdings/.test(l)) && r2b.changes.lines.some(l => /No new orders/.test(l)));

// AC3: Trading 212 refuses the key's portfolio permission
const snapBefore = (await latest()).s.id;
A.portfolioStatus = 403; const r3 = await refresh(); const d3 = await latest();
const failed3 = r3.results.filter(x => !x.ok);
ok('AC3 refused key: the refresh is NOT reported as fine, and names the reason and the fix', !r3.ok && failed3.some(x => x.name === 'Portfolio snapshot' && /refused the key for your open positions \(HTTP 403\)/.test(x.note) && /Portfolio and Account data permissions/.test(x.note)));
ok('AC3 …no new snapshot was written, the previous complete one stays', d3.s.id === snapBefore && d3.pos.length === 4);
ok('AC3 …and the analyses are labelled as based on the previous snapshot', r3.warnings.some(w => /used the previous snapshot from \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(w)) && r3.changes.snapshotSaved === false && /No new portfolio snapshot/.test(r3.changes.lines[0]));
A.portfolioStatus = 429; const r3b = await refresh(); ok('AC3 rate limit: says to wait and refresh again', r3b.results.some(x => /rate-limiting.*Wait a minute/.test(x.note)));
A.portfolioStatus = 200;
// a failed account call must not write a snapshot with a total of 0
const nSnaps = (await store.load('portfolio_snapshots')).length;
A.accountStatus = 500; const r4 = await refresh();
ok('AC3 account balance unavailable: nothing saved (no zero-value snapshot) and the reason is shown', (await store.load('portfolio_snapshots')).length === nSnaps && r4.results.some(x => !x.ok && /account balance/.test(x.note)));
A.accountStatus = 200;
// pies unreadable: positions are still saved, but the owner is told the pie grouping may be incomplete
A.piesStatus = 500; const r5 = await refresh();
ok('AC3 pies unreadable: snapshot still saved, warning says pie grouping may be incomplete', r5.changes.snapshotSaved && r5.warnings.some(w => /pies/.test(w)));
A.piesStatus = 200;
// a sell is described too
A.portfolio = A.portfolio.filter(p => p.ticker !== 'CCCl_EQ'); A.orders = [{ ...buy(9, 'CCCl_EQ', 8, 55, '20'), order: { ...buy(9, 'CCCl_EQ', 8, 55, '20').order, side: 'SELL' } }, ...A.orders];
const r6 = await refresh();
ok('a closed position and a sell are described', r6.changes.lines.some(l => l === 'No longer held: CCCl') && r6.changes.lines.some(l => /1 sell/.test(l)));

// The app's call() helper answers { ok, status, d }, not a fetch Response: support levels used to be skipped with "x.json is not a function" on every refresh
const M2 = require('../docs/zk/monitor.js');
ok('support levels load from the app\'s call() shape ({ok, d}) instead of throwing', (await M2.fetchSupportLevels(async () => ({ ok: true, status: 200, d: [{ ticker: 'A', level: 1 }] }), 't'))[0].ticker === 'A');
ok('  …a real Response-like shape still works, and failures give an empty list', (await M2.fetchSupportLevels(async () => ({ ok: true, json: async () => [{ ticker: 'B' }] }), 't'))[0].ticker === 'B' && (await M2.fetchSupportLevels(async () => ({ ok: false, status: 500 }), 't')).length === 0);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
