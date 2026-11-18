// Run: node tests/zk_market_test.mjs
import { createRequire } from 'node:module';
import relay from '../cloudflare-worker/relay.js';
const M = createRequire(import.meta.url)('../docs/zk/market.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let outbound = [], busy = 0, maxBusy = 0;
globalThis.fetch = async (url, init) => {
  outbound.push({ url, init }); busy++; maxBusy = Math.max(maxBusy, busy); await new Promise(r => setTimeout(r, 15)); busy--;
  if (url.includes('BAD')) return new Response('{}', { status: 404 });
  return Response.json({ chart: { result: [{ meta: { symbol: 'NVDA', currency: 'USD', regularMarketPrice: 150 }, timestamp: [1767225600, 1767312000, 1767398400],
    indicators: { quote: [{ close: [100, null, 102], volume: [10, 11, 12], high: [101, 0, 103], low: [99, 0, 100] }], adjclose: [{ adjclose: [99, null, 101] }] },
    events: { splits: { a: { date: 1767225600, numerator: 10, denominator: 1 } } } }] } });
};
const via = (url, init) => relay.fetch(new Request(url, { ...init, headers: { Origin: 'https://cilangovan.github.io' } }));
const m = M.create({ relayUrl: 'https://relay.test', fetchImpl: via, concurrency: 2, retryMs: 5 });
const c = await m.chart('NVDA', '1y');
ok('chart parsed: skips null closes, adj close, split, price, currency', c.dates.length === 2 && c.close.join() === '100,102' && c.adjclose.join() === '99,101' && c.splits[0].ratio === 10 && c.price === 150 && c.currency === 'USD');
ok('relay called Yahoo chart only, with no credentials/cookies', outbound.length === 1 && outbound[0].url.startsWith('https://query1.finance.yahoo.com/v8/finance/chart/NVDA?') && !JSON.stringify(outbound[0].init.headers).match(/auth|cookie/i));
await m.chart('NVDA', '1y'); ok('second request for same symbol served from cache', outbound.length === 1);
await Promise.all(['A', 'B', 'C', 'D', 'E'].map(s => m.chart(s, '5y'))); ok('concurrency limit respected (max 2 in flight)', maxBusy <= 2);
ok('unknown symbol -> null, no crash', (await m.chart('BAD', '1y')) === null);
const r = p => via('https://relay.test' + p);
ok('relay rejects injection in symbol', (await r('/yahoo?s=' + encodeURIComponent('NVDA/../../x'))).status === 400 && (await r('/yahoo?s=' + encodeURIComponent('A?b=c'))).status === 400);
ok('relay rejects unknown range', (await r('/yahoo?s=NVDA&range=10000y')).status === 400);
ok('relay accepts index/FX symbols (^FTSE, GBPUSD=X, VUSA.L)', (await r('/yahoo?s=' + encodeURIComponent('^FTSE'))).status === 200 && (await r('/yahoo?s=GBPUSD%3DX')).status === 200 && (await r('/yahoo?s=VUSA.L')).status === 200);
ok('relay still rejects foreign origin on /yahoo', (await relay.fetch(new Request('https://relay.test/yahoo?s=NVDA', { headers: { Origin: 'https://evil.example' } }))).status === 403);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
