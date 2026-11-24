// Watchlist search / add / remove and the drill-down live chart, run in the customer's browser (ports of the legacy worker's
// handleSearch / handleWatchlist / handleChart). Market lookups go through the stateless relay; Trading 212's instrument list is the
// shared reference table (public, read with the user's token); the watchlist itself is stored encrypted.
(function (root) {
  'use strict';
  const YTYPES = { stock: ['EQUITY', 'ETF'], crypto: ['CRYPTOCURRENCY'], commodity: ['FUTURE'] }, ALL_YTYPES = ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'FUTURE'];
  const COMMODITY_RE = /\b(gold|silver|platinum|palladium|oil|crude|brent|wti|natural gas|gas|copper|nickel|alumin(i)?um|zinc|lithium|uranium|wheat|corn|soy\w*|sugar|coffee|cocoa|cotton|livestock|cattle|commodit\w*|metals?|agricultur\w*|energy|carbon)\b/i;
  const CRYPTO_RE = /\b(bitcoin|ethereum|ether|solana|xrp|ripple|cardano|polkadot|litecoin|crypto\w*|digital assets?|blockchain)\b/i;
  const LEVERAGED_RE = /\b(\d+x|leveraged|short|inverse|daily)\b/i, MINERS_RE = /\b(min(ing|ers?)|producers?|equit(y|ies))\b/i;
  const SYMBOL_RE = /^[A-Za-z0-9.\-^=&]{1,24}$/, SUBUNIT = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };
  const TYPE_NAME = { EQUITY: 'Stock', ETF: 'ETF', CRYPTOCURRENCY: 'Crypto', FUTURE: 'Futures' }, RANGES = new Set(['1d', '5d', '1mo', '6mo', '1y', '5y']);
  const fail = (status, error) => Object.assign(new Error(error), { status });

  function t212Candidates(sym) {
    const m = String(sym).match(/^([A-Z0-9\-]+)(?:\.([A-Z]+))?$/i); if (!m) return [];
    const base = m[1].toUpperCase(), suf = (m[2] || '').toUpperCase();
    if (!suf) return [...new Set([`${base}_US_EQ`, `${base.replace(/-/g, '_')}_US_EQ`, `${base.replace(/-/g, '/')}_US_EQ`, `${base.replace(/-/g, '.')}_US_EQ`])];
    const map = { L: 'l', DE: 'd', AS: 'a' }; return map[suf] ? [`${base}${map[suf]}_EQ`] : [];
  }
  const toYahoo = t => t.endsWith('_US_EQ') ? t.slice(0, -6) : t.replace(/l_EQ$/, '.L').replace(/d_EQ$/, '.DE').replace(/a_EQ$/, '.AS');
  const cryptoGbpVariants = rows => { const out = rows.slice(); rows.forEach(r => { const m = r.symbol.match(/^([A-Z0-9]+)-USD$/); if (m && !rows.some(x => x.symbol === `${m[1]}-GBP`)) out.push(Object.assign({}, r, { symbol: `${m[1]}-GBP`, name: r.name.replace(/\bUSD\b/, 'GBP') })); }); return out; };

  // opts: { store, call(path, init, token)->{ok,status,d}, token, relayUrl, fetchImpl, market (for the analysis after adding), analyse(): Promise, now() }
  function create(opts) {
    const f = opts.fetchImpl || ((...a) => fetch(...a)), now = opts.now || (() => new Date().toISOString());
    async function ref(query) { const r = await opts.call('/rest/v1/instruments?' + query, { method: 'GET' }, opts.token); if (!r.ok) return []; const d = r.d !== undefined ? r.d : await r.json(); return Array.isArray(d) ? d : []; }
    async function yahooSearch(q, types) {
      const r = await f(`${opts.relayUrl}/yahoo-search?q=${encodeURIComponent(q)}`); if (!r.ok) throw new Error(`Yahoo search ${r.status}`);
      return ((await r.json()).quotes || []).filter(x => x.symbol && types.includes(x.quoteType)).map(x => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange || '', type: TYPE_NAME[x.quoteType] || x.quoteType }));
    }
    async function attachT212(rows) {
      const cands = [...new Set(rows.flatMap(r => t212Candidates(r.symbol)))]; if (!cands.length) return rows;
      const found = await ref(`ticker=in.(${cands.map(c => encodeURIComponent(`"${c}"`)).join(',')})&select=ticker`).catch(() => []), have = new Set(found.map(x => x.ticker));
      return rows.map(r => Object.assign({}, r, { t212_ticker: t212Candidates(r.symbol).find(c => have.has(c)) || null }));
    }
    async function t212Products(word, themeRe, limit) {
      const pat = encodeURIComponent(`"*${String(word).replace(/[*,()"]/g, ' ').trim()}*"`);
      const rows = await ref(`select=ticker,name,short_name,currency,type,exchange&type=eq.ETF&or=(name.ilike.${pat},short_name.ilike.${pat})&limit=80`).catch(() => []);
      return rows.filter(r => themeRe.test(r.name || '')).slice(0, limit || 20).map(r => ({ symbol: toYahoo(r.ticker), name: r.name || r.short_name, exchange: r.exchange, currency: r.currency,
        type: MINERS_RE.test(r.name || '') ? 'Miners/equity ETF' : CRYPTO_RE.test(r.name || '') ? 'Crypto ETP' : 'ETC', t212_ticker: r.ticker, leveraged: LEVERAGED_RE.test(r.name || ''), miners: MINERS_RE.test(r.name || '') }));
    }

    async function search(q, category) {
      category = category || 'stock'; if (!YTYPES[category]) throw fail(400, 'Unknown category');
      const query = String(q || '').trim().slice(0, 60); if (query.length < 2) return { results: [] };
      let market = [], note = null; try { market = await yahooSearch(query, YTYPES[category]); } catch (e) { note = `Market search unavailable (${e.message})`; }
      if (category === 'stock') {
        if (!market.length && note) {
          const pat = encodeURIComponent(`"*${query.replace(/[*,()"]/g, ' ')}*"`), rows = await ref(`select=ticker,name,short_name,type,exchange&or=(short_name.ilike.${pat},name.ilike.${pat})&limit=20`);
          return { source: 'trading212', note: note + ' — showing Trading 212 matches', results: rows.map(r => ({ symbol: toYahoo(r.ticker), name: r.name || r.short_name, exchange: r.exchange, type: r.type === 'ETF' ? 'ETF' : 'Stock', t212_ticker: r.ticker, group: 't212' })) };
        }
        return { source: 'yahoo', note, results: (await attachT212(market)).map(r => Object.assign({}, r, { group: 'market' })) };
      }
      const theme = category === 'crypto' ? CRYPTO_RE : COMMODITY_RE, t212 = await t212Products(query, theme);
      if (category === 'crypto') market = cryptoGbpVariants(market);
      return { source: 'yahoo+trading212', note, results: t212.map(r => Object.assign({}, r, { group: 't212' })).concat(market.map(r => Object.assign({}, r, { t212_ticker: null, group: 'market' }))) };
    }

    async function add(symbol, category) {
      category = category || 'stock'; if (!symbol || !SYMBOL_RE.test(symbol)) throw fail(400, 'Invalid symbol'); if (!YTYPES[category]) throw fail(400, 'Unknown category');
      let hit = null; try { hit = (await yahooSearch(symbol, ALL_YTYPES)).find(r => r.symbol.toUpperCase() === symbol.toUpperCase()) || null; } catch (e) {}
      const pair = symbol.toUpperCase().match(/^([A-Z0-9]{2,12})-(USD|GBP|EUR|USDT)$/);
      if (!hit && category === 'crypto' && pair) {
        let base = null; try { base = (await yahooSearch(`${pair[1]}-USD`, YTYPES.crypto)).find(r => r.symbol.toUpperCase() === `${pair[1]}-USD`) || null; } catch (e) {}
        hit = { symbol: symbol.toUpperCase(), name: base ? base.name.replace(/\bUSD\b/, pair[2]) : `${pair[1]} ${pair[2]}`, exchange: 'CCC', type: 'Crypto' };
      }
      if (!hit) {
        const cand = t212Candidates(symbol), inst = cand.length ? await ref(`ticker=in.(${cand.map(c => encodeURIComponent(`"${c}"`)).join(',')})&select=ticker,name,type,exchange`) : [];
        if (inst.length) hit = { symbol, name: inst[0].name, exchange: inst[0].exchange, type: inst[0].type === 'ETF' ? 'ETF' : 'Stock' }; else throw fail(404, 'Symbol not found on Yahoo Finance');
      }
      const withT212 = hit.type === 'Crypto' || hit.type === 'Futures' ? { t212_ticker: null } : (await attachT212([hit]))[0];
      let alternatives = null;
      if (!withT212.t212_ticker && (category === 'crypto' || category === 'commodity')) {
        const theme = category === 'crypto' ? CRYPTO_RE : COMMODITY_RE, word = (hit.name.match(theme) || [hit.name.split(/[\s-]/)[0]])[0];
        alternatives = (await t212Products(word, theme, 20)).filter(a => !a.leveraged && !a.miners).slice(0, 4).map(a => ({ ticker: a.t212_ticker, symbol: a.symbol, name: a.name, currency: a.currency }));
      }
      if (hit.type === 'Futures') hit.name = hit.name.replace(/\s+[A-Z][a-z]{2}\s+\d{2,4}$/, '') + ' (futures)';
      const prev = await opts.store.get('watchlist', hit.symbol);
      await opts.store.put('watchlist', [{ ticker: hit.symbol, name: hit.name, exchange: hit.exchange, type: hit.type, category, t212_ticker: withT212.t212_ticker, alternatives, added_at: prev && prev.added_at ? prev.added_at : now(), ...(prev && Number.isFinite(prev.sort_order) ? { sort_order: prev.sort_order } : {}) }], r => r.ticker);   // re-adding keeps your card position
      let queued = false; if (opts.analyse) { queued = true; Promise.resolve().then(() => opts.analyse()).catch(() => {}); }   // analysis runs in the background; the dashboard polls for it
      return { ok: true, added: hit.symbol, category, t212_ticker: withT212.t212_ticker, alternatives, analysis_queued: queued };
    }

    async function remove(symbol) {
      if (!symbol || !SYMBOL_RE.test(symbol)) throw fail(400, 'Invalid symbol');
      await opts.store.remove('watchlist_analysis', symbol); await opts.store.remove('watchlist', symbol); return { ok: true, removed: symbol };
    }

    async function chart(symbol, range) {
      range = range || '1d'; if (!symbol || !SYMBOL_RE.test(symbol)) throw fail(400, 'Invalid symbol'); if (!RANGES.has(range)) throw fail(400, 'Invalid range');
      const r = await f(`${opts.relayUrl}/yahoo-intraday?s=${encodeURIComponent(symbol)}&range=${range}`); if (!r.ok) throw fail(502, `Yahoo chart ${r.status}`);
      const res = ((await r.json()).chart || {}).result; const c = res && res[0]; if (!c) throw fail(404, 'No chart data');
      const m = c.meta || {}, [ccy, k] = SUBUNIT[m.currency] || [m.currency, 1], q0 = ((c.indicators || {}).quote || [{}])[0], closes = q0.close || [], qo = q0.open || [], qh = q0.high || [], ql = q0.low || [], qv = q0.volume || [];
      const points = (c.timestamp || []).map((t, i) => closes[i] == null ? null : [t, +(closes[i] * k).toFixed(6)]).filter(Boolean);
      // daily candles (open/high/low/close/volume) so the Swing tab can read volume and true ranges; null bars are dropped
      const candles = (c.timestamp || []).map((t, i) => closes[i] == null || qo[i] == null || qh[i] == null || ql[i] == null ? null : [t, +(qo[i] * k).toFixed(6), +(qh[i] * k).toFixed(6), +(ql[i] * k).toFixed(6), +(closes[i] * k).toFixed(6), qv[i] != null ? qv[i] : null]).filter(Boolean);
      const n = v => typeof v === 'number' ? +(v * k).toFixed(6) : null, reg = (m.currentTradingPeriod || {}).regular;
      return { symbol, range, interval: { '1d': '5m', '5d': '30m', '1mo': '1d', '6mo': '1d', '1y': '1d', '5y': '1wk' }[range], points, candles,
        meta: { currency: ccy, quote_currency: m.currency, exchange: m.fullExchangeName || m.exchangeName, timezone: m.exchangeTimezoneName, gmtoffset: m.gmtoffset, price: n(m.regularMarketPrice),
          prev_close: n(m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose), day_high: n(m.regularMarketDayHigh), day_low: n(m.regularMarketDayLow), high52: n(m.fiftyTwoWeekHigh), low52: n(m.fiftyTwoWeekLow),
          volume: m.regularMarketVolume != null ? m.regularMarketVolume : null, market_time: m.regularMarketTime != null ? m.regularMarketTime : null, session: reg ? { start: reg.start, end: reg.end } : null } };
    }
    return { search, add, remove, chart };
  }
  root.ZKWatchlistOps = { create, t212Candidates, toYahoo };
  if (typeof module !== 'undefined') module.exports = root.ZKWatchlistOps;
})(typeof window !== 'undefined' ? window : globalThis);
