// Run: node tests/zk_notify_test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js'); require('../docs/zk/alertfmt.js');
const N = require('../docs/zk/notify.js'), AR = require('../docs/zk/alertreport.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const calls = []; const fetchImpl = async (url, o) => { calls.push({ url, o }); return { ok: calls.length !== 3, status: calls.length === 3 ? 503 : 200 }; };
const n = N.create({ topic: 'my-secret-topic-123', fetchImpl });
await n.notify({ title: '⚠️ Countries — 2 flags (dip, overweight)', body: '1. Taiwan\n• Weight: 38.00%', priority: 'high', tags: 'warning' });
const u = new URL(calls[0].url);
ok('POSTs plain text to ntfy.sh/<topic> (CORS simple request, no custom headers)', u.origin === 'https://ntfy.sh' && u.pathname === '/my-secret-topic-123' && calls[0].o.method === 'POST' && Object.keys(calls[0].o.headers).join() === 'Content-Type' && calls[0].o.headers['Content-Type'].startsWith('text/plain'));
ok('title (with emoji and dash), priority and tag travel as query parameters; body is the message', u.searchParams.get('title') === '⚠️ Countries — 2 flags (dip, overweight)' && u.searchParams.get('priority') === 'high' && u.searchParams.get('tags') === 'warning' && calls[0].o.body.includes('38.00%'));
await n.notify({ title: 'x', body: 'y', priority: 'bogus' });
ok('unknown priority falls back to default', new URL(calls[1].url).searchParams.get('priority') === 'default');
let err = null; try { await n.notify({ title: 't', body: 'b' }); } catch (e) { err = e; }
ok('HTTP failure raises an error the app can show', err && /503/.test(err.message));
await n.notify({ title: 't', body: ('é'.repeat(100) + '\n').repeat(60) });
ok('oversize message is trimmed under ntfy limit', new TextEncoder().encode(calls[3].o.body).length < 4096);
ok('bad topics rejected (too short, spaces, slashes, URL injection)', ['', 'abc', 'my topic here', 'a/b/c/d/e/f', '../x?x=1&yyyy'].every(t => { try { N.create({ topic: t }); return false; } catch (e) { return true; } }));
const rows = {}; const store = { put: async (k, r, ko) => r.forEach(x => { rows[k + '|' + ko(x)] = x; }), get: async (k, key) => rows[k + '|' + key] || null };
ok('no saved topic -> no notifier', (await N.fromStore(store, fetchImpl)) === null);
await N.saveTopic(store, '  stored-topic-456 ');
let bad = null; try { await N.saveTopic(store, 'no good'); } catch (e) { bad = e; }
const m = await N.fromStore(store, fetchImpl); await m.notify({ title: 'a', body: 'b' });
ok('topic is saved in the encrypted store (trimmed), invalid topics are refused, saved topic is used', bad && new URL(calls[calls.length - 1].url).pathname === '/stored-topic-456' && !JSON.stringify(rows).includes('no good'));
const out = await AR.run({ store: { load: async k => ({ portfolio_snapshots: [{ id: 's', created_at: '2026-11-18T08:00:00Z', raw: { pies: [{ name: 'P', value: 10, instruments: [{ ticker: 'VUSAl_EQ', current: 0.7, expected: 0.5 }] }], instrument_meta: {} } }], positions: [{ snapshot_id: 's', ticker: 'VUSAl_EQ', exchange: 'LSE', current_price: 80, avg_price: 70 }], alerts: [] })[k] || [], put: async () => {}, remove: async () => {} },
  market: { chart: async () => null }, notify: m.notify }, new Date('2026-11-18T12:30:00Z'));
ok('alert report pushes flow through notify to ntfy', out.pushes.length === 1 && decodeURIComponent(calls[calls.length - 1].url.replace(/\+/g, ' ')).includes('P — 1 flag (overweight)'));
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
