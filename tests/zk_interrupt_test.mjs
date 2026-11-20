// Run: node tests/zk_interrupt_test.mjs
// A browser refresh (or closing the tab / losing signal) while a refresh is running kills the run part-way. Nothing may be left corrupt or half-shown,
// and the next refresh must finish the job. We simulate the kill by making the Nth write/fetch throw, then run again and compare with a clean run.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../docs/zk/alertfmt.js'); const T = require('../docs/zk/t212sync.js'), M = require('../docs/zk/monitor.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

// in-memory store with the same put/get/load contract as docs/zk/store.js, plus a kill switch (the page is gone: later writes never happen)
function mkStore() {
  const rows = new Map(), s = { rows, puts: [], killAt: null, kind: null };
  const bucket = k => { if (!rows.has(k)) rows.set(k, new Map()); return rows.get(k); };
  s.put = async (kind, arr, keyOf) => {
    if (s.killAt && kind === s.killAt.kind && s.killAt.n-- <= 0) throw new Error('killed: page reloaded');
    for (const r of arr) bucket(kind).set(String(keyOf(r)), JSON.parse(JSON.stringify(r))); s.puts.push(kind); return arr.length;
  };
  s.get = async (kind, id) => bucket(kind).get(String(id)) || null;
  s.load = async kind => [...bucket(kind).values()].map(r => JSON.parse(JSON.stringify(r)));
  s.del = async (kind, id) => { bucket(kind).delete(String(id)); };
  return s;
}

// ── 1. Portfolio snapshot: a snapshot must never be visible without ALL its positions (dashboards read positions by the latest snapshot id) ──
const POS = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${i}_US_EQ`, quantity: 2, averagePrice: 100, currentPrice: 110 + i, ppl: 20 + i }));
const apiMon = { '/api/v0/equity/account/cash': { total: 5000, free: 100, invested: 4000, ppl: 400 }, '/api/v0/equity/portfolio': POS, '/api/v0/equity/pies': [] };
const monClient = { setCreds() {}, clear() {}, get: async p => { const k = p.split('?')[0]; if (k in apiMon) return apiMon[k]; throw new Error('404 ' + k); } };
let runNo = 0;
const runMon = store => M.create({ store, client: monClient, nowDate: () => new Date(Date.UTC(2026, 10, 20, 9, ++runNo)), newId: (() => { let n = 0; return () => 'id' + (++n) + Math.random().toString(36).slice(2, 6); })() }).run('k', 's');
const visible = async store => { const snaps = await store.load('portfolio_snapshots'), pos = await store.load('positions'); return snaps.map(sn => ({ id: sn.id, n: pos.filter(p => p.snapshot_id === sn.id).length })); };

for (const kind of ['positions', 'alerts', 'monitor_state', 'portfolio_snapshots']) {
  const st = mkStore(); st.killAt = { kind, n: 0 };
  let died = false; try { await runMon(st); } catch (e) { died = true; }
  const v = await visible(st);
  ok(`killed while writing ${kind}: ${died ? '' : '(run finished, kill never reached) '}no snapshot is visible with missing positions`, v.every(x => x.n === POS.length));
  st.killAt = null; await runMon(st);
  const v2 = await visible(st), latest = (await st.load('portfolio_snapshots')).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).pop();
  ok(`  …then a normal refresh: the latest snapshot has all ${POS.length} positions`, v2.find(x => x.id === latest.id).n === POS.length && v2.every(x => x.n === POS.length));
}

// ── 2. Trading 212 history: killed between pages, the next refresh must still fetch the pages that were missed ──
const mkOrder = i => ({ order: { id: 9000 + i, ticker: 'NVDA_US_EQ', side: 'BUY', status: 'FILLED', createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString() },
  fill: { id: 5000 + i, quantity: 1, price: 100 + i, filledAt: new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString(), walletImpact: { netValue: -100, realisedProfitLoss: 0, fxRate: 1 } } });
let ORDERS = [];                                              // newest first, like the real API
const pageOf = (all, path) => { const cur = +(new URL('http://t' + path).searchParams.get('cursor') || 0); const items = all.slice(cur, cur + 50); return { items, nextPagePath: cur + 50 < all.length ? `/api/v0/equity/history/orders?limit=50&cursor=${cur + 50}` : null }; };
let killOnOrderCursor = null;
const t212Client = { setCreds() {}, clear() {}, nowMs: () => Date.parse('2026-11-20T09:00:00Z'),
  get: async path => { if (path.includes('/equity/history/orders')) { const cur = +(new URL('http://t' + path).searchParams.get('cursor') || 0); if (killOnOrderCursor === cur) throw new Error('killed: page reloaded'); return pageOf(ORDERS, path); } return { items: [], nextPagePath: null }; } };
const sync = store => T.create({ store, client: t212Client, now: () => '2026-11-20T09:00:00Z' }).run('k', 's');

ORDERS = Array.from({ length: 120 }, (_, i) => mkOrder(119 - i));                   // 120 orders already stored from an earlier refresh
const st2 = mkStore(); await sync(st2);
ok('baseline: 120 orders stored after the first full walk', (await st2.load('t212_orders')).length === 120);
ORDERS = [...Array.from({ length: 60 }, (_, i) => mkOrder(179 - i)), ...ORDERS];    // 60 new orders arrive: the new ones fill page 1 and part of page 2
killOnOrderCursor = 50;                                                              // the page is reloaded after page 1 was stored, before page 2 was read
const r1 = await sync(st2);
ok('killed between pages: that refresh reports the orders step as failed (not silently ok)', r1.failed.includes('orders'));
killOnOrderCursor = null; await sync(st2);
const got = new Set((await st2.load('t212_orders')).map(o => o.id));
ok('next refresh picks up the page that was missed: all 180 orders stored', got.size === 180 && ORDERS.every(o => got.has(String(o.fill.id))));
await sync(st2);
ok('and a further refresh changes nothing (idempotent, no duplicates)', (await st2.load('t212_orders')).length === 180);
const state = await st2.get('sync_state', 'orders');
ok('the resume marker is cleared once the catch-up finishes', state && state.status === 'ok' && !state.resume);

// killed during a very first full walk: still resumes as a full walk (existing behaviour, keep it)
ORDERS = Array.from({ length: 120 }, (_, i) => mkOrder(119 - i));
const st3 = mkStore(); killOnOrderCursor = 50; await sync(st3); killOnOrderCursor = null; await sync(st3);
ok('first walk interrupted: the next refresh completes all 120 orders', (await st3.load('t212_orders')).length === 120);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
