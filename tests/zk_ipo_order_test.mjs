// Run: node tests/zk_ipo_order_test.mjs — "My IPO list" cards can be arranged with ▲ ▼ and the order is remembered per user login
// (stored as sort_order inside the encrypted ipo_watch row; the server never sees which IPOs or their order).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const IPO = require('../docs/js/ipo.js'), SH = require('../docs/zk/shim.js'); require('../docs/zk/postgrest.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const T = '2026-11-19';
const rows = [{ id: 'US:A', market: 'US', name: 'Alpha', status: 'upcoming', start_date: '2026-11-17', end_date: '2026-11-21' }, { id: 'US:B', market: 'US', name: 'Beta', status: 'upcoming', start_date: '2026-12-01' },
  { id: 'UK:D', market: 'UK', name: 'Delta', status: 'listed', listing_date: '2026-10-14' }, { id: 'IN:E', market: 'IN', name: 'Epsilon <b>', ticker: 'EPS', status: 'listed', listing_date: '2026-11-09' }];
const w = new Set(rows.map(r => r.id)), ids = (o) => IPO.mine(rows, w, T, o).map(r => r.id).join();
ok('never arranged: automatic order (open, upcoming, then listed newest first)', ids() === 'US:A,US:B,IN:E,UK:D' && ids(new Map()) === 'US:A,US:B,IN:E,UK:D');
ok('arranged IPOs follow your order', ids(new Map([['UK:D', 0], ['IN:E', 1], ['US:B', 2], ['US:A', 3]])) === 'UK:D,IN:E,US:B,US:A');
ok('arranged first, then the rest (e.g. a newly bookmarked IPO) in automatic order', ids(new Map([['UK:D', 0], ['IN:E', 1]])) === 'UK:D,IN:E,US:A,US:B');
ok('an order for an IPO no longer in the list is ignored', ids(new Map([['XX:GONE', 0], ['UK:D', 1]])) === 'UK:D,US:A,US:B,IN:E');
ok('move up / down swaps with the neighbour; ends and unknown ids give null', IPO.moved(['a', 'b', 'c'], 'a', 1).join() === 'b,a,c' && IPO.moved(['a', 'b', 'c'], 'c', -1).join() === 'a,c,b' && IPO.moved(['a', 'b'], 'a', -1) === null && IPO.moved(['a', 'b'], 'b', 1) === null && IPO.moved(['a'], 'z', 1) === null);
const html = IPO.html(rows, {}, T, w, { arrange: true, order: new Map() });
ok('Arrange mode: one compact row per IPO with ▲ ▼ (ends disabled), no full cards, and names are escaped', (html.match(/data-ipo-mv=/g) || []).length === 8 && (html.match(/ disabled/g) || []).length === 2 && !/ipo-dates/.test(html) && !/Epsilon <b>/.test(html) && /Epsilon &lt;b&gt;/.test(html));
ok('Arrange mode shows Done, and ↺ Automatic order only when an order exists', /data-ipo-arrange="0"[^>]*>✓ Done/.test(html) && !/data-ipo-reset/.test(html) && /data-ipo-reset/.test(IPO.html(rows, {}, T, w, { arrange: true, order: new Map([['US:A', 0]]) })));
const normal = IPO.html(rows, {}, T, w, { arrange: false, order: new Map() });
ok('normal mode keeps the full cards, ✕ buttons and an ⇅ Arrange button', /ipo-dates/.test(normal) && /data-ipo-arrange="1"[^>]*>⇅ Arrange/.test(normal) && !/data-ipo-mv/.test(normal));
ok('one IPO: nothing to arrange; an old caller without the ui argument gets the normal view', !/data-ipo-arrange/.test(IPO.html(rows.slice(0, 1), {}, T, new Set(['US:A']))) && !/data-ipo-mv/.test(IPO.html(rows, {}, T, w)) && /ipo-dates/.test(IPO.html(rows, {}, T, w)));

const grips = h => (h.match(/data-ipo-grip/g) || []).length;
ok('drag handle on every My IPO list card (two or more) with the id the drag saves', grips(normal) === 4 && (normal.match(/data-ipo-id="/g) || []).length === 4);
ok('no handle for a single IPO, in Arrange mode (▲ ▼ rows), or on search results', grips(IPO.html(rows.slice(0, 1), {}, T, new Set(['US:A']))) === 0 && grips(html) === 0 && grips(IPO.html(rows, { q: 'alpha' }, T, new Set(['UK:D']), {})) === 0);
ok('the handle is decoration for assistive tech (▲ ▼ is the accessible way)', /data-ipo-grip title="Drag to reorder" aria-hidden="true"/.test(normal));

// ── shim: stored inside the encrypted rows ──
const tables = { ipo_watch: [{ id: 'US:A', added_at: '2026-11-01' }, { id: 'US:B', added_at: '2026-11-02' }, { id: 'UK:D', added_at: '2026-11-03' }] };
let puts = 0; const st = { load: async k => tables[k] || [], get: async () => null, put: async (k, r, ko) => { puts++; r.forEach(x => { tables[k] = (tables[k] || []).filter(y => ko(y) !== ko(x)).concat([x]); }); }, remove: async (k, key) => { tables[k] = tables[k].filter(r => r.id !== key); } };
const sh = SH.create({ store: st, call: async () => ({ ok: false, status: 404 }), token: 'J', positions: async () => [] });
const post = async b => { const r = await sh.handle('/ipo/order', { method: 'POST', body: JSON.stringify(b) }); return [r.status, await r.json()]; };
const pos = i => (tables.ipo_watch.find(r => r.id === i) || {}).sort_order;
let [s, d] = await post({ order: ['UK:D', 'US:A', 'US:B'] });
ok('order stored per IPO in the encrypted rows, added_at kept', s === 200 && pos('UK:D') === 0 && pos('US:A') === 1 && pos('US:B') === 2 && tables.ipo_watch.find(r => r.id === 'US:A').added_at === '2026-11-01' && d.updated === 3);
puts = 0; await post({ order: ['UK:D', 'US:A', 'US:B'] }); ok('saving the same order writes nothing', puts === 0);
await post({ order: ['US:B'] }); ok('an IPO left out of the order goes back to automatic', pos('US:B') === 0 && pos('UK:D') === undefined && pos('US:A') === undefined);
await post({ order: [] }); ok('empty order resets everything and keeps the rows', ['US:A', 'US:B', 'UK:D'].every(i => pos(i) === undefined) && tables.ipo_watch.length === 3);
await sh.handle('/ipo/watch', { method: 'POST', body: JSON.stringify({ id: 'US:A' }) }); await post({ order: ['US:A'] }); await sh.handle('/ipo/watch', { method: 'POST', body: JSON.stringify({ id: 'US:A' }) });
ok('bookmarking an IPO that is already in the list does not lose its place', pos('US:A') === 0);
ok('a bookmark for a new IPO has no place yet (follows the arranged ones)', (await sh.handle('/ipo/watch', { method: 'POST', body: JSON.stringify({ id: 'IN:E' }) }), pos('IN:E') === undefined));
ok('bad input refused: not an array, bad id, too many', (await post({ order: 'US:A' }))[0] === 400 && (await post({ order: ['<img>'] }))[0] === 400 && (await post({ order: ['us:a'] }))[0] === 400 && (await post({ order: Array(301).fill('US:A') }))[0] === 400);
ok('GET is refused', (await sh.handle('/ipo/order')).status === 405);
const rd = await (await sh.handle('/ipo_watch?select=id,sort_order')).json();
ok('the list reads back with sort_order for the page to apply', Array.isArray(rd) && rd.find(r => r.id === 'US:A').sort_order === 0);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
