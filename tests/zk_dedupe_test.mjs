// Run: node tests/zk_dedupe_test.mjs  — duplicate repair on a fake enc_rows table that reproduces the production bug.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ZK = require('../docs/js/zkcrypto.js'); globalThis.ZK = ZK; const Store = require('../docs/zk/store.js'); globalThis.ZKStore = Store; const D = require('../docs/zk/dedupe.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : (fail++, console.log('  ✗ ' + n)); if (c) console.log('  ✓ ' + n); };
const UID = '11111111-1111-1111-1111-111111111111', DB = new Map(); let failDelete = false;
async function call(path, opt = {}) {
  const u = new URL('http://x' + path); opt = opt || {}; if (u.pathname !== '/rest/v1/enc_rows') return { ok: false, status: 404 };
  const kind = (u.searchParams.get('kind') || '').replace('eq.', ''), idq = u.searchParams.get('id') || '';
  if (!opt.method || opt.method === 'GET') { const rows = [...DB.values()].filter(r => r.kind === kind && (!idq || r.id === idq.replace('eq.', ''))).sort((a, b) => a.id.localeCompare(b.id)); const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 1000; return { ok: true, status: 200, d: rows.slice(off, off + lim).map(({ id, nonce, ct }) => ({ id, nonce, ct })) }; }
  if (opt.method === 'POST') { for (const r of JSON.parse(opt.body)) DB.set(r.kind + '|' + r.id, r); return { ok: true, status: 201 }; }
  if (opt.method === 'DELETE') { if (failDelete) return { ok: false, status: 500 }; const m = idq.match(/^in\.\((.*)\)$/); const ids = m ? m[1].split(',') : [idq.replace('eq.', '')]; ids.forEach(i => DB.delete(kind + '|' + i)); return { ok: true, status: 204 }; }
}
const acct = await ZK.createAccount('correct horse battery staple'), dk = acct.dk, ctx = { call, token: 't', uid: UID, dk };
const store = Store.create(ctx), uuid = () => crypto.randomUUID();
async function migrateRandom(kind, rows) { for (const row of rows) { const id = uuid(), b = await ZK.encryptRow(dk, row, kind, id, UID); DB.set(kind + '|' + id, { kind, id, nonce: b.nonce, ct: b.ct }); } }
const orders = Array.from({ length: 120 }, (_, i) => ({ id: 'f' + i, ticker: 'X', last_seen: 'old' }));
await migrateRandom('t212_orders', orders);                                                    // migration: random ids
await migrateRandom('holding_decisions', [{ report_date: '2026-11-17', ticker: 'A' }, { report_date: '2026-11-17', ticker: 'B' }]);
await migrateRandom('returns_summary', [{ xirr: 0.1 }]);
await store.put('t212_orders', orders.slice(0, 50).map(o => ({ ...o, last_seen: 'new' })), r => r.id);   // re-sync: deterministic ids -> duplicates of 50
await store.put('holding_decisions', [{ report_date: '2026-11-17', ticker: 'A', verdict: 'hold' }], r => r.report_date + '|' + r.ticker);
await store.put('returns_summary', [{ xirr: 0.2 }], () => 'main');
const count = k => [...DB.values()].filter(r => r.kind === k).length;
ok('bug reproduced: 170 order rows for 120 orders', count('t212_orders') === 170);
const d = D.create(ctx), before = JSON.stringify([...DB.keys()].sort());
const rep = await d.scan(), o = rep.find(r => r.kind === 't212_orders');
ok('scan reports surplus 50 and changes nothing', o.total === 170 && o.distinct === 120 && o.surplus === 50 && JSON.stringify([...DB.keys()].sort()) === before);
failDelete = true; let threw = false; try { await d.fix(); } catch (e) { threw = true; }
ok('a failed delete aborts loudly, and every logical row is still present', threw && [...new Set((await store.load('t212_orders')).map(r => r.id))].length === 120);
failDelete = false; const logs = []; await d.fix(m => logs.push(m));
ok('orders: 120 rows, one per order', count('t212_orders') === 120 && (await store.load('t212_orders')).length === 120);
const live = await store.load('t212_orders');
ok('newest copy kept where both existed; untouched rows kept', live.filter(r => r.last_seen === 'new').length === 50 && live.filter(r => r.last_seen === 'old').length === 70);
ok('holding_decisions 2 rows, newest version of A kept', count('holding_decisions') === 2 && (await store.load('holding_decisions')).find(r => r.ticker === 'A').verdict === 'hold');
ok('singleton kinds collapse to one row, newest value', count('returns_summary') === 1 && (await store.load('returns_summary'))[0].xirr === 0.2);
ok('every remaining row now has its deterministic id', (await Promise.all(live.map(r => store.get('t212_orders', r.id)))).every(Boolean));
const again = await d.fix(); ok('second run is a no-op', again.filter(r => r.before !== undefined).every(r => r.before === r.after) && count('t212_orders') === 120);
ok('a later re-sync adds no duplicates', await (async () => { await store.put('t212_orders', orders.slice(0, 50), r => r.id); return count('t212_orders') === 120; })());
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
