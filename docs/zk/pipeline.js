// One-button refresh: Trading 212 sync -> snapshot -> every analysis -> alert report + phone push, all in this browser on encrypted data.
// Each step is isolated: a failure is reported and the remaining steps still run.
(function (root) {
  'use strict';
  // deps: { store, market, call, token, relayUrl, log, nowDate(), mods }  mods default to the global modules
  function create(deps) {
    const M = Object.assign({ T212: root.ZKT212, Monitor: root.ZKMonitor, Analyst: root.ZKAnalystRatings, Returns: root.ZKReturns, PieHistory: root.ZKPieHistory, Profit: root.ZKProfitBooking,
      Strategy: root.ZKStrategy, Flow: root.ZKFlow, Holding: root.ZKHoldingDecision, ValueBuy: root.ZKValueBuy, Watchlist: root.ZKWatchlist, Alerts: root.ZKAlertReport, Notify: root.ZKNotify, Client: root.ZKT212 }, deps.mods || {});
    const { store, market } = deps, log = deps.log || (() => {}), now = () => (deps.nowDate ? deps.nowDate() : new Date());
    async function run(key, secret, opts) {
      opts = opts || {}; const results = [];
      async function step(name, fn) {
        try { const r = await fn(); const err = r && r.error; results.push({ name, ok: !err, note: err || '' }); log(`${err ? '✗' : '✓'} ${name}${err ? ': ' + err : ''}`); return r; }
        catch (e) { results.push({ name, ok: false, note: String(e.message || e) }); log(`✗ ${name}: ${e.message || e}`); return null; }
      }
      if (key && secret) {
        await step('Trading 212 history', async () => { const r = await M.T212.create({ store, relayUrl: deps.relayUrl, log }).run(key, secret, { full: !!opts.full }); return r && r.failed && r.failed.length ? { error: 'incomplete for ' + r.failed.join(', ') } : r; });
        await step('Portfolio snapshot', async () => { const r = await M.Monitor.create({ store, log, client: M.Client.client({ relayUrl: deps.relayUrl, log }), supportLevels: deps.supportLevels }).run(key, secret); return r && r.saved === false ? { error: r.reason } : r; });
      } else log('No Trading 212 credentials entered: re-analysing the data already stored');
      await step('Analyst ratings', () => M.Analyst.run({ store, market }, now()));
      const ratings = await store.load('analyst_ratings').catch(() => []);
      await step('Returns', () => M.Returns.run(store, now()));
      await step('Pie history', () => M.PieHistory.run({ store, market }, now()));
      await step('Profit booking', () => M.Profit.run({ store, market, ratings }, now()));
      await step('Strategy', () => M.Strategy.run({ store, market, ratings }, now()));
      let flowReport = null;
      await step('Market flow report', async () => { const pos = await store.load('positions'); flowReport = await M.Flow.latest(deps.call, deps.token, pos); return flowReport ? {} : { error: 'no shared report published yet (scores default to neutral)' }; });
      await step('Holding decisions', () => M.Holding.run({ store, market, flowReport }, now()));
      await step('Value-buy scores', () => M.ValueBuy.run({ store, market }, now()));
      await step('Watchlist', () => M.Watchlist.run({ store, market }, now()));
      let notify = null; try { const n = await M.Notify.fromStore(store, (...a) => fetch(...a)); notify = n && n.notify; } catch (e) { log('Phone alerts not configured: ' + e.message); }
      await step('Alert report' + (notify ? ' + phone push' : ''), () => M.Alerts.run({ store, market, ratings, notify }, now()));
      return { results, ok: results.every(r => r.ok) };
    }
    return { run };
  }
  root.ZKPipeline = { create };
  if (typeof module !== 'undefined') module.exports = root.ZKPipeline;
})(typeof window !== 'undefined' ? window : globalThis);
