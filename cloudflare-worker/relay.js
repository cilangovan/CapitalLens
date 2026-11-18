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

// Yahoo needs a session cookie + crumb for quoteSummary (same flow as services/analyst_service.py). Held in memory only, ~30 min.
let CRUMB = null;
async function yahooSession() {
  if (CRUMB && Date.now() - CRUMB.at < 30 * 60 * 1000) return CRUMB;
  const r = await fetch('https://finance.yahoo.com/quote/AAPL', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']).map(c => c.split(';')[0]).filter(Boolean).join('; ');
  const m = /"crumb":"([^"]+)"/.exec(await r.text());
  CRUMB = m ? { crumb: m[1].replace(/\\u002F/g, '/'), cookie, at: Date.now() } : null;
  return CRUMB;
}
const num = x => (x && typeof x === 'object' ? x.raw : x);

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
    if (request.method === 'GET' && url.pathname === '/yahoo-news') {
      const sym = url.searchParams.get('s') || '';
      if (!SYMBOL.test(sym)) return reply(request, 400, '{"error":"bad symbol"}', { 'Content-Type': 'application/json' });
      const y = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&newsCount=15&quotesCount=0`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, redirect: 'error' });
      if (!y.ok) return reply(request, y.status, '{"titles":[]}', { 'Content-Type': 'application/json' });
      const j = await y.json();
      return reply(request, 200, JSON.stringify({ titles: (j.news || []).map(n => n.title).filter(Boolean).slice(0, 15) }), { 'Content-Type': 'application/json' });
    }
    if (request.method === 'GET' && url.pathname === '/yahoo-info') {
      const sym = url.searchParams.get('s') || '';
      if (!SYMBOL.test(sym)) return reply(request, 400, '{"error":"bad symbol"}', { 'Content-Type': 'application/json' });
      const ses = await yahooSession();
      if (!ses) return reply(request, 502, '{"error":"no session"}', { 'Content-Type': 'application/json' });
      const y = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=assetProfile%2Cprice%2CfinancialData%2CsummaryDetail%2CdefaultKeyStatistics%2CrecommendationTrend&crumb=${encodeURIComponent(ses.crumb)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Cookie: ses.cookie }, redirect: 'error' });
      if (y.status === 401 || y.status === 403) CRUMB = null;
      if (!y.ok) return reply(request, y.status, '{}', { 'Content-Type': 'application/json' });
      const r = ((await y.json()).quoteSummary || {}).result; const q = (r && r[0]) || {}, ap = q.assetProfile || {}, pr = q.price || {}, fd = q.financialData || {}, sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, rt = ((q.recommendationTrend || {}).trend) || [];
      return reply(request, 200, JSON.stringify({ sector: ap.sector || null, longName: pr.longName || null, shortName: pr.shortName || null,
        targetMeanPrice: num(fd.targetMeanPrice) || null, currentPrice: num(fd.currentPrice) || num(pr.regularMarketPrice) || null, currency: pr.currency || null,
        trailingPE: num(sd.trailingPE) || null, forwardPE: num(sd.forwardPE) || num(ks.forwardPE) || null, recommendationKey: fd.recommendationKey || null,
        numberOfAnalystOpinions: num(fd.numberOfAnalystOpinions) || 0, marketCap: num(sd.marketCap) || num(pr.marketCap) || null,
        trend: rt.slice(0, 4).map(t => ({ period: t.period, strongBuy: num(t.strongBuy), buy: num(t.buy), hold: num(t.hold), sell: num(t.sell), strongSell: num(t.strongSell) })) }), { 'Content-Type': 'application/json' });
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
