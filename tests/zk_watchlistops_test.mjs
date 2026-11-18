// Run: node tests/zk_watchlistops_test.mjs
// Watchlist search/add/remove and live chart in the browser, through the shim, against a fake relay and an in-memory encrypted store.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OPS = require('../docs/zk/watchlistops.js'), SH = require('../docs/zk/shim.js'); require('../docs/zk/postgrest.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const tables = { watchlist: [], watchlist_analysis: [{ ticker: 'OLD' }] };
const store = { load: async k => tables[k] || [], get: async (k, key) => (tables[k] || []).find(r => r.ticker === key) || null,
  put: async (k, rows, ko) => { rows.forEach(x => { tables[k] = (tables[k] || []).filter(y => ko(y) !== ko(x)).concat([x]); }); },
  remove: async (k, key) => { tables[k] = (tables[k] || []).filter(r => r.ticker !== key); } };
const T212 = [{ ticker: 'AAPL_US_EQ', name: 'Apple', type: 'STOCK', exchange: 'NASDAQ' }, { ticker: 'SGLNl_EQ', name: 'iShares Physical Gold ETC', short_name: 'SGLN', type: 'ETF', exchange: 'LSE', currency: 'GBP' }, { ticker: 'WGLD3x_EQ', name: 'Gold 3x Leveraged ETC', type: 'ETF', exchange: 'LSE', currency: 'GBP' }];
const yq = [{ symbol: 'AAPL', longname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }, { symbol: 'BTC-USD', shortname: 'Bitcoin USD', exchDisp: 'CCC', quoteType: 'CRYPTOCURRENCY' }, { symbol: 'GC=F', shortname: 'Gold Dec 26', exchDisp: 'COMEX', quoteType: 'FUTURE' }, { symbol: 'XYZ', quoteType: 'OPTION' }];
let relayDown = false, hits = [];
const fetchImpl = async u => {
  hits.push(u); const url = new URL(u);
  if (url.pathname === '/yahoo-search') return relayDown ? new Response('{}', { status: 502 }) : new Response(JSON.stringify({ quotes: yq }));
  if (url.pathname === '/yahoo-intraday') return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'GBp', regularMarketPrice: 250, chartPreviousClose: 240, fullExchangeName: 'LSE', currentTradingPeriod: { regular: { start: 1, end: 2 } } }, timestamp: [10, 20, 30], indicators: { quote: [{ close: [100, null, 120] }] } }] } }));
  return new Response('{}', { status: 404 });
};
const call = async (path) => { const m = /^\/rest\/v1\/instruments\?(.*)$/.exec(path); if (!m) return { ok: false, status: 404 };
  const q = decodeURIComponent(m[1]); let rows = T212;
  const inM = /ticker=in\.\((.*?)\)&/.exec(q); if (inM) { const set = new Set(inM[1].split(',').map(x => x.replace(/"/g, ''))); rows = rows.filter(r => set.has(r.ticker)); }
  const ilike = /name\.ilike\.\*?"?\*?([^*"]+)\*/.exec(q); if (ilike && !inM) rows = rows.filter(r => (r.name + ' ' + (r.short_name || '')).toLowerCase().includes(ilike[1].trim().toLowerCase()));
  return { ok: true, status: 200, d: rows }; };
let analysed = 0; const ops = OPS.create({ store, call, token: 'J', relayUrl: 'https://relay', fetchImpl, analyse: async () => { analysed++; }, now: () => '2026-11-18T12:00:00Z' });
const sh = SH.create({ store, call, token: 'J', positions: async () => [], ops });
const post = async (route, body) => { const r = await sh.handle('/' + route, { method: 'POST', body: JSON.stringify(body) }); return [r.status, await r.json()]; };

let [st, d] = await post('search', { q: 'apple', category: 'stock' });
ok('stock search: only equities/ETFs from Yahoo, flagged with Trading 212 ticker', st === 200 && d.results.length === 1 && d.results[0].symbol === 'AAPL' && d.results[0].t212_ticker === 'AAPL_US_EQ' && d.results[0].group === 'market');
[st, d] = await post('search', { q: 'bitcoin', category: 'crypto' });
ok('crypto search adds a GBP variant of USD pairs', d.results.map(r => r.symbol).join() === 'BTC-USD,BTC-GBP');
[st, d] = await post('search', { q: 'gold', category: 'commodity' });
ok('commodity search: Trading 212 ETCs first (leveraged flagged), then futures', d.results[0].group === 't212' && d.results.some(r => r.leveraged) && d.results.some(r => r.group === 'market' && r.symbol === 'GC=F'));
relayDown = true; [st, d] = await post('search', { q: 'apple', category: 'stock' });
ok('relay down: falls back to Trading 212 list with a note', st === 200 && /unavailable/.test(d.note) && d.results[0].t212_ticker === 'AAPL_US_EQ'); relayDown = false;
[st, d] = await post('search', { q: 'a', category: 'stock' }); ok('short query returns nothing, bad category 400', d.results.length === 0 && (await post('search', { q: 'apple', category: 'bonds' }))[0] === 400);

[st, d] = await post('watchlist/add', { symbol: 'AAPL', category: 'stock' });
ok('add stores an encrypted watchlist row and queues analysis', st === 200 && d.analysis_queued && tables.watchlist.length === 1 && tables.watchlist[0].name === 'Apple Inc.' && tables.watchlist[0].t212_ticker === 'AAPL_US_EQ' && tables.watchlist[0].added_at === '2026-11-18T12:00:00Z');
await new Promise(r => setTimeout(r, 5)); ok('analysis was started in the background', analysed === 1);
[st, d] = await post('watchlist/add', { symbol: 'GC=F', category: 'commodity' });
ok('commodity future: name tidied, alternatives from Trading 212 exclude leveraged', tables.watchlist.find(r => r.ticker === 'GC=F').name === 'Gold (futures)' && d.alternatives.length === 1 && d.alternatives[0].ticker === 'SGLNl_EQ');
tables.watchlist[0].added_at = '2020-01-01T00:00:00Z'; await post('watchlist/add', { symbol: 'AAPL', category: 'stock' });
ok('re-adding keeps the original added_at', tables.watchlist.find(r => r.ticker === 'AAPL').added_at === '2020-01-01T00:00:00Z' && tables.watchlist.length === 2);
[st, d] = await post('watchlist/add', { symbol: 'NOPE.XX', category: 'stock' }); ok('unknown symbol → 404', st === 404 && /not found/i.test(d.error));
[st] = await post('watchlist/add', { symbol: 'bad symbol!', category: 'stock' }); ok('invalid symbol → 400 (nothing sent upstream)', st === 400);
[st, d] = await post('watchlist/remove', { symbol: 'AAPL' }); ok('remove deletes the item and its analysis', st === 200 && !tables.watchlist.some(r => r.ticker === 'AAPL'));
await post('watchlist/remove', { symbol: 'OLD' }); ok('remove clears analysis row', tables.watchlist_analysis.length === 0);

[st, d] = await post('chart', { symbol: 'VOD.L', range: '1d' });
ok('chart: pence → pounds, null closes dropped, meta mapped', st === 200 && JSON.stringify(d.points) === '[[10,1],[30,1.2]]' && d.meta.currency === 'GBP' && d.meta.price === 2.5 && d.meta.prev_close === 2.4 && d.interval === '5m' && d.meta.session.end === 2);
ok('chart: bad range / symbol rejected', (await post('chart', { symbol: 'VOD.L', range: '10y' }))[0] === 400 && (await post('chart', { symbol: '../x', range: '1d' }))[0] === 400);
ok('GET on these routes is refused; without ops they say not available', (await sh.handle('/chart')).status === 405 && (await SH.create({ store, call, token: 'J', positions: async () => [] }).handle('/chart', { method: 'POST', body: '{}' })).status === 501);
ok('every relay request used only the relay origin', hits.every(u => u.startsWith('https://relay/')));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
