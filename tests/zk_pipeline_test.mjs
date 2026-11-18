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
ok('full run order: sync, snapshot, ratings, returns, pie history, profit, strategy, flow, holdings, value-buy, watchlist, alerts', order.join() === 't212,snapshot,analyst,returns,piehistory,profit,strategy,flow,holding,valuebuy,watchlist,alerts'); 
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
console.log(`\n${pass} passed · ${fail} failed`); process.exit(fail ? 1 : 0);
