/**
 * capitallens-relay: a deliberately tiny, stateless pass-through to the Trading 212 API.
 *
 * Why it exists: browsers cannot call the Trading 212 API directly (no CORS), and in the zero-knowledge design the
 * API key lives only in the customer's browser. This relay forwards ONE read-only request and returns the answer.
 *
 * What it must never do (keep this file small enough to audit in a minute):
 *   - no secrets or bindings (it cannot reach any database)
 *   - no storage, no logging of headers/bodies/paths, no analytics
 *   - GET only, two hosts only (Trading 212 with the caller's own key, Yahoo public charts), allowlisted read-only paths only
 */
const ORIGINS = ['https://cilangovan.github.io'];
const HOST = 'https://live.trading212.com';
const ALLOWED = [
  /^\/api\/v0\/equity\/history\/orders(\?|$)/,
  /^\/api\/v0\/history\/dividends(\?|$)/,
  /^\/api\/v0\/history\/transactions(\?|$)/,
  /^\/api\/v0\/equity\/(positions|portfolio)(\?|$)/,
  /^\/api\/v0\/equity\/pies(\/\d{1,12})?(\?|$)/,
  /^\/api\/v0\/equity\/account\/(summary|cash|info)(\?|$)/,
  /^\/api\/v0\/equity\/metadata\/instruments(\?|$)/,
];

// Public market data (no credentials). Chart endpoint only; symbol and range are strictly validated.
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const SYMBOL = /^[A-Za-z0-9.^=\-]{1,24}$/, RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']);

function headers(request, extra) {
  const h = new Headers({
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'X-T212-Auth,Accept',
    'Access-Control-Expose-Headers': 'x-ratelimit-reset,x-ratelimit-remaining', ...extra,
  });
  const origin = request.headers.get('Origin');
  if (origin && ORIGINS.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
  return h;
}
const reply = (request, status, body, extra) => new Response(body, { status, headers: headers(request, extra) });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(request, 204, null);
    const origin = request.headers.get('Origin');
    if (origin && !ORIGINS.includes(origin)) return reply(request, 403, '{"error":"origin not allowed"}', { 'Content-Type': 'application/json' });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/yahoo') {
      const sym = url.searchParams.get('s') || '', range = url.searchParams.get('range') || '1y';
      if (!SYMBOL.test(sym) || !RANGES.has(range)) return reply(request, 400, '{"error":"bad symbol or range"}', { 'Content-Type': 'application/json' });
      const y = await fetch(`${YAHOO}${encodeURIComponent(sym)}?range=${range}&interval=1d&events=div%2Csplit`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, redirect: 'error' });
      return reply(request, y.status, await y.arrayBuffer(), { 'Content-Type': y.headers.get('Content-Type') || 'application/json' });
    }
    if (request.method !== 'GET' || url.pathname !== '/t212') return reply(request, 404, '{"error":"not found"}', { 'Content-Type': 'application/json' });
    const p = url.searchParams.get('p') || '', auth = request.headers.get('X-T212-Auth') || '';
    if (!p.startsWith('/') || p.length > 600 || p.includes('..') || p.includes('//') || !ALLOWED.some(re => re.test(p)))
      return reply(request, 400, '{"error":"path not allowed"}', { 'Content-Type': 'application/json' });
    if (!/^Basic [A-Za-z0-9+/=]{10,400}$/.test(auth)) return reply(request, 400, '{"error":"credentials missing"}', { 'Content-Type': 'application/json' });
    const up = await fetch(HOST + p, { method: 'GET', headers: { Authorization: auth, Accept: 'application/json' }, redirect: 'error' });
    const out = { 'Content-Type': up.headers.get('Content-Type') || 'application/json' };
    for (const k of ['x-ratelimit-reset', 'x-ratelimit-remaining']) if (up.headers.get(k)) out[k] = up.headers.get(k);
    return reply(request, up.status, await up.arrayBuffer(), out);
  },
};
