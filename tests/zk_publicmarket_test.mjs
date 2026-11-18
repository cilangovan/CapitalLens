// Run: node tests/zk_publicmarket_test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import relay from '../cloudflare-worker/relay.js';
import { run } from '../scripts/public_market_job.mjs';
const M = createRequire(import.meta.url)('../docs/zk/market.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const cfg = JSON.parse(readFileSync(new URL('../config/popular_tickers.json', import.meta.url)));
ok('curated list is valid: unique, relay-safe symbols, known ranges', new Set(cfg.symbols).size === cfg.symbols.length && cfg.symbols.every(s => /^[A-Za-z0-9.^=\-]{1,24}$/.test(s)) && cfg.ranges.every(r => ['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'].includes(r)) && cfg.symbols.length > 50);
const sql = readFileSync(new URL('../db/tenant/12_market_cache.sql', import.meta.url), 'utf8');
ok('cache table: RLS on, read for signed-in users only, no user_id column, no write policy', /enable row level security/.test(sql) && /for select to authenticated/.test(sql) && !/user_id/.test(sql) && !/for (insert|update|delete|all)/i.test(sql));
// job against mocked Yahoo through the real relay handler
const outbound = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://finance.yahoo.com/quote/AAPL')) return new Response('..."crumb":"CRUMB1"...', { headers: { 'set-cookie': 'A3=c; Path=/' } });
  outbound.push(String(url));
  if (url.includes('BADSYM')) return new Response('{}', { status: 404 });
  if (url.includes('/v8/finance/chart/')) return Response.json({ chart: { result: [{ meta: { symbol: 'X', currency: 'USD', regularMarketPrice: 1 }, timestamp: [1767225600], indicators: { quote: [{ close: [1], volume: [1], high: [1], low: [1] }], adjclose: [{ adjclose: [1] }] } }] } });
  if (url.includes('quoteSummary')) return Response.json({ quoteSummary: { result: [{ price: { shortName: 'X Corp', currency: 'USD' }, financialData: { recommendationKey: 'buy' } }] } });
  return new Response('{}', { status: 404 });
};
const saved = [];
const res = await run({ config: { ranges: ['1y', '5d'], symbols: ['AAA', '^GSPC', 'BADSYM'] }, relayFetch: r => relay.fetch(r), save: async row => saved.push(row), log: () => {}, sleep: async () => {}, pause: 0 });
const keys = saved.map(r => r.key);
ok('caches charts for every range, info+detail for equities only (not indices/FX/futures), skips failures without aborting', keys.includes('chart:AAA:1y') && keys.includes('chart:AAA:5d') && keys.includes('info:AAA') && keys.includes('detail:AAA') && keys.includes('chart:^GSPC:1y') && !keys.some(k => k.includes('info:^GSPC')) && !keys.some(k => k.includes('BADSYM')) && res.failed.length >= 2);
ok('rows hold raw public payloads only (no user fields)', saved.every(r => Object.keys(r).sort().join() === 'fetched_at,key,payload') && !JSON.stringify(saved).includes('user_id'));
ok('job talks only to Yahoo, never to a database or Trading 212', outbound.every(u => u.includes('yahoo.com')));
// browser reads the shared cache first, relay second
const now = Date.parse('2026-11-18T12:00:00Z'), relayCalls = [];
const store = { 'chart:AAA:1y': { payload: saved.find(r => r.key === 'chart:AAA:1y').payload, fetched_at: '2026-11-18T05:30:00Z' }, 'info:AAA': { payload: { shortName: 'Cached Corp' }, fetched_at: '2026-11-18T05:30:00Z' }, 'chart:OLD:1y': { payload: saved.find(r => r.key === 'chart:AAA:1y').payload, fetched_at: '2026-11-10T05:30:00Z' } };
let sharedCalls = 0; const call = async (u, o, t) => { sharedCalls++; const k = decodeURIComponent(u.split('key=eq.')[1].split('&')[0]); return { ok: true, json: async () => store[k] ? [store[k]] : [] }; };
const fetchImpl = async u => { relayCalls.push(u); return Response.json({ chart: { result: [{ meta: { symbol: 'RELAY', currency: 'USD' }, timestamp: [1767225600], indicators: { quote: [{ close: [5], volume: [1], high: [5], low: [5] }] } }] }, shortName: 'Relay Corp' }); };
const m = M.create({ relayUrl: 'https://relay.test', fetchImpl, shared: M.sharedCache(call, 'JWT', () => now, 48) });
const hit = await m.chart('AAA', '1y'), inf = await m.info('AAA');
ok('fresh cached symbol served from the shared table with no relay call', hit.close.join() === '1' && inf.shortName === 'Cached Corp' && relayCalls.length === 0);
const stale = await m.chart('OLD', '1y'), miss = await m.chart('RARE', '1y');
ok('stale or missing cache entries fall back to the relay (so unpopular tickers still work)', stale.close.join() === '5' && miss.close.join() === '5' && relayCalls.length === 2);
const broken = M.create({ relayUrl: 'https://relay.test', fetchImpl, shared: M.sharedCache(async () => { throw new Error('down'); }, 'JWT', () => now) });
ok('cache outage never breaks market data (falls back to relay)', (await broken.chart('ZZZ', '1y')).close.join() === '5');
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
