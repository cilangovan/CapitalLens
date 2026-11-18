// Trading 212 history sync, run in the browser. Port of services/t212_sync_service.py:
// same endpoints, same mappers, same incremental rules, same derived tables (realised_pnl, dividends).
// Differences: the API key never leaves this browser except inside the request to the stateless relay,
// and every stored row is encrypted before it is uploaded.
(function (root) {
  'use strict';
  const MAX_RETRIES = 6;
  const nz = v => v === undefined ? null : v;
  const f = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  };
  const round = (x, d) => { const m = Math.pow(10, d); return Math.round((x + Number.EPSILON) * m) / m; };
  const pyStr = v => v === null || v === undefined ? 'None' : String(v);

  // ── mappers: keep raw, extract the fields we query on ──
  function mapOrder(it, now) {
    const fill = it.fill || {}, order = it.order || {}, hasFill = Object.keys(fill).length > 0;
    const wi = fill.walletImpact || {};
    const oid = String(order.id || '');
    return {
      id: fill.id != null ? String(fill.id) : 'order:' + oid,
      order_id: oid,
      ticker: order.ticker || (order.instrument || {}).ticker || null,
      side: nz(order.side), status: nz(order.status),
      filled_at: fill.filledAt || order.createdAt || null,
      quantity: f(hasFill ? fill.quantity : order.filledQuantity),
      price: f(fill.price),
      net_value: f(wi.netValue), realised_pnl: f(wi.realisedProfitLoss), fx_rate: f(wi.fxRate),
      raw: it, last_seen: now(),
    };
  }
  const mapDividend = (it, now) => ({ reference: pyStr(it.reference), ticker: nz(it.ticker), paid_on: nz(it.paidOn), amount: f(it.amount), quantity: f(it.quantity), type: nz(it.type), raw: it, last_seen: now() });
  const mapTxn = (it, now) => ({ reference: pyStr(it.reference), type: nz(it.type), amount: f(it.amount), date_time: nz(it.dateTime), raw: it, last_seen: now() });

  const ENDPOINTS = [
    { name: 'orders',       path: '/api/v0/equity/history/orders?limit=50', kind: 't212_orders',       key: 'id',        map: mapOrder },
    { name: 'dividends',    path: '/api/v0/history/dividends?limit=50',     kind: 't212_dividends',    key: 'reference', map: mapDividend },
    { name: 'transactions', path: '/api/v0/history/transactions?limit=50',  kind: 't212_transactions', key: 'reference', map: mapTxn },
  ];

  // Paced, retrying Trading 212 client that talks through the stateless relay.
  function client(opts) {
    const relayUrl = opts.relayUrl;
    const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
    const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const nowMs = opts.nowMs || (() => Date.now());
    const PACE = opts.pace == null ? 10500 : opts.pace;
    const log = opts.log || (() => {});
    let nextAt = 0, creds = null;
    async function get(path, o) {
      const after = o && o.after != null ? o.after : PACE;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const wait = nextAt - nowMs();
        if (wait > 0) await sleep(wait);
        nextAt = nowMs() + (o && o.after != null ? Math.min(after, PACE) : PACE);
        let resp;
        try {
          resp = await fetchImpl(relayUrl + '/t212?p=' + encodeURIComponent(path), { method: 'GET', headers: { 'X-T212-Auth': 'Basic ' + creds, Accept: 'application/json' } });
        } catch (e) { log('network error, retrying in 30s'); await sleep(30000); continue; }
        if (resp.status === 429 || resp.status >= 500) {
          const reset = resp.headers && resp.headers.get && resp.headers.get('x-ratelimit-reset');
          const pause = Math.max(15, Math.min(90, reset && /^\d+$/.test(reset) ? Number(reset) - nowMs() / 1000 : 60));
          log(`${resp.status}: waiting ${Math.round(pause)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(pause * 1000); continue;
        }
        if (!resp.ok) { let b = ''; try { b = (await resp.text()).slice(0, 200); } catch (e) {} throw new Error(`T212 ${path.split('?')[0]} -> ${resp.status}: ${b}`); }
        return resp.json();
      }
      throw new Error(`T212 ${path.split('?')[0]}: gave up after ${MAX_RETRIES} retries`);
    }
    return { get, setCreds: (k, s) => { creds = btoa(`${k}:${s}`); }, clear: () => { creds = null; }, nowMs };
  }

  // opts: { store, relayUrl, fetchImpl, sleep, now, pace (ms), log }
  function create(opts) {
    const { store } = opts;
    const api = opts.client || client(opts);
    const nowMs = api.nowMs;
    const now = () => new Date(nowMs()).toISOString();
    const log = opts.log || (() => {});
    const t212 = p => api.get(p);

    async function syncOne(ep, force) {
      const state = (await store.get('sync_state', ep.name)) || {};
      const have = new Map((await store.load(ep.kind)).map(r => [r[ep.key], r]));
      // A full walk is only needed when there is no stored history yet, or an earlier full walk was cut off part-way (state.walking).
      // History that arrived another way (the migration copy of the old dashboard) counts as complete: walking it all again would take
      // many minutes at Trading 212's 6 requests/minute and gain nothing.
      const full = force || (!state.last_full && (have.size === 0 || !!state.walking));
      log(`[${ep.name}] ${full ? 'full walk' : 'incremental' + (have.size && !state.last_full ? ' (history already stored)' : '')}`);
      if (full) await store.put('sync_state', [{ ...state, endpoint: ep.name, walking: now() }], s => s.endpoint);
      let nxt = ep.path, pages = 0, fresh = 0, seen = 0;
      while (nxt) {
        const resp = await t212(nxt);
        const items = Array.isArray(resp) ? resp : (resp && resp.items) || [];
        const rows = items.map(it => ep.map(it, now)).filter(r => !['None', '', null, undefined].includes(r[ep.key]));
        let known = 0;
        for (const r of rows) {
          const old = have.get(r[ep.key]);
          if (old) { known++; r.first_seen = old.first_seen; } else r.first_seen = now();
        }
        await store.put(ep.kind, rows, r => r[ep.key]);
        rows.forEach(r => have.set(r[ep.key], r));
        pages++; seen += rows.length; fresh += rows.length - known;
        log(`  page ${pages}: ${rows.length} items, ${rows.length - known} new`);
        if (!full && rows.length && known === rows.length) { log('  reached already-stored history, stopping'); break; }
        nxt = resp && !Array.isArray(resp) ? resp.nextPagePath : null;
      }
      const st = { endpoint: ep.name, last_run: now(), items_total: have.size, status: 'ok', detail: `${pages} pages, ${seen} items read, ${fresh} new`, last_full: full ? now() : (state.last_full || (have.size ? now() : undefined)) };
      await store.put('sync_state', [st], s => s.endpoint);
      return { name: ep.name, ok: true, pages, seen, fresh, total: have.size };
    }

    // realised_pnl and dividends (used by the dashboards) rebuilt from the complete raw rows
    async function rebuildDerived() {
      const orders = await store.load('t212_orders'), rows = [];
      orders.sort((a, b) => String(a.filled_at || '').localeCompare(String(b.filled_at || '')) || String(a.id).localeCompare(String(b.id)));
      for (const o of orders) {
        if (!['FILLED', 'PARTIALLY_FILLED'].includes(o.status) || !o.ticker) continue;
        const nv = Math.abs(o.net_value || 0), rp = o.realised_pnl || 0;
        rows.push({ order_id: o.id, ticker: o.ticker, display: o.ticker.split('_')[0], filled_date: (o.filled_at || '').slice(0, 10) || null,
          quantity: round(o.quantity || 0, 6), fill_price: round(o.price || 0, 4), avg_cost: 0, realised_pnl: round(rp, 4),
          realised_pnl_pct: nv && o.side === 'SELL' ? round(rp / nv * 100, 2) : 0, side: o.side });
      }
      await store.put('realised_pnl', rows, r => r.order_id);
      const divs = await store.load('t212_dividends');
      const drows = divs.map(d => ({ reference: d.reference, ticker: d.ticker, display: (d.ticker || '').split('_')[0], paid_date: (d.paid_on || '').slice(0, 10) || null, amount: round(d.amount || 0, 4) }));
      await store.put('dividends', drows, r => r.reference);
      log(`[derived] realised_pnl ${rows.length} fills, dividends ${divs.length}`);
      return { realised: rows.length, dividends: divs.length };
    }

    async function run(apiKey, apiSecret, o) {
      api.setCreds(apiKey, apiSecret);
      const force = !!(o && o.full), results = [];
      for (const ep of ENDPOINTS) {
        let prev = {}; try { prev = (await store.get('sync_state', ep.name)) || {}; } catch (x) {}
        try { results.push(await syncOne(ep, force)); }
        catch (e) {
          try { prev = (await store.get('sync_state', ep.name)) || prev; } catch (x) {}
          results.push({ name: ep.name, ok: false, error: String(e.message || e) });
          log(`  failed ${ep.name}: ${e.message}`);
          try { await store.put('sync_state', [{ endpoint: ep.name, last_run: now(), status: 'error', detail: String(e.message).slice(0, 300), last_full: prev.last_full, walking: prev.walking }], s => s.endpoint); } catch (x) {}
        }
      }
      const derived = await rebuildDerived();
      api.clear();
      return { results, derived, failed: results.filter(r => !r.ok).map(r => r.name) };
    }
    return { run, ENDPOINTS };
  }
  root.ZKT212 = { create, client, mapOrder, mapDividend, mapTxn, ENDPOINTS };
  if (typeof module !== 'undefined') module.exports = root.ZKT212;
})(typeof window !== 'undefined' ? window : globalThis);
