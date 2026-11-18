// Public market data through the relay (Yahoo daily charts). Used as the fallback for any ticker; no credentials involved.
(function (root) {
  'use strict';
  function parse(j) {
    const r = j && j.chart && j.chart.result && j.chart.result[0]; if (!r) return null;
    const q = (r.indicators.quote || [{}])[0], adj = ((r.indicators.adjclose || [{}])[0] || {}).adjclose;
    const out = { symbol: r.meta.symbol, currency: r.meta.currency, longName: r.meta.longName || null, shortName: r.meta.shortName || null, price: r.meta.regularMarketPrice,
      exchange: r.meta.fullExchangeName || r.meta.exchangeName || null, regularStart: ((r.meta.currentTradingPeriod || {}).regular || {}).start || null, regularEnd: ((r.meta.currentTradingPeriod || {}).regular || {}).end || null, dates: [], close: [], volume: [], high: [], low: [], adjclose: [],
      splits: Object.values((r.events || {}).splits || {}).map(s => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.numerator / s.denominator })) };
    (r.timestamp || []).forEach((t, i) => {
      if (q.close[i] == null) return;
      out.dates.push(new Date(t * 1000).toISOString().slice(0, 10)); out.close.push(q.close[i]); out.volume.push(q.volume ? q.volume[i] : null);
      out.high.push(q.high ? q.high[i] : null); out.low.push(q.low ? q.low[i] : null); out.adjclose.push(adj && adj[i] != null ? adj[i] : q.close[i]);
    });
    return out;
  }
  // Shared public cache (table market_cache, filled by the central job for popular symbols). Returns the payload if fresh, else null.
  // call: the app's Supabase fetch helper; token: signed-in JWT. Every lookup is public data, but we still only ask for symbols the user needs.
  function sharedCache(call, token, nowMs, maxAgeH) {
    const maxAge = (maxAgeH || 48) * 3600000;
    return async function (key) {
      try {
        const r = await call(`/rest/v1/market_cache?select=payload,fetched_at&key=eq.${encodeURIComponent(key)}&limit=1`, {}, token);
        if (!r || !r.ok) return null; const row = (await r.json())[0];
        return row && (nowMs() - Date.parse(row.fetched_at)) <= maxAge ? row.payload : null;
      } catch (e) { return null; }
    };
  }
  // opts: { relayUrl, fetchImpl, concurrency, shared(key)->payload|null }
  function create(opts) {
    const f = opts.fetchImpl || ((...a) => fetch(...a)), cache = new Map(), conc = opts.concurrency || 3; let active = 0; const queue = [];
    const pump = () => { while (active < conc && queue.length) { active++; const job = queue.shift(); job().finally(() => { active--; pump(); }); } };
    const limited = fn => new Promise((res, rej) => { queue.push(() => fn().then(res, rej)); pump(); });
    async function chart(sym, range) {
      const key = sym + '|' + (range || '1y');
      if (!cache.has(key)) cache.set(key, (async () => {
        if (opts.shared) { const sh = await opts.shared(`chart:${sym}:${range || '1y'}`); const p = sh && parse(sh); if (p) return p; }
        return limited(async () => {
        for (let a = 0; a < 3; a++) {
          const r = await f(`${opts.relayUrl}/yahoo?s=${encodeURIComponent(sym)}&range=${range || '1y'}`);
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, (opts.retryMs || 2000) * (a + 1))); continue; }
          if (!r.ok) return null;
          return parse(await r.json());
        }
        return null;
      }); })());
      return cache.get(key);
    }
    const infos = new Map();
    async function info(sym) {
      if (!infos.has(sym)) infos.set(sym, (async () => { const sh = opts.shared && await opts.shared(`info:${sym}`); if (sh) return sh; return limited(async () => { try { const r = await f(`${opts.relayUrl}/yahoo-info?s=${encodeURIComponent(sym)}`); return r.ok ? await r.json() : {}; } catch (e) { return {}; } }); })());
      return infos.get(sym);
    }
    const details = new Map();
    async function detail(sym) {
      if (!details.has(sym)) details.set(sym, (async () => { const sh = opts.shared && await opts.shared(`detail:${sym}`); if (sh) return sh; return limited(async () => { try { const r = await f(`${opts.relayUrl}/yahoo-detail?s=${encodeURIComponent(sym)}`); return r.ok ? await r.json() : { info: {}, rec_counts: null }; } catch (e) { return { info: {}, rec_counts: null }; } }); })());
      return details.get(sym);
    }
    const news = new Map();
    async function headlines(sym) {
      if (!news.has(sym)) news.set(sym, limited(async () => { try { const r = await f(`${opts.relayUrl}/yahoo-news?s=${encodeURIComponent(sym)}`); return r.ok ? ((await r.json()).titles || []) : []; } catch (e) { return []; } }));
      return news.get(sym);
    }
    return { chart, info, detail, headlines };
  }
  root.ZKMarket = { create, parse, sharedCache };
  if (typeof module !== 'undefined') module.exports = root.ZKMarket;
})(typeof window !== 'undefined' ? window : globalThis);
