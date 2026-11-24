// One-button refresh: Trading 212 sync -> snapshot -> every analysis -> alert report + phone push, all in this browser on encrypted data.
// Each step is isolated: a failure is reported and the remaining steps still run.
(function (root) {
  'use strict';
  // What did this refresh change? before/after: { at, pos: { ticker: qty } } from the latest snapshot; orders: the newly stored order rows.
  // Pure, so it can be tested. Names are the short ticker (NVDA_US_EQ -> NVDA).
  const short = t => String(t || '').split('_')[0];
  const qtyTxt = n => (Math.round(Number(n) * 1e6) / 1e6).toString();
  function describeChanges(before, after, newOrders, snapshotSaved) {
    const b = (before && before.pos) || {}, a = (after && after.pos) || {}, added = [], closed = [], changed = [];
    for (const t of Object.keys(a)) { if (!(t in b)) added.push({ ticker: t, qty: a[t] }); else if (Math.abs(a[t] - b[t]) > 1e-9) changed.push({ ticker: t, from: b[t], to: a[t] }); }
    for (const t of Object.keys(b)) if (!(t in a)) closed.push(t);
    const orders = (newOrders || []).filter(o => o && o.ticker), buys = orders.filter(o => o.side === 'BUY'), sells = orders.filter(o => o.side === 'SELL');
    const lines = [];
    lines.push(snapshotSaved ? `Portfolio snapshot saved: ${Object.keys(a).length} positions` : `No new portfolio snapshot: positions below are from ${before && before.at ? before.at.slice(0, 16).replace('T', ' ') + ' UTC' : 'an earlier refresh'}`);
    if (snapshotSaved) {
      if (added.length) lines.push('New positions: ' + added.map(x => `${short(x.ticker)} (${qtyTxt(x.qty)})`).join(', '));
      if (changed.length) lines.push('Quantity changed: ' + changed.map(x => `${short(x.ticker)} ${qtyTxt(x.from)} → ${qtyTxt(x.to)}`).join(', '));
      if (closed.length) lines.push('No longer held: ' + closed.map(short).join(', '));
      if (!added.length && !changed.length && !closed.length && before && before.at) lines.push('No change in holdings since the previous refresh');
    }
    if (orders.length) lines.push(`New orders from Trading 212: ${orders.length} (${buys.length} buy${buys.length === 1 ? '' : 's'}, ${sells.length} sell${sells.length === 1 ? '' : 's'}): ` + [...new Set(orders.map(o => short(o.ticker)))].slice(0, 12).join(', '));
    else lines.push('No new orders since the previous refresh');
    return { snapshotSaved: !!snapshotSaved, added, closed, changed, orders: { total: orders.length, buys: buys.length, sells: sells.length }, lines };
  }
  // deps: { store, market, call, token, relayUrl, log, nowDate(), mods }  mods default to the global modules
  function create(deps) {
    const M = Object.assign({ T212: root.ZKT212, Monitor: root.ZKMonitor, Analyst: root.ZKAnalystRatings, Returns: root.ZKReturns, PieHistory: root.ZKPieHistory, Profit: root.ZKProfitBooking,
      Strategy: root.ZKStrategy, Flow: root.ZKFlow, Holding: root.ZKHoldingDecision, ValueBuy: root.ZKValueBuy, Watchlist: root.ZKWatchlist, Alerts: root.ZKAlertReport, Notify: root.ZKNotify, Client: root.ZKT212 }, deps.mods || {});
    const { store, market } = deps, log = deps.log || (() => {}), now = () => (deps.nowDate ? deps.nowDate() : new Date());
    // Reads are cached for the length of one refresh (store.cache) so positions/snapshots/orders are fetched + decrypted once, not once per step.
    async function run(key, secret, opts) {
      if (store.cache) store.cache(true);
      try { return await runSteps(key, secret, opts); } finally { if (store.cache) store.cache(false); }
    }
    async function runSteps(key, secret, opts) {
      opts = opts || {}; const results = [], warnings = [];
      const view = async () => { const snaps = (await store.load('portfolio_snapshots').catch(() => [])).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))); const s = snaps[0]; if (!s) return null;
        const pos = {}; for (const p of (await store.load('positions').catch(() => [])).filter(p => p.snapshot_id === s.id)) pos[p.ticker] = Number(p.quantity) || 0; return { id: s.id, at: s.created_at, pos }; };
      const orderIds = async () => new Set((await store.load('t212_orders').catch(() => [])).map(o => o.id));
      const before = key && secret ? await view() : null, ordersBefore = key && secret ? await orderIds() : null;
      let snapshotSaved = false;
      // The slot is reserved when the step starts, so results keep the pipeline order even when steps finish out of order. ms = how long it took.
      async function step(name, fn) {
        const slot = { name, ok: false, note: '' }, t0 = Date.now(); results.push(slot); const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
        try { const r = await fn(); const err = r && r.error; slot.ok = !err; slot.note = err || ''; slot.ms = Date.now() - t0; log(`${err ? '✗' : '✓'} ${name}${err ? ': ' + err : ''} (${secs()})`); return r; }
        catch (e) { slot.note = String(e.message || e); slot.ms = Date.now() - t0; log(`✗ ${name}: ${e.message || e} (${secs()})`); return null; }
      }
      if (key && secret) {
        await step('Trading 212 history', async () => { const r = await M.T212.create({ store, relayUrl: deps.relayUrl, log }).run(key, secret, { full: !!opts.full }); return r && r.failed && r.failed.length ? { error: 'incomplete for ' + r.failed.join(', ') } : r; });
        await step('Portfolio snapshot', async () => { const r = await M.Monitor.create({ store, log, client: M.Client.client({ relayUrl: deps.relayUrl, log }), supportLevels: deps.supportLevels }).run(key, secret); if (r && r.saved === false) return { error: r.reason }; snapshotSaved = true; for (const w of (r && r.warnings) || []) warnings.push(w); return r; });
      } else log('No Trading 212 credentials entered: re-analysing the data already stored');
      // Wave 1 (independent): ratings, returns, market-flow report. Wave 2 (needs wave 1: ratings -> profit/strategy, returns -> strategy, flow -> holdings): the rest in parallel.
      let ratings = [], flowReport = null;
      await Promise.all([
        step('Analyst ratings', async () => { const r = await M.Analyst.run({ store, market }, now()); ratings = await store.load('analyst_ratings').catch(() => []); return r; }),
        step('Returns', () => M.Returns.run(store, now())),
        step('Market flow report', async () => { const pos = await store.load('positions'); flowReport = await M.Flow.latest(deps.call, deps.token, pos); return flowReport ? {} : { error: 'no shared report published yet (scores default to neutral)' }; }),
      ]);
      await Promise.all([
        step('Pie history', () => M.PieHistory.run({ store, market }, now())),
        step('Profit booking', () => M.Profit.run({ store, market, ratings }, now())),
        step('Strategy', () => M.Strategy.run({ store, market, ratings }, now())),
        step('Holding decisions', () => M.Holding.run({ store, market, flowReport }, now())),
        step('Value-buy scores', () => M.ValueBuy.run({ store, market }, now())),
        step('Watchlist', () => M.Watchlist.run({ store, market }, now())),
      ]);
      let notify = null; try { const n = await M.Notify.fromStore(store, (...a) => fetch(...a)); notify = n && n.notify; } catch (e) { log('Phone alerts not configured: ' + e.message); }
      await step('Alert report' + (notify ? ' + phone push' : ''), () => M.Alerts.run({ store, market, ratings, notify }, now()));
      let changes = null;
      if (key && secret) {
        try {
          const after = await view(), seen = ordersBefore || new Set(), fresh = (await store.load('t212_orders').catch(() => [])).filter(o => !seen.has(o.id));
          changes = describeChanges(before, after, fresh, snapshotSaved);
          if (!snapshotSaved && before) warnings.push(`The analyses (ratings, strategy, entry, holdings, alerts) used the previous snapshot from ${before.at.slice(0, 16).replace('T', ' ')} UTC, so they do not include anything bought since`);
          if (!snapshotSaved && !before) warnings.push('There is no portfolio snapshot yet, so the dashboards have no positions to analyse');
        } catch (e) { log('Could not summarise the changes: ' + e.message); }
      }
      return { results, ok: results.every(r => r.ok), changes, warnings };
    }
    return { run };
  }
  root.ZKPipeline = { create, describeChanges };
  if (typeof module !== 'undefined') module.exports = root.ZKPipeline;
})(typeof window !== 'undefined' ? window : globalThis);
