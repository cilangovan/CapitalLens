// Run: node tests/zk_pipeline_test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../docs/zk/pipeline.js');
let pass = 0, fail = 0; const ok = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n); };
const order = [], logs = [];
const mk = (name, ret = {}, opts = {}) => ({ run: async (...a) => { order.push(name); if (opts.throws) throw new Error('boom ' + name); return typeof ret === 'function' ? ret(...a) : ret; } });
const mods = () => ({ T212: { create: () => mk('t212', { failed: [] }) }, Client: { client: () => ({}) }, Monitor: { create: () => mk('snapshot', { saved: true }) }, Analyst: mk('analyst'), Returns: mk('returns'), PieHistory: mk('piehistory'), Profit: mk('profit'),
  Strategy: mk('strategy'), Flow: { latest: async () => { order.push('flow'); return { markets: [] }; } }, Holding: mk('holding'), ValueBuy: mk('valuebuy'), Watchlist: mk('watchlist'), Alerts: mk('alerts'), Notify: { fromStore: async () => ({ notify: async () => {} }) } });
const store = { load: async k => k === 'analyst_ratings' ? [{ ticker: 'X', star_rating: 4 }] : [] };
let m = mods(); const seen = {};
m.Profit = { run: async o => { seen.profit = o.ratings; order.push('profit'); return {}; } }; m.Alerts = { run: async o => { seen.notify = typeof o.notify; seen.ratings = o.ratings; order.push('alerts'); return {}; } }; m.Holding = { run: async o => { seen.flow = o.flowReport; order.push('holding'); return {}; } };
const r1 = await P.create({ store, market: {}, call: () => {}, token: 't', relayUrl: 'r', log: x => logs.push(x), mods: m }).run('K', 'S');
ok('full run respects dependencies: sync -> snapshot -> wave 1 (ratings, returns, flow) -> wave 2 (pie history, profit, strategy, holdings, value-buy, watchlist) -> alerts', order.length === 12 && order.slice(0, 2).join() === 't212,snapshot' && order[11] === 'alerts' && new Set(order.slice(2, 5)).size === 3 && ['analyst', 'returns', 'flow'].every(n => order.slice(2, 5).includes(n)) && ['piehistory', 'profit', 'strategy', 'holding', 'valuebuy', 'watchlist'].every(n => order.slice(5, 11).includes(n)));
ok('results keep the pipeline order even though steps run in parallel', r1.results.map(x => x.name).slice(0, 2).join() === 'Trading 212 history,Portfolio snapshot' && r1.results.every(x => typeof x.ms === 'number'));
ok('analysts feed profit booking and alert report; flow report feeds holding decisions; phone push enabled when topic saved', seen.profit.length === 1 && seen.ratings.length === 1 && seen.notify === 'function' && seen.flow && Array.isArray(seen.flow.markets));
ok('all steps reported OK', r1.ok && r1.results.length === 12);
order.length = 0; m = mods(); m.Returns = mk('returns', {}, { throws: true }); m.Strategy = mk('strategy', { error: 'no snapshot' }); m.T212 = { create: () => mk('t212', { failed: ['orders'] }) };
const r2 = await P.create({ store, market: {}, call: () => {}, token: 't', relayUrl: 'r', mods: m }).run('K', 'S');
ok('a throwing/erroring step is reported and the remaining steps still run', order.length === 12 && !r2.ok && r2.results.filter(x => !x.ok).map(x => x.name).join() === 'Trading 212 history,Returns,Strategy' && /boom/.test(r2.results.find(x => x.name === 'Returns').note) && /incomplete for orders/.test(r2.results[0].note));
order.length = 0; m = mods(); await P.create({ store, market: {}, call: () => {}, token: 't', relayUrl: 'r', log: x => logs.push(x), mods: m }).run('', '');
ok('without Trading 212 credentials it only re-analyses stored data (no sync, no snapshot)', !order.includes('t212') && !order.includes('snapshot') && order[0] === 'analyst' && logs.some(l => /No Trading 212 credentials/.test(l)));
m = mods(); m.Notify = { fromStore: async () => { throw new Error('bad topic'); } }; const seen2 = {}; m.Alerts = { run: async o => { seen2.notify = o.notify; return {}; } };
const r3 = await P.create({ store, market: {}, call: () => {}, token: 't', relayUrl: 'r', mods: m }).run('K', 'S');
ok('invalid phone-alert setting disables pushes but the report still runs', seen2.notify === null && r3.ok);
// Speed guards: independent steps overlap in time, dependent ones wait, and the store's read cache is on only during a refresh.
{
  const t = {}, delay = ms => new Promise(r => setTimeout(r, ms)), slow = name => ({ run: async () => { t[name] = { s: Date.now() }; await delay(60); t[name].e = Date.now(); return {}; } });
  const mm = mods(); for (const [k, n] of [['Analyst', 'analyst'], ['Returns', 'returns'], ['PieHistory', 'piehistory'], ['Profit', 'profit'], ['Strategy', 'strategy'], ['Holding', 'holding'], ['ValueBuy', 'valuebuy'], ['Watchlist', 'watchlist']]) mm[k] = slow(n);
  const t0 = Date.now(); await P.create({ store, market: {}, call: () => {}, token: 't', relayUrl: 'r', mods: mm }).run('', '');
  const wall = Date.now() - t0;
  ok('8 steps of 60ms each finish in well under their 480ms sum (parallel)', wall < 300);
  ok('returns finishes before strategy starts (strategy reads returns_summary); ratings before profit', t.returns.e <= t.strategy.s && t.analyst.e <= t.profit.s && t.analyst.e <= t.strategy.s);
  ok('independent steps overlap (analyst/returns; profit/strategy/holding)', t.returns.s < t.analyst.e && t.strategy.s < t.profit.e && t.holding.s < t.strategy.e);
  const flags = []; const cs = { load: async () => [], cache: on => flags.push(on) };
  await P.create({ store: cs, market: {}, call: () => {}, token: 't', relayUrl: 'r', mods: mods() }).run('', '');
  ok('store read cache is switched on for the refresh and off again afterwards', flags.join() === 'true,false');
  const bad = mods(); bad.Alerts = { run: async () => { throw new Error('x'); } }; flags.length = 0;
  await P.create({ store: cs, market: {}, call: () => {}, token: 't', relayUrl: 'r', mods: bad }).run('', '');
  ok('cache is switched off even when a step throws', flags.join() === 'true,false');
}
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
