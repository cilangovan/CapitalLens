// Run: node tests/zk_watchlist_order_test.mjs — watchlist cards can be arranged, and the order is remembered per user login.
// Private app: sort_order is stored INSIDE the encrypted watchlist row (the server never sees tickers or their order).
import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const require = createRequire(import.meta.url);
const SH = require('../docs/zk/shim.js'); require('../docs/zk/postgrest.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

// ── client: sorting, moving, saving (docs/js/watchlist.js) ──
const src = readFileSync(new URL('../docs/js/watchlist.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// ── CARD ORDER'), src.indexOf('const WCATS'));
const calls = [], notes = []; const store = {};
const ctx = { localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, PROXY: 'https://w', SESSION_TOKEN: 'T', WL: { items: [] }, wCat: i => i.category || 'stock',
  wlNote: (m, e) => notes.push([m, !!e]), fetch: async (u, o) => { calls.push([u, JSON.parse(o.body)]); return ctx._resp(); }, _resp: () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) };
vm.createContext(ctx); vm.runInContext(body + ';this.wlSorted=wlSorted;this.wlMoved=wlMoved;this.wlSaveOrder=wlSaveOrder;this.wlApplyLocalOrder=wlApplyLocalOrder;', ctx);
const it = (t, o) => Object.assign({ ticker: t }, o), an = { A: { verdict: 'AVOID' }, B: { verdict: 'ENTER' }, C: { verdict: 'HOLD' }, D: { verdict: 'ACCUMULATE' } };
const names = a => ctx.wlSorted(a, an).map(i => i.ticker).join('');
ok('never arranged: automatic order by this week\'s call (ENTER, ACCUMULATE, HOLD, AVOID)', names([it('A'), it('B'), it('C'), it('D')]) === 'BDCA');
ok('arranged cards follow sort_order', names([it('A', { sort_order: 0 }), it('B', { sort_order: 2 }), it('C', { sort_order: 1 }), it('D', { sort_order: 3 })]) === 'ACBD');
ok('arranged cards come first; new / unarranged ones follow in automatic order', names([it('A', { sort_order: 0 }), it('B'), it('C', { sort_order: 1 }), it('D')]) === 'ACBD');
ok('equal sort_order is stable by ticker (no flicker)', names([it('C', { sort_order: 0 }), it('A', { sort_order: 0 })]) === 'AC');
ok('move down / up swaps with the neighbour', ctx.wlMoved(['A', 'B', 'C'], 'A', 1).join('') === 'BAC' && ctx.wlMoved(['A', 'B', 'C'], 'C', -1).join('') === 'ACB');
ok('first can\'t go up, last can\'t go down, unknown ticker ignored', ctx.wlMoved(['A', 'B'], 'A', -1) === null && ctx.wlMoved(['A', 'B'], 'B', 1) === null && ctx.wlMoved(['A', 'B'], 'Z', 1) === null);
await ctx.wlSaveOrder('stock', ['B', 'A']);
ok('saving posts the full order for the section with the session token', calls.length === 1 && calls[0][0] === 'https://w/watchlist/order' && calls[0][1].token === 'T' && calls[0][1].category === 'stock' && calls[0][1].order.join('') === 'BA');
ctx._resp = () => ({ ok: false, status: 501, json: async () => ({ error: 'not in the demo' }) }); ctx.WL.items = [it('B'), it('A'), it('C', { category: 'crypto' })];
await ctx.wlSaveOrder('stock', ['B', 'A']);
ok('demo (501): order kept in this browser, no error shown', JSON.parse(store.wl_order_local).B === 0 && JSON.parse(store.wl_order_local).A === 1 && notes.length === 0);
ctx.WL.items = [it('A'), it('B'), it('C')]; ctx.wlApplyLocalOrder();
ok('local order is applied to items that have no saved order', ctx.WL.items[1].sort_order === 0 && ctx.WL.items[0].sort_order === 1 && ctx.WL.items[2].sort_order === undefined);
ctx._resp = () => ({ ok: false, status: 401, json: async () => ({ error: 'Invalid or expired session' }) }); await ctx.wlSaveOrder('stock', ['A']);
ok('a failed save says so (and to sign in again)', notes.length === 1 && notes[0][1] && /Couldn't save the order/.test(notes[0][0]) && /sign in again/.test(notes[0][0]));

// ── private app: the shim stores it in the encrypted row ──
const tables = { watchlist: [{ ticker: 'AAA', category: 'stock', name: 'A' }, { ticker: 'BBB', category: 'stock', name: 'B' }, { ticker: 'CCC', category: 'stock', name: 'C' }, { ticker: 'BTC-USD', category: 'crypto', name: 'Bitcoin' }] };
let puts = 0; const st = { load: async k => tables[k] || [], get: async (k, key) => (tables[k] || []).find(r => r.ticker === key) || null,
  put: async (k, rows, ko) => { puts++; rows.forEach(x => { tables[k] = (tables[k] || []).filter(y => ko(y) !== ko(x)).concat([x]); }); }, remove: async () => {} };
const sh = SH.create({ store: st, call: async () => ({ ok: false, status: 404 }), token: 'J', positions: async () => [] });
const post = async b => { const r = await sh.handle('/watchlist/order', { method: 'POST', body: JSON.stringify(b) }); return [r.status, await r.json()]; };
const pos = t => (tables.watchlist.find(r => r.ticker === t) || {}).sort_order;
let [s, d] = await post({ category: 'stock', order: ['CCC', 'AAA', 'BBB'] });
ok('order is stored per card in the encrypted watchlist rows', s === 200 && pos('CCC') === 0 && pos('AAA') === 1 && pos('BBB') === 2 && d.updated === 3);
ok('other sections are untouched', pos('BTC-USD') === undefined);
puts = 0; await post({ category: 'stock', order: ['CCC', 'AAA', 'BBB'] }); ok('saving the same order writes nothing', puts === 0);
await post({ category: 'stock', order: ['BBB'] });
ok('a card left out of the order goes back to automatic; the listed one is first', pos('BBB') === 0 && pos('AAA') === undefined && pos('CCC') === undefined);
await post({ category: 'stock', order: [] }); ok('empty order resets the section to automatic', ['AAA', 'BBB', 'CCC'].every(t => pos(t) === undefined) && tables.watchlist.length === 4);
ok('names and categories survive an order change', tables.watchlist.find(r => r.ticker === 'BTC-USD').name === 'Bitcoin' && tables.watchlist.find(r => r.ticker === 'AAA').name === 'A');
ok('bad input is refused: category, non-array, bad ticker, too long', (await post({ category: 'bonds', order: [] }))[0] === 400 && (await post({ category: 'stock', order: 'AAA' }))[0] === 400 && (await post({ category: 'stock', order: ['<img>'] }))[0] === 400 && (await post({ category: 'stock', order: Array(301).fill('A') }))[0] === 400 && (await post({ category: 'constructor', order: [] }))[0] === 400);
ok('GET is refused', (await sh.handle('/watchlist/order')).status === 405);

// ── source guards: every dashboard path has the feature ──
const w = readFileSync(new URL('../cloudflare-worker/worker.js', import.meta.url), 'utf8'), sql = readFileSync(new URL('../db/tenant/24_watchlist_order.sql', import.meta.url), 'utf8');
const ops = readFileSync(new URL('../docs/zk/watchlistops.js', import.meta.url), 'utf8');
ok('worker route exists, verifies the session and validates the category list (not YTYPES[...] prototype lookup)', /path === '\/watchlist\/order'/.test(w) && /async function handleWatchlistOrder[\s\S]*verifySession[\s\S]*includes\(category\)/.test(w));
ok('legacy table gets a bounded nullable sort_order column', /add column if not exists sort_order integer/.test(sql) && /sort_order >= 0 and sort_order < 500/.test(sql));
ok('re-adding a watched ticker keeps its card position (zk add)', /sort_order: prev\.sort_order/.test(ops));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
