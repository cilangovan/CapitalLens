// Run: node tests/zk_store_cache_test.mjs  - refresh read cache: one fetch+decrypt per kind per refresh, never stale, never shared by reference.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ZK = require('../docs/js/zkcrypto.js'); globalThis.ZK = ZK; const Store = require('../docs/zk/store.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const UID = '22222222-2222-2222-2222-222222222222', DB = new Map(); let gets = 0;
async function call(path, opt = {}) {
  const u = new URL('http://x' + path); opt = opt || {}; const kind = (u.searchParams.get('kind') || '').replace('eq.', ''), idq = (u.searchParams.get('id') || '').replace('eq.', '');
  if (!opt.method || opt.method === 'GET') { gets++; const rows = [...DB.values()].filter(r => r.kind === kind && (!idq || r.id === idq)).sort((a, b) => a.id.localeCompare(b.id)); const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 1000; return { ok: true, status: 200, d: rows.slice(off, off + lim) }; }
  if (opt.method === 'POST') { for (const r of JSON.parse(opt.body)) DB.set(r.kind + '|' + r.id, r); return { ok: true, status: 201 }; }
  if (opt.method === 'DELETE') { for (const k of [...DB.keys()]) if (k === kind + '|' + idq) DB.delete(k); return { ok: true, status: 204 }; }
}
const acct = await ZK.createAccount('correct horse battery staple'), store = Store.create({ call, token: 't', uid: UID, dk: acct.dk });
await store.put('positions', [{ ticker: 'A', quantity: 1 }, { ticker: 'B', quantity: 2 }], r => r.ticker);
gets = 0; await store.load('positions'); await store.load('positions');
ok('cache is OFF by default: every read hits the database', gets === 2);
store.cache(true); gets = 0;
const [a, b] = await Promise.all([store.load('positions'), store.load('positions')]); await store.load('positions');
ok('cache ON: three reads of a kind (two concurrent) cost one fetch', gets === 1 && a.length === 2 && b.length === 2);
a[0].quantity = 999; a.reverse();
ok('callers get copies: editing/sorting one result does not leak into the next read', (await store.load('positions')).map(r => r.quantity).sort().join() === '1,2');
await store.put('positions', [{ ticker: 'C', quantity: 3 }], r => r.ticker);
ok('put drops that kind from the cache (no stale read after a write)', (await store.load('positions')).length === 3);
await store.remove('positions', 'C');
ok('remove drops that kind from the cache', (await store.load('positions')).length === 2);
gets = 0; await store.load('orders'); await store.load('positions');
ok('other kinds are cached separately', gets === 1);
store.cache(false); gets = 0; await store.load('positions'); await store.load('positions');
ok('cache OFF again: reads are fresh (nothing kept between refreshes)', gets === 2);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
