// Read adapter: the existing dashboards call fetch(PROXY + '/<table>?...'). In the zero-knowledge app those calls are answered here
// from the customer's decrypted rows (docs/zk/store.js) instead of a server table, so the dashboards run unchanged.
// Public shared tables (instrument reference data, market cache) are forwarded to Supabase with the user's token.
(function (root) {
  'use strict';
  const Q = () => root.ZKQuery;
  const ENCRYPTED = { portfolio_snapshots: 'portfolio_snapshots', portfolio_snapshots_all: 'portfolio_snapshots', positions: 'positions', positions_all: 'positions', alerts: 'alerts',
    analyst_ratings: 'analyst_ratings', holding_decisions: 'holding_decisions', value_buy_scores: 'value_buy_scores', strategy_recommendations: 'strategy_recommendations',
    profit_booking: 'profit_booking', profit_booking_summary: 'profit_booking_summary', returns_summary: 'returns_summary', realised_pnl: 'realised_pnl', dividends: 'dividends',
    pie_history: 'pie_history', watchlist: 'watchlist', watchlist_analysis: 'watchlist_analysis', ipo_watch: 'ipo_watch' };
  const SHARED = new Set(['instrument_exposure', 'instrument_country_weights', 'instrument_sector_weights', 'instruments', 'user_ui_prefs', 'market_cache', 'ipo_calendar', 'support_levels']);
  // JSON stored as text by the browser-side analysis. Parsed BEFORE defuse (which swaps every double quote), then defused as real data.
  const JSON_COLS = { value_buy_scores: ['entry_zones', 'scorecard', 'earnings', 'this_week'] };
  const parseJsonCols = (route, rows) => !JSON_COLS[route] ? rows : rows.map(r => { const o = Object.assign({}, r); for (const c of JSON_COLS[route]) if (typeof o[c] === 'string') { try { o[c] = JSON.parse(o[c]); } catch (e) {} } return o; });
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
      if (/^ipo\/(watch|unwatch)$/.test(route)) {                // per-user IPO watch list, stored encrypted like the stock watchlist
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
        const id = String(body.id || ''); if (!/^[A-Z]{2,5}:[A-Z0-9_.\-]{1,40}$/.test(id)) return json(400, { error: 'Bad IPO id' });
        if (route === 'ipo/watch') { if (!(await opts.store.load('ipo_watch')).some(r => r.id === id)) await opts.store.put('ipo_watch', [{ id, added_at: now() }], r => r.id); }
        else await opts.store.remove('ipo_watch', id);
        return json(200, { ok: true });
      }
      if (route === 'watchlist/order') {                         // card order per user: sort_order lives inside the encrypted watchlist row (the server never sees tickers or order)
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
        const cat = body.category, order = body.order;
        if (!['stock', 'commodity', 'crypto'].includes(cat) || !Array.isArray(order) || order.length > 300 || !order.every(t => typeof t === 'string' && /^[A-Za-z0-9.\-^=&]{1,24}$/.test(t))) return json(400, { error: 'Bad order' });
        const rank = new Map(order.map((t, k) => [t, k])), rows = (await opts.store.load('watchlist')).filter(r => (r.category || 'stock') === cat), changed = [];
        rows.forEach(r => { const want = rank.has(r.ticker) ? rank.get(r.ticker) : null, had = Number.isFinite(r.sort_order) ? r.sort_order : null;
          if (want !== had) { const o = Object.assign({}, r); if (want === null) delete o.sort_order; else o.sort_order = want; changed.push(o); } });
        if (changed.length) await opts.store.put('watchlist', changed, r => r.ticker);
        return json(200, { ok: true, category: cat, updated: changed.length });
      }
      if (/^(chart|search|watchlist\/(add|remove))$/.test(route)) {
        if (method !== 'POST') return json(405, { error: 'Method not allowed' });
        if (!opts.ops) return json(501, { error: 'This feature is not available here' });
        let body = {}; try { body = JSON.parse(init.body || '{}'); } catch (e) {}
        try {
          const out = route === 'search' ? await opts.ops.search(body.q, body.category) : route === 'chart' ? await opts.ops.chart(body.symbol, body.range)
            : route === 'watchlist/add' ? await opts.ops.add(body.symbol, body.category) : await opts.ops.remove(body.symbol);
          return json(200, defuse(out));
        } catch (e) { return json(e.status || 500, { error: String(e.message || 'Server error').slice(0, 200) }); }
      }
      if (/^(chart|search|watchlist\/)/.test(route)) return json(404, { error: 'Unknown route' });
      if (route === 'institutional_flow_reports') {
        const rep = await root.ZKFlow.latest(opts.call, opts.token, await opts.positions());
        return json(200, defuse(rep ? Q().run([rep], params) : []));
      }
      if (route in ENCRYPTED) {
        let rows = await opts.store.load(ENCRYPTED[route]);
        if (route === 'alerts') rows = rows.map(forDashboard);
        rows = parseJsonCols(route, rows);
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
