// Repairs duplicate encrypted rows. The first migration stored rows under random ids, but the app stores a row under an id derived from its
// natural key (store.put). A re-sync therefore wrote a second copy of every row it had already seen. This scans, then fixes in a safe order:
// (1) make sure every logical row exists under its deterministic id, (2) re-read and check, (3) only then delete the surplus copies. Idempotent.
(function (root) {
  'use strict';
  const KEYS = {
    t212_orders: r => r.id, t212_transactions: r => r.reference, t212_dividends: r => r.reference, dividends: r => r.reference, realised_pnl: r => r.order_id,
    holding_decisions: r => r.report_date + '|' + r.ticker, pie_history: r => r.pie, profit_booking: r => r.ticker, profit_booking_summary: () => 'main',
    returns_summary: () => 'main', strategy_recommendations: () => 'main', value_buy_scores: r => r.ticker, analyst_ratings: r => r.ticker,
    watchlist: r => r.ticker, watchlist_analysis: r => r.ticker, alerts: r => r.id, portfolio_snapshots: r => r.id, positions: r => r.id,
  };
  const PAGE = 1000, DEL = 50;
  function create(ctx) {
    const { call, token, uid, dk } = ctx, store = root.ZKStore.create({ call, token, uid, dk });
    async function readRaw(kind) {
      const out = [];
      for (let off = 0; ; off += PAGE) {
        const r = await call(`/rest/v1/enc_rows?select=id,nonce,ct&kind=eq.${kind}&order=id&limit=${PAGE}&offset=${off}`, {}, token);
        if (!r.ok) throw new Error(`read ${kind}: ${r.status}`);
        out.push(...r.d); if (r.d.length < PAGE) break;
      }
      return out;
    }
    async function analyse(kind) {
      const raw = await readRaw(kind), keyOf = KEYS[kind], groups = new Map(); let bad = 0, unkeyed = 0;
      for (const e of raw) {
        let row; try { row = await root.ZK.decryptRow(dk, e, kind, e.id, uid); } catch (x) { bad++; continue; }
        const k = keyOf(row); if (k == null || String(k).includes('undefined')) { unkeyed++; continue; }
        const rid = await store.id(kind, k);
        if (!groups.has(rid)) groups.set(rid, { rid, row: null, rowDet: null, others: [] });
        const g = groups.get(rid);
        if (e.id === rid) g.rowDet = row; else { g.others.push(e.id); g.row = g.row || row; }
      }
      const total = raw.length, distinct = groups.size + 0, surplus = [...groups.values()].reduce((n, g) => n + g.others.length - (g.rowDet ? 0 : 1), 0);
      return { kind, total, distinct, surplus, bad, unkeyed, groups };
    }
    async function scan() {
      const rep = [];
      for (const kind of Object.keys(KEYS)) { const a = await analyse(kind); rep.push({ kind, total: a.total, distinct: a.distinct, surplus: a.surplus, bad: a.bad, unkeyed: a.unkeyed }); }
      return rep;
    }
    async function fix(log) {
      log = log || (() => {}); const rep = [];
      for (const kind of Object.keys(KEYS)) {
        const a = await analyse(kind);
        if (a.bad || a.unkeyed) { log(`${kind}: skipped (${a.bad} unreadable, ${a.unkeyed} without a key)`); rep.push({ kind, skipped: true }); continue; }
        const need = [...a.groups.values()].filter(g => !g.rowDet);                                   // logical rows still only under a random id
        if (need.length) await store.put(kind, need.map(g => g.row), KEYS[kind]);
        const check = await readRaw(kind), have = new Set(check.map(e => e.id));
        const missing = [...a.groups.values()].filter(g => !have.has(g.rid));
        if (missing.length) throw new Error(`${kind}: ${missing.length} rows did not save; nothing was deleted`);
        const drop = [...a.groups.values()].flatMap(g => g.others);
        for (let i = 0; i < drop.length; i += DEL) {
          const r = await call(`/rest/v1/enc_rows?kind=eq.${kind}&id=in.(${drop.slice(i, i + DEL).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, token);
          if (!r.ok) throw new Error(`delete ${kind}: ${r.status}`);
        }
        const after = await readRaw(kind);
        if (after.length !== a.groups.size) throw new Error(`${kind}: expected ${a.groups.size} rows, found ${after.length}`);
        log(`${kind}: ${a.total} → ${after.length}${drop.length ? ` (removed ${drop.length} extra, rewrote ${need.length})` : need.length ? ` (rewrote ${need.length})` : ' (already clean)'}`);
        rep.push({ kind, before: a.total, after: after.length });
      }
      return rep;
    }
    return { scan, fix };
  }
  root.ZKDedupe = { KEYS, create };
  if (typeof module !== 'undefined') module.exports = root.ZKDedupe;
})(typeof window !== 'undefined' ? window : globalThis);
