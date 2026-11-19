// Run: node tests/zk_monitor_test.mjs
// Browser monitor: parity with monitor.py's analyse(), end-to-end snapshot save through relay + encrypted store.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import relay from '../cloudflare-worker/relay.js';
const require = createRequire(import.meta.url);
const ZK = require('../docs/js/zkcrypto.js'), Store = require('../docs/zk/store.js'), T = require('../docs/zk/t212sync.js');
require('../docs/zk/alertfmt.js'); const M = require('../docs/zk/monitor.js');
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };

// ── 1. parity with the Python implementation ──
const positions = [
  { ticker: 'ITWNl_EQ', averagePrice: 3000, currentPrice: 2500, ppl: -12.5, quantity: 3 },        // dip 16.7% from high 3000 -> buy signal
  { ticker: 'NVDA_US_EQ', averagePrice: 100, currentPrice: 145, ppl: 90.123, quantity: 2.5 },    // +45% -> trim
  { ticker: 'SGLNl_EQ', averagePrice: 40, currentPrice: 37, ppl: -3, quantity: 10 },              // dip 9.8% from high 41 -> dip
  { ticker: 'XYZd_EQ', averagePrice: 10, currentPrice: 10.5, ppl: 1, quantity: 1 },               // no ccy meta, quiet
  { ticker: 'ZEROl_EQ', averagePrice: 0, currentPrice: 5, ppl: 0, quantity: 1 },                  // skipped
  { ticker: 'ABCa_EQ', averagePrice: 50, currentPrice: 20, ppl: -30, quantity: 4 },               // deep dip, unknown meta name
];
const pieMap = { 'ITWNl_EQ': 'Countries', 'NVDA_US_EQ': 'Tech', 'SGLNl_EQ': 'Metals' };
const state = { highs: { 'ITWNl_EQ': 3000, 'NVDA_US_EQ': 145, 'SGLNl_EQ': 41, 'XYZd_EQ': 10.5, 'ABCa_EQ': 60 }, last_alerts: { 'dip_ABCa_EQ': 0 },
  held_meta: { 'ITWNl_EQ': { ccy: 'GBX', name: 'iShares MSCI Taiwan' }, 'NVDA_US_EQ': { ccy: 'USD', name: 'NVIDIA Corp' }, 'SGLNl_EQ': { ccy: 'GBP', name: 'Physical Gold' }, 'ABCa_EQ': { ccy: 'EUR', name: 'Some Amsterdam ETF' } }, run_count: 3 };
const py = JSON.parse(execFileSync('python3', ['-I', '-c', `
import os, sys, json
for k in ("T212_API_KEY","T212_API_SECRET","GMAIL_USER","GMAIL_APP_PASS","SUPABASE_URL","SUPABASE_KEY"): os.environ[k]="x"
sys.path.insert(0, ".")
import monitor
d = json.loads(sys.stdin.read())
a, s = monitor.analyse(d["positions"], [], d["pieMap"], d["state"])
print(json.dumps({"alerts": a, "summary": s}))
`], { input: JSON.stringify({ positions, pieMap, state }), encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }));
const jsState = JSON.parse(JSON.stringify(state)); jsState.last_alerts = { 'dip_ABCa_EQ': 0 };
const js = M.analyse(positions, pieMap, jsState, new Date('2026-11-18T12:00:00Z'));
ok('summary identical to Python (all fields)', JSON.stringify(js.summary) === JSON.stringify(py.summary));
ok('same alerts raised, same order', js.alerts.map(a => a.key).join() === py.alerts.map(a => a.key).join() && js.alerts.length === 4);
const strip = t => t.split('\n').filter(l => !l.startsWith('Source:')).join('\n');
ok('titles, types, priorities identical', js.alerts.every((a, i) => a.title === py.alerts[i].title && a.type === py.alerts[i].type && a.priority === py.alerts[i].priority && a.ticker === py.alerts[i].ticker));
ok('alert body text identical to Python (ignoring the timestamp line)', js.alerts.every((a, i) => strip(a.body) === strip(py.alerts[i].body)));
ok('push text identical to Python', js.alerts.every((a, i) => strip(a.push) === strip(py.alerts[i].push)));
ok('cooldown marked so the same alert is not raised again', M.analyse(positions, pieMap, jsState, new Date('2026-11-18T13:00:00Z')).alerts.length === 0);
ok('alert raised again after the cooldown expires', M.analyse(positions, pieMap, jsState, new Date('2026-11-19T13:00:00Z')).alerts.length === 4);

// ── 2. end to end through the relay with a fake Trading 212 and fake encrypted DB ──
const DB = new Map(), seen = []; const UID = '33333333-3333-3333-3333-333333333333';
async function call(path, opt = {}) {
  const u = new URL('http://x' + path); opt = opt || {}; seen.push(path, opt.body || '');
  const kind = (u.searchParams.get('kind') || '').replace('eq.', ''), idq = (u.searchParams.get('id') || '').replace('eq.', '');
  if (!opt.method || opt.method === 'GET') { const rows = [...DB.values()].filter(r => r.kind === kind && (!idq || r.id === idq)).sort((a, b) => a.id.localeCompare(b.id)); const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 1000; return { ok: true, status: 200, d: rows.slice(off, off + lim).map(({ id, nonce, ct }) => ({ id, nonce, ct })) }; }
  if (opt.method === 'POST') { for (const r of JSON.parse(opt.body)) DB.set(r.kind + '|' + r.id, r); return { ok: true, status: 201, d: null }; }
  return { ok: true, status: 204, d: null };
}
const KEY = 'MKEY-777', SEC = 'MSEC-888', AUTH = 'Basic ' + Buffer.from(`${KEY}:${SEC}`).toString('base64');
let calls = [], PRICE = 2500, NO_PIES_SCOPE = false;
globalThis.fetch = async (url, init) => {
  const path = url.replace('https://live.trading212.com', ''); calls.push(path);
  if (init.headers.Authorization !== AUTH) return new Response('{}', { status: 401 });
  if (path === '/api/v0/equity/account/cash') return Response.json({ total: 12345.678, free: 345.6, invested: 12000, ppl: -50.25, blocked: 100 });
  if (path === '/api/v0/equity/portfolio') return Response.json([{ ticker: 'ITWNl_EQ', averagePrice: 3000, currentPrice: PRICE, ppl: -12.5, quantity: 3 }, { ticker: 'NVDA_US_EQ', averagePrice: 100, currentPrice: 150, ppl: 100, quantity: 2 }]);
  if (path === '/api/v0/equity/pies') return NO_PIES_SCOPE ? new Response('{"e":"scope"}', { status: 403 }) : Response.json([{ id: 11 }]);
  if (path === '/api/v0/equity/pies/11') return Response.json({ settings: { name: 'Core Pie' }, instruments: [
    { ticker: 'ITWNl_EQ', expectedShare: 0.5, currentShare: 0.3, ownedQuantity: 3, result: { priceAvgValue: 300, priceAvgInvestedValue: 280 } },
    { ticker: 'NVDA_US_EQ', expectedShare: 0.5, currentShare: 0.7, ownedQuantity: 2, result: { priceAvgValue: 700, priceAvgInvestedValue: 500 } }] });
  if (path === '/api/v0/equity/metadata/instruments') return Response.json([{ ticker: 'ITWNl_EQ', currencyCode: 'GBX', shortName: 'Taiwan ETF', name: 'x' }, { ticker: 'NVDA_US_EQ', currencyCode: 'USD', name: 'NVIDIA' }, { ticker: 'OTHERl_EQ', currencyCode: 'GBP', name: 'not held' }]);
  return new Response('nope', { status: 404 });
};
const relayFetch = (url, init) => relay.fetch(new Request(url, { ...init, headers: { Origin: 'https://cilangovan.github.io', ...init.headers } }));
const acct = await ZK.createAccount('a long enough password');
const store = Store.create({ call, token: 't', uid: UID, dk: acct.dk });
let clock = 1_800_000_000_000; const sleeps = [];
const mk = () => M.create({ store, client: T.client({ relayUrl: 'https://relay.test', fetchImpl: relayFetch, sleep: async ms => { sleeps.push(ms); clock += ms; }, nowMs: () => clock, pace: 10500 }), nowDate: () => new Date(clock) });

let r = await mk().run(KEY, SEC);
ok('run saved a snapshot', r.saved && r.positions === 2 && r.pies === 1);
const snaps = await store.load('portfolio_snapshots'), pos = await store.load('positions'), al = await store.load('alerts');
ok('snapshot totals correct (total 12345.68, cash 345.6)', snaps.length === 1 && snaps[0].total_value === 12345.68 && snaps[0].cash === 345.6);
ok('snapshot invested = Trading 212 cost basis + unrealised (11949.75), total_ppl = its unrealised (-50.25), not total - cash', snaps[0].invested === 11949.75 && snaps[0].total_ppl === -50.25);
ok('positions linked to the snapshot, with pie names', pos.length === 2 && pos.every(p => p.snapshot_id === snaps[0].id) && pos.find(p => p.display === 'ITWNl').pie === 'Core Pie');
ok('pie summary: value 1000, gain 28.21%, drift flagged for both holdings', snaps[0].raw.pies[0].value === 1000 && snaps[0].raw.pies[0].gain_pct === 28.21 && snaps[0].raw.pies[0].drifts.length === 2);
ok('NVDA +50% raised a trim alert; Taiwan quiet on first run (high = current)', al.length === 1 && al[0].type === 'trim' && /Nvidia/.test(al[0].title));
ok('requests paced exactly like the Python job: 5s, 5s, 5s, 8s between the 5 calls', sleeps.join() === '5000,5000,5000,8000');
const blob = JSON.stringify([...DB.values()]) + seen.join('\n');
ok('server never saw key/secret, tickers, balances or alert text', !blob.includes(KEY) && !blob.includes(SEC) && !/ITWNl|NVDA_US|Core Pie|12345|profit target|Nvidia/.test(blob));

// second run: price falls 4% below the stored high; highs persisted; instrument meta cached (no 2nd metadata call)
calls = []; PRICE = 2400; r = await mk().run(KEY, SEC);
const al2 = await store.load('alerts'); const st = await store.get('monitor_state', 'main');
ok('tracked high persisted across runs (2500 stays, 2400 does not lower it)', st.highs['ITWNl_EQ'] === 2500);
ok('instrument metadata cached for 7 days (not fetched again)', !calls.includes('/api/v0/equity/metadata/instruments'));
ok('trim not repeated inside its 24h cooldown', al2.filter(a => a.type === 'trim').length === 1);
ok('two snapshots now stored, run_count 2', (await store.load('portfolio_snapshots')).length === 2 && st.run_count === 2);

// pies scope missing -> still saves positions
NO_PIES_SCOPE = true; r = await mk().run(KEY, SEC);
ok('403 on pies: positions still saved, pie names fall back to "Solo holdings"', r.saved && r.pies === 0 && (await store.load('positions')).filter(p => p.pie === 'Solo holdings').length >= 2);
// bad key -> nothing saved, no crash
const before = (await store.load('portfolio_snapshots')).length; r = await mk().run('bad', 'key');
ok('wrong credentials: nothing saved, no exception', r.saved === false && (await store.load('portfolio_snapshots')).length === before);

console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
