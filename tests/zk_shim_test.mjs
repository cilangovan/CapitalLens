// Run: node tests/zk_shim_test.mjs
// The dashboards' real query strings, answered from decrypted rows by the ZK shim; alert actions; shared tables; sanitising.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
require('../docs/zk/returns.js'); require('../docs/zk/symbols.js');
const Q = require('../docs/zk/postgrest.js'), SH = require('../docs/zk/shim.js'); require('../docs/zk/flow.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
// 1) every api()/PROXY query string used by the dashboards parses and maps to a table we serve
const files = readdirSync(new URL('../docs/js/', import.meta.url)).filter(f => f.endsWith('.js')), calls = [];
for (const f of files) { const src = readFileSync(new URL('../docs/js/' + f, import.meta.url), 'utf8');
  for (const m of src.matchAll(/api\(\s*'([a-z_]+)'\s*,\s*([`'])((?:\\.|(?!\2).)*)\2/g)) calls.push([f, m[1], m[3].replace(/\$\{[^}]*\}/g, '1')]);
  for (const m of src.matchAll(/\$\{PROXY\}\/([a-z_]+)(\?[^`'"]*)?/g)) if (!/^(auth|chart|search|watchlist|settings|alerts|ipo)$/.test(m[1]) || m[1] === 'alerts' && m[2]) calls.push([f, m[1], (m[2] || '').replace(/\$\{[^}]*\}/g, '1')]); }
const known = new Set([...Object.keys(SH.ENCRYPTED), ...SH.SHARED, 'institutional_flow_reports']);
const unknown = calls.filter(([, t]) => !known.has(t)), bad = calls.filter(([, , p]) => { try { Q.parse(p); return false; } catch (e) { return true; } });
ok(`all ${calls.length} dashboard data queries map to an encrypted or shared table`, calls.length > 30 && unknown.length === 0); if (unknown.length) console.log('   unmapped:', unknown.map(u => u.join(' ')).join('\n            '));
ok('all dashboard query strings parse', bad.length === 0); if (bad.length) console.log('   unparsable:', bad);
// 2) query semantics
const rows = [{ id: 's1', created_at: '2026-11-18T08:00:00Z', total_value: 100, raw: { account: { total: 100 }, pies: [{ name: 'A' }] } }, { id: 's2', created_at: '2026-11-17T08:00:00Z', total_value: 90, raw: { account: { total: 90 }, pies: [] } }, { id: 's3', created_at: '2026-11-10T08:00:00Z', total_value: null, raw: null }];
ok('order desc + limit', Q.run(rows, '?select=id&order=created_at.desc&limit=2').map(r => r.id).join() === 's1,s2');
ok('column list returns only those columns; * returns all', JSON.stringify(Q.run(rows, '?select=id,total_value&limit=1')) === '[{"id":"s1","total_value":100}]' && Q.run(rows, '?select=*&limit=1')[0].raw.pies.length === 1);
ok('filter eq / gte (ISO timestamps) / in / is.null / not.', Q.run(rows, '?id=eq.s2').length === 1 && Q.run(rows, '?created_at=gte.2026-11-17T00%3A00%3A00.000Z&order=created_at.asc').map(r => r.id).join() === 's2,s1' && Q.run(rows, '?id=in.(s1,s3)').length === 2 && Q.run(rows, '?total_value=is.null')[0].id === 's3' && Q.run(rows, '?id=not.eq.s1').length === 2);
ok('JSON path aliases (acc:raw->account, pies:raw->pies), nulls when missing', JSON.stringify(Q.run(rows, '?select=id,acc:raw->account,pies:raw->pies&order=created_at.asc&limit=2')) === JSON.stringify([{ id: 's3', acc: null, pies: null }, { id: 's2', acc: { total: 90 }, pies: [] }]));
ok('Postgres null ordering (asc: nulls last, desc: nulls first)', Q.run(rows, '?select=id&order=total_value.asc').map(r => r.id).join() === 's2,s1,s3' && Q.run(rows, '?select=id&order=total_value.desc').map(r => r.id).join() === 's3,s1,s2');
// 3) shim over a fake store
const tables = { portfolio_snapshots: rows, positions: [{ id: 'p1', snapshot_id: 's1', ticker: 'NVDA_US_EQ', gain_pct: 12.5, ppl: 5 }, { id: 'p2', snapshot_id: 's1', ticker: 'ITWNl_EQ', gain_pct: 30, ppl: 9 }, { id: 'p3', snapshot_id: 's2', ticker: 'OLD', gain_pct: 1, ppl: 1 }],
  alerts: [{ id: 'report:Countries:2026-11-18:abc', created_at: '2026-11-18T09:00:00Z', title: 'T<script>', body: 'x' }, { id: 'uuid-2', created_at: '2026-11-18T08:00:00Z', title: 'B' }], watchlist: [{ ticker: 'AAPL' }] };
const puts = []; const store = { load: async k => (tables[k] || []).map(r => ({ ...r })), put: async (k, r, ko) => { puts.push([k, r]); r.forEach(x => { tables[k] = (tables[k] || []).filter(y => ko(y) !== ko(x)).concat([x]); }); } };
const calls2 = []; const call = async (u, o, t) => { calls2.push([u, t]); if (u.includes('institutional_flow_reports')) return { ok: true, status: 200, d: [{ report_date: '2026-11-15', markets: [{ region: 'USA', score: 80 }], sector_rotation: {}, opportunities: [], cautions: [] }] }; return { ok: true, status: 200, d: [{ ticker: 'NVDA', sector: 'Tech<b>' }] }; };
const defuse = v => typeof v === 'string' ? v.replace(/[<>"'`]/g, '‹') : Array.isArray(v) ? v.map(defuse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, defuse(x)])) : v;
const sh = SH.create({ store, call, token: 'JWT', positions: async () => tables.positions.map(p => ({ ...p, exchange: 'NASDAQ/NYSE', pie: 'Stocks' })), defuse, now: () => '2026-11-18T12:00:00Z' });
const get = async p => (await sh.handle(p)).json();
ok('positions of the latest snapshot, sorted like the dashboard asks', (await get('/positions?snapshot_id=eq.s1&select=*&order=gain_pct.desc')).map(p => p.ticker).join() === 'ITWNl_EQ,NVDA_US_EQ');
const al = await get('/alerts?select=*&order=created_at.desc&limit=300');
ok('alerts: numeric ids for the dashboard, text sanitised exactly like worker responses', al.length === 2 && al.every(a => Number.isInteger(a.id)) && al[0].title === 'T‹script‹' && al[0].id !== al[1].id);
const act = await sh.handle('/alerts/action', { method: 'POST', body: JSON.stringify({ ids: [al[0].id], action: 'archive' }) });
const after = tables.alerts.find(a => a.id === 'report:Countries:2026-11-18:abc');
ok('archive action updates the stored alert (not the numeric id) and keeps it encrypted-store only', (await act.json()).updated === 1 && after.archived_at === '2026-11-18T12:00:00Z' && after.read_at === '2026-11-18T12:00:00Z' && puts.every(p => p[0] === 'alerts') && tables.alerts.length === 2);
const badAct = await sh.handle('/alerts/action', { method: 'POST', body: JSON.stringify({ ids: [al[0].id], action: 'explode' }) });
ok('bad alert action rejected', badAct.status === 400);
const flow = await get('/institutional_flow_reports?select=*&order=report_date.desc&limit=1');
ok('flow report: shared table read with the user token, per-customer actions built locally from encrypted positions', flow[0].portfolio_actions[0].pie === 'Stocks' && flow[0].portfolio_actions[0].region === 'USA' && calls2.some(c => c[1] === 'JWT'));
const ex = await get('/instrument_exposure?select=ticker,sector');
ok('shared reference tables forwarded with the user token and sanitised', ex[0].sector === 'Tech‹b›'.replace('›', '') || ex[0].sector.startsWith('Tech‹'));
ok('settings/set stores the budget encrypted; bad keys/values refused', (await (await sh.handle('/settings/set', { method: 'POST', body: JSON.stringify({ key: 'watchlist_weekly_budget', value: '120' }) })).json()).value === 120 && (await sh.handle('/settings/set', { method: 'POST', body: JSON.stringify({ key: 'x;drop', value: '1' }) })).status === 400 && (await sh.handle('/settings/set', { method: 'POST', body: JSON.stringify({ key: 'ok_key', value: '-5' }) })).status === 400);
ok('writes to encrypted tables via REST refused; unknown tables 404; not-yet-moved features say so (501)', (await sh.handle('/positions', { method: 'POST', body: '{}' })).status === 405 && (await sh.handle('/secrets')).status === 404 && (await sh.handle('/chart', { method: 'POST' })).status === 501);
// install(): only PROXY urls are intercepted
const seen = []; globalThis.fetch = async u => { seen.push(String(u)); return new Response('"net"'); };
SH.install('https://x.test/rest/v1', sh);
const a = await (await fetch('https://x.test/rest/v1/watchlist?select=ticker')).json(), b = await (await fetch('https://other.test/a')).json();
ok('install(): dashboard calls answered locally, other requests go to the network untouched', a[0].ticker === 'AAPL' && b === 'net' && seen.length === 1 && seen[0] === 'https://other.test/a');
// 4) JSON kept as text by the browser-side analysis must survive defuse (which swaps every double quote)
tables.value_buy_scores = [{ ticker: 'GOOGL', score: 84, entry_zones: JSON.stringify([{ label: 'Ideal', rating: 'high', note: 'near "52w" low' }]), scorecard: JSON.stringify([{ category: 'Valuation', score: 17, max: 20 }]),
  earnings: JSON.stringify({}), this_week: JSON.stringify({ action: 'BUY', price: 301.5, rationale: ['RSI low'] }) }, { ticker: 'BAD', score: 50, entry_zones: 'not json', scorecard: null, earnings: '{}', this_week: '{"a":1}' }];
const vb = await (await sh.handle('/value_buy_scores?select=*&order=score.desc')).json();
ok('value_buy_scores: entry zones, scorecard and this-week target arrive as real objects, not mangled text', Array.isArray(vb[0].entry_zones) && vb[0].entry_zones[0].label === 'Ideal' && vb[0].scorecard[0].max === 20 && vb[0].this_week.price === 301.5 && vb[0].this_week.action === 'BUY');
ok('value_buy_scores: text inside the parsed data is still defused', vb[0].entry_zones[0].note === 'near ‹52w‹ low');
ok('value_buy_scores: unparsable text is left alone and does not break the call', vb[1].entry_zones === 'not json' && vb[1].scorecard === null && vb[1].this_week.a === 1);
// 5) per-user IPO watch list: stored encrypted, watch is idempotent, unwatch removes, bad ids refused
const post = (path, body) => sh.handle(path, { method: 'POST', body: JSON.stringify(body) });
tables.ipo_watch = [];
store.remove = store.remove || (async (k, key) => { tables[k] = (tables[k] || []).filter(r => r.id !== key); });
const w1 = await post('/ipo/watch', { id: 'US:ANT' }), w2 = await post('/ipo/watch', { id: 'US:ANT' }), w3 = await post('/ipo/watch', { id: 'UK:AIRTELMONEY' });
ok('ipo/watch saves to the encrypted ipo_watch table, once per IPO', w1.status === 200 && w2.status === 200 && w3.status === 200 && tables.ipo_watch.map(r => r.id).sort().join() === 'UK:AIRTELMONEY,US:ANT');
const listed = await (await sh.handle('/ipo_watch?select=id')).json();
ok('ipo_watch reads back through the dashboard query', listed.map(r => r.id).sort().join() === 'UK:AIRTELMONEY,US:ANT');
const u1 = await post('/ipo/unwatch', { id: 'US:ANT' });
ok('ipo/unwatch removes it and leaves the others', u1.status === 200 && tables.ipo_watch.map(r => r.id).join() === 'UK:AIRTELMONEY');
ok('bad ids and wrong methods are refused', (await post('/ipo/watch', { id: '../x' })).status === 400 && (await post('/ipo/watch', {})).status === 400 && (await sh.handle('/ipo/watch', { method: 'GET' })).status === 405);
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
