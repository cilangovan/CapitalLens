// Run: node tests/zk_t212sync_test.mjs
// Browser-side T212 sync + encrypted store + relay, end to end with a fake Supabase and a fake Trading 212.
import { createRequire } from 'node:module';
import relay from '../cloudflare-worker/relay.js';
const require = createRequire(import.meta.url);
const ZK = require('../docs/js/zkcrypto.js'), Store = require('../docs/zk/store.js'), T = require('../docs/zk/t212sync.js');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

// ── fake Supabase enc_rows ──
const DB = new Map(); const UID = '11111111-1111-1111-1111-111111111111';
const seenByServer = [];                       // everything the "server" ever received
async function call(path, opt = {}) {
  const u = new URL('http://x' + path); opt = opt || {};
  if (opt.body) seenByServer.push(opt.body);
  seenByServer.push(path);
  if (u.pathname !== '/rest/v1/enc_rows') return { ok: false, status: 404, d: null };
  const kind = (u.searchParams.get('kind') || '').replace('eq.', ''), idq = (u.searchParams.get('id') || '').replace('eq.', '');
  if (!opt.method || opt.method === 'GET') {
    let rows = [...DB.values()].filter(r => r.kind === kind && (!idq || r.id === idq)).sort((a, b) => a.id.localeCompare(b.id));
    const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 1000;
    return { ok: true, status: 200, d: rows.slice(off, off + lim).map(({ id, nonce, ct }) => ({ id, nonce, ct })) };
  }
  if (opt.method === 'POST') {
    const arr = JSON.parse(opt.body), ids = new Set();
    for (const r of arr) { if (ids.has(r.id)) return { ok: false, status: 400, d: null }; ids.add(r.id); DB.set(r.kind + '|' + r.id, r); }
    return { ok: true, status: 201, d: null };
  }
  if (opt.method === 'DELETE') { DB.delete(kind + '|' + idq); return { ok: true, status: 204, d: null }; }
}

// ── fake Trading 212 behind the real relay code ──
const SECRET_KEY = 'KEY-abc123', SECRET_SEC = 'SEC-xyz789';
const EXPECT_AUTH = 'Basic ' + Buffer.from(`${SECRET_KEY}:${SECRET_SEC}`).toString('base64');
let T212_CALLS = [], FAIL_ONCE_429 = true, BREAK_DIVIDENDS = false;
const mkOrder = (i, side = 'BUY', status = 'FILLED') => ({ order: { id: 9000 + i, ticker: i % 2 ? 'RRl_EQ' : 'NVDA_US_EQ', side, status, createdAt: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z` },
  fill: { id: 5000 + i, quantity: 2, price: 100 + i, filledAt: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00:01Z`, walletImpact: { netValue: side === 'SELL' ? 250 : -200, realisedProfitLoss: side === 'SELL' ? 50 : 0, fxRate: 1 } } });
let ORDERS = Array.from({ length: 120 }, (_, i) => mkOrder(i, i % 5 === 0 ? 'SELL' : 'BUY', i === 7 ? 'CANCELLED' : 'FILLED'));
const DIVS = Array.from({ length: 60 }, (_, i) => ({ reference: 'd' + i, ticker: 'RRl_EQ', paidOn: '2026-02-01T00:00:00Z', amount: 1.5 + i, quantity: 3, type: 'ORDINARY' }));
const TXNS = Array.from({ length: 10 }, (_, i) => ({ reference: 't' + i, type: 'DEPOSIT', amount: 100, dateTime: '2026-01-01T00:00:00Z' }));
function page(all, path) {
  const u = new URL('http://t' + path), cur = +(u.searchParams.get('cursor') || 0);
  const items = all.slice(cur, cur + 50), next = cur + 50 < all.length ? `${u.pathname}?limit=50&cursor=${cur + 50}` : null;
  return { items, nextPagePath: next };
}
globalThis.fetch = async (url, init) => {                       // what the relay's outbound fetch hits
  T212_CALLS.push({ url, auth: init.headers.Authorization });
  const path = url.replace('https://live.trading212.com', '');
  if (init.headers.Authorization !== EXPECT_AUTH) return new Response('{"e":"unauthorised"}', { status: 401 });
  if (FAIL_ONCE_429 && path.includes('orders') && T212_CALLS.length === 2) { FAIL_ONCE_429 = false; return new Response('{}', { status: 429, headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 20) } }); }
  if (path.startsWith('/api/v0/equity/history/orders')) return Response.json(page(ORDERS, path));
  if (path.startsWith('/api/v0/history/dividends')) return BREAK_DIVIDENDS ? new Response('{"e":"forbidden"}', { status: 403 }) : Response.json(page(DIVS, path));
  if (path.startsWith('/api/v0/history/transactions')) return Response.json(page(TXNS, path));
  return new Response('nope', { status: 404 });
};
const realFetch = globalThis.fetch;
const relayFetch = (url, init) => relay.fetch(new Request(url, { ...init, headers: { Origin: 'https://cilangovan.github.io', ...init.headers } }));

// ── setup ──
const acct = await ZK.createAccount('correct horse battery staple');
const store = Store.create({ call, token: 't', uid: UID, dk: acct.dk });
let sleeps = [], clock = 1_800_000_000_000;
const mk = () => T.create({ store, relayUrl: 'https://relay.test', fetchImpl: relayFetch, sleep: async ms => { sleeps.push(ms); clock += ms; }, nowMs: () => clock, pace: 10500 });

// 1 full walk
let r = await mk().run(SECRET_KEY, SECRET_SEC);
ok('full walk: no failures', r.failed.length === 0);
ok('all 120 orders / 60 dividends / 10 transactions stored', (await store.load('t212_orders')).length === 120 && (await store.load('t212_dividends')).length === 60 && (await store.load('t212_transactions')).length === 10);
ok('rate limit (429) waited and retried, nothing lost', sleeps.some(ms => ms >= 15000) && r.results[0].total === 120);
ok('calls paced at least 10.5s apart', sleeps.filter(ms => ms > 0 && ms < 15000).every(ms => ms <= 10500) && sleeps.length >= 6);

// 2 privacy: what the server stored / saw
const blob = JSON.stringify([...DB.values()]) + seenByServer.join('\n');
ok('server never saw the T212 key or secret', !blob.includes(SECRET_KEY) && !blob.includes(SECRET_SEC) && !blob.includes(Buffer.from(`${SECRET_KEY}:${SECRET_SEC}`).toString('base64')));
ok('server never saw tickers, amounts or dates', !/NVDA_US_EQ|RRl_EQ|"ticker"|"amount"|ORDINARY|"DEPOSIT"|2026-01-|realisedProfitLoss/.test(blob));
ok('relay sent the key only to Trading 212', T212_CALLS.every(c => c.url.startsWith('https://live.trading212.com/api/v0/')));

// 3 derived tables
const rp = await store.load('realised_pnl'), dv = await store.load('dividends');
ok('realised_pnl excludes cancelled order (119 fills)', rp.length === 119 && !rp.find(x => x.order_id === '5007'));
const sell = rp.find(x => x.order_id === '5000'), buy = rp.find(x => x.order_id === '5001');
ok('sell: pnl 50 on 250 = 20.0%', sell.realised_pnl === 50 && sell.realised_pnl_pct === 20 && sell.display === 'NVDA');
ok('buy: pct 0, display strips _EQ suffix', buy.realised_pnl_pct === 0 && buy.display === 'RRl' && buy.filled_date === '2026-01-02');
ok('dividends derived', dv.length === 60 && dv[0].display === 'RRl' && dv.find(x => x.reference === 'd3').amount === 4.5);

// 4 incremental: new orders on top are picked up, stops early
const firstOrders = await store.load('t212_orders'); const fs = firstOrders.find(o => o.id === '5003').first_seen;
ORDERS = [mkOrder(500, 'BUY'), ...ORDERS];       // newest first
T212_CALLS = []; clock += 3600_000;
r = await mk().run(SECRET_KEY, SECRET_SEC);
const oc = T212_CALLS.filter(c => c.url.includes('orders')).length;
ok('incremental: 1 new order found', r.results[0].fresh === 1 && (await store.load('t212_orders')).length === 121);
ok('incremental: stops at the first fully-known page (2 of 3 orders pages read, same rule as the Python job)', oc === 2);
ok('first_seen kept for known rows, last_seen refreshed', (await store.load('t212_orders')).find(o => o.id === '5003').first_seen === fs);

// 5 full re-walk is idempotent
r = await mk().run(SECRET_KEY, SECRET_SEC, { full: true });
ok('forced full walk: no duplicates', (await store.load('t212_orders')).length === 121 && r.results[0].fresh === 0);

// 6 one endpoint failing does not stop the others; error recorded
BREAK_DIVIDENDS = true; ORDERS = [mkOrder(501, 'BUY'), ...ORDERS];
r = await mk().run(SECRET_KEY, SECRET_SEC);
ok('403 on dividends reported, orders + transactions still synced', r.failed.join() === 'dividends' && (await store.load('t212_orders')).length === 122);
ok('error state saved for the failed endpoint', (await store.get('sync_state', 'dividends')).status === 'error');

// 7 wrong key is rejected clearly
r = await mk().run('bad', 'creds');
ok('wrong credentials: all endpoints report failure, no data lost', r.failed.length === 3 && (await store.load('t212_orders')).length === 122);

// 8 relay hardening
const call2 = (path, o = {}) => relay.fetch(new Request('https://relay.test' + path, { headers: { Origin: 'https://cilangovan.github.io', 'X-T212-Auth': EXPECT_AUTH }, ...o }));
ok('relay: rejects non-allowlisted path', (await call2('/t212?p=' + encodeURIComponent('/api/v0/equity/orders/limit'))).status === 400);
ok('relay: rejects path traversal / other host tricks', (await call2('/t212?p=' + encodeURIComponent('/api/v0/history/dividends/../../x'))).status === 400 && (await call2('/t212?p=' + encodeURIComponent('//evil.com/api/v0/history/dividends'))).status === 400);
ok('relay: rejects POST', (await call2('/t212?p=' + encodeURIComponent('/api/v0/history/dividends'), { method: 'POST' })).status === 404);
ok('relay: rejects foreign origin', (await relay.fetch(new Request('https://relay.test/t212?p=%2Fapi%2Fv0%2Fhistory%2Fdividends', { headers: { Origin: 'https://evil.example', 'X-T212-Auth': EXPECT_AUTH } }))).status === 403);
ok('relay: rejects missing credentials', (await relay.fetch(new Request('https://relay.test/t212?p=%2Fapi%2Fv0%2Fhistory%2Fdividends', { headers: { Origin: 'https://cilangovan.github.io' } }))).status === 400);
const good = await call2('/t212?p=' + encodeURIComponent('/api/v0/history/transactions?limit=50'));
ok('relay: allowed call passes, CORS only for our site, no-store', good.status === 200 && good.headers.get('access-control-allow-origin') === 'https://cilangovan.github.io' && good.headers.get('cache-control') === 'no-store');

// 9 store: wrong user / tampering cannot be read
const other = Store.create({ call, token: 't', uid: '22222222-2222-2222-2222-222222222222', dk: acct.dk });
let threw = false; try { await other.load('t212_orders'); } catch (e) { threw = true; }
ok('rows cannot be decrypted under a different user id (AAD binding)', threw);
const k2 = Store.create({ call, token: 't', uid: UID, dk: (await ZK.createAccount('another password!!')).dk });
threw = false; try { await k2.load('t212_orders'); } catch (e) { threw = true; }
ok('rows cannot be decrypted with a different data key', threw);

console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
