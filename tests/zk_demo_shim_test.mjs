// Demo shim: /chart is served from stored mock series (sliced per range), intraday/search are refused, and IPO + flow-report routes are
// redirected to the demo-only tables so nothing invented lives in tables the private app reads. Run: node tests/zk_demo_shim_test.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../docs/demo/demo-shim.js', import.meta.url), 'utf8');
const calls = [];
const pts = Array.from({ length: 300 }, (_, i) => [1700000000 + i * 86400, 100 + i]);
const inner = async (url, init) => { calls.push(String(url)); 
  if (String(url).includes('/demo_market_cache')) return String(url).includes('NOPE') ? new Response('[]', { status: 200 }) : new Response(JSON.stringify([{ payload: { points: pts, meta: { demo: true } } }]), { status: 200 });
  return new Response('[]', { status: 200 }); };
const win = { fetch: inner }; const ctx = vm.createContext({ window: win, PROXY: 'https://x.supabase.co/rest/v1', SUPABASE_KEY: 'k', SESSION_TOKEN: 't', Response, Headers, console, encodeURIComponent });
vm.runInContext(src, ctx);
const f = win.fetch, P = 'https://x.supabase.co/rest/v1';
const chart = (symbol, range) => f(`${P}/chart`, { method: 'POST', body: JSON.stringify({ symbol, range }) });
let r = await chart('^GSPC', '1mo'); assert.equal(r.status, 200); assert.equal((await r.json()).points.length, 22);
r = await chart('^GSPC', '1y'); assert.equal((await r.json()).points.length, 252);
r = await chart('^GSPC', '1d'); assert.equal(r.status, 501, 'intraday refused honestly');
r = await chart('NOPE', '1y'); assert.equal(r.status, 404, 'unknown symbol is a clear 404, not fake data');
calls.length = 0; await f(`${P}/ipo_calendar?select=*&limit=500`); assert.ok(calls[0].includes('/demo_ipo_calendar?select=*'), 'IPO calendar read goes to the demo-only table');
calls.length = 0; await f(`${P}/institutional_flow_reports?select=*&limit=1`); assert.ok(calls[0].includes('/demo_institutional_flow_reports?select=*'), 'flow reports go to the demo-only table');
r = await f(`${P}/ipo/watch`, { method: 'POST' }); assert.equal(r.status, 501);
calls.length = 0; await f(`${P}/market_cache?select=*`); assert.ok(!calls[0].includes('demo_'), 'other tables untouched');
console.log('zk_demo_shim_test: all passed');
