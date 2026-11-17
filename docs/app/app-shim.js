// Same job as the demo shim: send dashboard data calls straight to Supabase (row-level security scopes them to the
// signed-in user) and answer the worker-only features with a clear message.
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
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN },
        body: JSON.stringify(make(new Date().toISOString())),
      });
    }
    if (/^\/(chart|search|settings\/|watchlist\/)/.test(path)) return json(501, { error: 'This feature is coming soon' });
    const h = new Headers(init.headers || {});
    h.set('apikey', SUPABASE_KEY);
    return inner(input, { ...init, headers: h });
  };
})();
