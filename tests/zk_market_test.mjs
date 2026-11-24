// Run: node tests/zk_market_test.mjs
import { createRequire } from 'node:module';
import relay from '../cloudflare-worker/relay.js';
const M = createRequire(import.meta.url)('../docs/zk/market.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
let outbound = [], busy = 0, maxBusy = 0;
let sessionFetches = 0, qsAuth = [];
const baseFetch = async (url, init) => {
  if (url.startsWith('https://finance.yahoo.com/quote/AAPL')) { sessionFetches++; return new Response('<html>..."crumb":"AbC\\u002F123"...</html>', { headers: { 'set-cookie': 'A3=cookieval; Path=/; Secure' } }); }
  if (url.includes('/v10/finance/quoteSummary/')) { qsAuth.push({ url, cookie: init.headers.Cookie }); return Response.json({ quoteSummary: { result: [{ assetProfile: { sector: 'Technology' }, price: { longName: 'NVIDIA Corporation', shortName: 'NVIDIA', currency: 'USD', regularMarketPrice: { raw: 150 } }, financialData: { targetMeanPrice: { raw: 200 }, currentPrice: { raw: 151 } } }] } }); }
  return null;
};
globalThis.fetch = async (url, init) => {
  const b = await baseFetch(url, init); if (b) return b;
  outbound.push({ url, init }); busy++; maxBusy = Math.max(maxBusy, busy); await new Promise(r => setTimeout(r, 15)); busy--;
  if (url.includes('BAD')) return new Response('{}', { status: 404 });
  if (url.includes('/v1/finance/search')) return Response.json({ news: [{ title: 'Stocks rally' }, { title: 'Fed holds' }, { uuid: 'x' }], quotes: [{ symbol: 'SECRET' }] });
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
// ── yahoo-info (sector / target price / names) ──
const inf = await m.info('NVDA');
ok('info: trimmed to sector, names, target, current price, currency', inf.sector === 'Technology' && inf.longName === 'NVIDIA Corporation' && inf.targetMeanPrice === 200 && inf.currentPrice === 151 && inf.currency === 'USD');
await m.info('AMD'); ok('crumb session reused across symbols (one session fetch)', sessionFetches === 1);
ok('crumb sent with the session cookie, slash decoded', qsAuth[0].cookie === 'A3=cookieval' && qsAuth[0].url.includes('crumb=AbC%2F123'));
ok('relay rejects bad symbol on /yahoo-info', (await r('/yahoo-info?s=' + encodeURIComponent('X/../y'))).status === 400);
const nw = await m.headlines('SPY'); ok('news: titles only (no quotes/ids), through the relay', nw.join('|') === 'Stocks rally|Fed holds');
ok('relay rejects bad symbol on /yahoo-news', (await r('/yahoo-news?s=' + encodeURIComponent('A?x=1'))).status === 400);
{ // a hung relay call is aborted after timeoutMs, so one slow ticker cannot stall a whole refresh
  const hang = (url, o) => new Promise((res, rej) => { o && o.signal && o.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  const mh = M.create({ relayUrl: 'https://relay.test', fetchImpl: hang, timeoutMs: 30, retryMs: 1 }); const t0 = Date.now();
  const r = await mh.chart('HANG', '1y'), inf = await mh.info('HANG');
  ok('hung relay request is aborted (chart -> null, info -> {}) instead of hanging', r === null && inf && typeof inf === 'object' && Date.now() - t0 < 2000);
}
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
