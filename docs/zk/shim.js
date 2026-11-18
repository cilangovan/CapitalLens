// Read adapter: the existing dashboards call fetch(PROXY + '/<table>?...'). In the zero-knowledge app those calls are answered here
// from the customer's decrypted rows (docs/zk/store.js) instead of a server table, so the dashboards run unchanged.
// Public shared tables (instrument reference data, market cache) are forwarded to Supabase with the user's token.
(function (root) {
  'use strict';
  const Q = () => root.ZKQuery;
  const ENCRYPTED = { portfolio_snapshots: 'portfolio_snapshots', portfolio_snapshots_all: 'portfolio_snapshots', positions: 'positions', positions_all: 'positions', alerts: 'alerts',
    analyst_ratings: 'analyst_ratings', holding_decisions: 'holding_decisions', value_buy_scores: 'value_buy_scores', strategy_recommendations: 'strategy_recommendations',
    profit_booking: 'profit_booking', profit_booking_summary: 'profit_booking_summary', returns_summary: 'returns_summary', realised_pnl: 'realised_pnl', dividends: 'dividends',
    pie_history: 'pie_history', watchlist: 'watchlist', watchlist_analysis: 'watchlist_analysis' };
  const SHARED = new Set(['instrument_exposure', 'instrument_country_weights', 'instrument_sector_weights', 'instruments', 'user_ui_prefs', 'market_cache']);
  const ACTIONS = { read: n => ({ read_at: n }), unread: () => ({ read_at: null }), archive: n => ({ archived_at: n, dismissed_at: null, read_at: n }), dismiss: n => ({ dismissed_at: n, archived_at: null, read_at: n }), restore: () => ({ archived_at: null, dismissed_at: null }) };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // opts: { store, call(path, init, token) -> {ok,status,json()}, token, positions(): Promise<rows>, defuse(v), now(), setting(key, value) }
  function create(opts) {
    const defuse = opts.defuse || (v => v), now = opts.now || (() => new Date().toISOString());
    let idMap = new Map();                                           // numeric id (what the dashboard expects) <-> stored id
    const numericId = stored => { const h = [...String(stored)].reduce((a, c) => (Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261); let n = h + 1; while (idMap.has(n) && idMap.get(n) !== stored) n++; idMap.set(n, stored); return n; };
    const forDashboard = a => Object.assign({}, a, { id: numericId(a.id) });
    async function handle(path, init) {
      init = init || {}; const method = (init.method || 'GET').toUpperCase(), qi = path.indexOf('?'), route = (qi < 0 ? path : path.slice(0, qi)).replace(/^\//, ''), params = qi < 0 ? '' : path.slice(qi);
      if (route === 'alerts/action' && method === 'POST') {
        let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
        const make = ACTIONS[body.action], wanted = new Set((body.ids || []).map(Number));
        if (!make || !wanted.size) return json(400, { error: 'Bad request' });
        const rows = (await opts.store.load('alerts')).filter(a => wanted.has(numericId(a.id))), stamp = now();
        await opts.store.put('alerts', rows.map(a => Object.assign({}, a, make(stamp))), r => r.id);
        return json(200, { ok: true, updated: rows.length });
      }
      if (route === 'settings/set' && method === 'POST') {
        let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
        const v = Number(body.value); if (!/^[a-z_]{3,40}$/.test(body.key || '') || !Number.isFinite(v) || v < 0 || v > 1e6) return json(400, { error: 'Bad setting' });
        await opts.store.put('app_settings', [{ key: body.key, value: String(v) }], r => r.key); return json(200, { ok: true, value: v });
      }
      if (/^(chart|search|watchlist\/)/.test(route)) return json(501, { error: 'This feature is being moved into your browser and is not available yet' });
      if (route === 'institutional_flow_reports') {
        const rep = await root.ZKFlow.latest(opts.call, opts.token, await opts.positions());
        return json(200, defuse(rep ? Q().run([rep], params) : []));
      }
      if (route in ENCRYPTED) {
        let rows = await opts.store.load(ENCRYPTED[route]);
        if (route === 'alerts') rows = rows.map(forDashboard);
        if (method !== 'GET') return json(405, { error: 'Writes go through the encrypted store' });
        return json(200, defuse(Q().run(rows, params)));
      }
      if (SHARED.has(route)) { const r = await opts.call('/rest/v1/' + route + params, { method, headers: (init.headers && Object.fromEntries(new Headers(init.headers))) || {}, body: init.body }, opts.token); return json(r.status, defuse(r.d !== undefined ? r.d : await r.json())); }
      return json(404, { error: 'Unknown table ' + route });
    }
    return { handle, ENCRYPTED, SHARED };
  }
  // Browser install: route every fetch under `proxy` through the handler, leave everything else alone.
  function install(proxy, handler) {
    const inner = root.fetch.bind(root);
    root.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; return String(url).startsWith(proxy) ? handler.handle(String(url).slice(proxy.length), init) : inner(input, init); };
  }
  root.ZKShim = { create, install, ENCRYPTED, SHARED };
  if (typeof module !== 'undefined') module.exports = root.ZKShim;
})(typeof window !== 'undefined' ? window : globalThis);
