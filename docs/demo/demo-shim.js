// Demo shim. The live dashboard talks to a Cloudflare Worker; the demo talks straight to Supabase.
// Loaded after js/api.js: adds the Supabase key to every data call, maps alert actions onto row updates,
// and answers the few worker-only features (search, charts, watchlist edits, settings) with a clear "not in the demo".
(() => {
  const inner = window.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const ACTIONS = {
    read:    n => ({ read_at: n }),
    unread:  () => ({ read_at: null }),
    archive: n => ({ archived_at: n, dismissed_at: null, read_at: n }),
    dismiss: n => ({ dismissed_at: n, archived_at: null, read_at: n }),
    restore: () => ({ archived_at: null, dismissed_at: null }),
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!String(url).startsWith(PROXY)) return inner(input, init);
    const path = String(url).slice(PROXY.length);

    if (path.startsWith('/alerts/action')) {
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) {}
      const ids = (body.ids || []).map(Number).filter(Number.isFinite);
      const make = ACTIONS[body.action];
      if (!ids.length || !make) return json(400, { error: 'Bad request' });
      return inner(`${PROXY}/alerts?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', apikey: SUPABASE_KEY },
        body: JSON.stringify(make(new Date().toISOString())),
      });
    }
    // Demo-only data: charts come from stored mock price paths, IPO and flow reports from demo-only tables (nothing invented goes into tables the private app reads).
    if (path === '/chart') {
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) {}
      const N = { '5d': 5, '1mo': 22, '3mo': 63, '6mo': 126, '9mo': 189, '1y': 252, '2y': 252, '5y': 252, max: 252 }[body.range];
      if (!N) return json(501, { error: 'Intraday charts are not available in the demo' });
      const r = await inner(`${PROXY}/demo_market_cache?select=payload&key=eq.${encodeURIComponent('chart:' + body.symbol + ':1y')}&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN } });
      let rows = r.ok ? await r.json().catch(() => []) : [];
      if (!rows[0]) { const m = /^([A-Z0-9]{1,10})\.(L|DE|AS)$/.exec(body.symbol || ''); if (m) {      // the demo stores LSE / Xetra / Amsterdam charts under the Trading 212 short name (CS1l, XDAXd…)
        const r2 = await inner(`${PROXY}/demo_market_cache?select=payload&key=eq.${encodeURIComponent('chart:' + m[1] + { L: 'l', DE: 'd', AS: 'a' }[m[2]] + ':1y')}&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN } });
        rows = r2.ok ? await r2.json().catch(() => []) : []; } }
      const p = rows[0] && rows[0].payload;
      if (!p || !p.points) return json(404, { error: 'No demo chart for this symbol' });
      return json(200, { points: p.points.slice(-N), meta: p.meta || {} });
    }
    if (/^\/(search|settings\/|watchlist\/|ipo\/)/.test(path)) return json(501, { error: 'This feature is not available in the demo' });
    const DEMO_ONLY = { '/ipo_calendar': '/demo_ipo_calendar', '/support_levels': '/demo_support_levels', '/institutional_flow_reports': '/demo_institutional_flow_reports' };
    for (const k in DEMO_ONLY) if (path === k || path.startsWith(k + '?')) input = PROXY + DEMO_ONLY[k] + path.slice(k.length);

    const h = new Headers(init.headers || {});
    h.set('apikey', SUPABASE_KEY);
    return inner(input, { ...init, headers: h });
  };
})();
