// Port of services/pie_history_service.py: day-by-day holdings, invested and value per pie / direct / sold / whole account,
// rebuilt from your fills and market prices. compute() is pure; run() gathers prices through the relay.
(function (root) {
  'use strict';
  const SUBUNIT = { GBX: ['GBP', 0.01], GBp: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };
  const QTY_EPS = 1e-4, MS = 86400000;
  const R = () => root.ZKReturns;
  const pyRound = (x, d) => R().pyRound(x, d);
  const r2 = v => v === null || v === undefined || !Number.isFinite(v) ? null : pyRound(v, 2);
  const num = v => Number(v || 0);
  const isoOf = n => new Date(n * MS).toISOString().slice(0, 10);
  const dnOf = s => { const p = s.slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / MS); };
  const sortedStr = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const fmtG4 = x => String(Number(x.toPrecision(4)));

  function bdays(first, last) { const out = []; for (let n = dnOf(first); n <= dnOf(last); n++) { const wd = new Date(n * MS).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(isoOf(n)); } return out; }
  // series {dates[], close[]} -> array over dkeys: last value on or before each day (null before the first)
  function ffillOnto(dkeys, ser) {
    const m = new Map(); ser.dates.forEach((d, i) => { if (ser.close[i] !== null && ser.close[i] !== undefined && !Number.isNaN(ser.close[i])) m.set(d, ser.close[i]); });
    const out = []; let last = null;
    for (const d of dkeys) { if (m.has(d)) last = m.get(d); out.push(last); }
    return out;
  }
  const bfill = a => { const out = [...a]; let nxt = null; for (let i = out.length - 1; i >= 0; i--) { if (out[i] === null) out[i] = nxt; else nxt = out[i]; } return out; };

  // inp: { snap:{raw,total_value,cash,total_ppl}, positions: {ticker:{exchange,quantity}}, fills, ccyOf, prices:{sym:{dates,close,splits:[[d,ratio]]}}, fx:{ccy:{dates,close}}, today, symOf }
  function compute(inp) {
    const snap = inp.snap, raw = snap.raw || {}, positions = inp.positions, S = root.ZKSymbols;
    const pieInst = {}, pieOf = {}, pieLive = {};
    for (const p of raw.pies || []) {
      let tv = 0, ti = 0, tr = 0;
      for (const inst of p.instruments || []) {
        const r = inst.result || {}, v = num(r.priceAvgValue), i = num(r.priceAvgInvestedValue), res = num(r.priceAvgResult), q = num(inst.qty);
        if (v <= 0 && q <= 0) continue;
        pieInst[inst.ticker] = { value: v, invested: i, result: res, qty: q, pie: p.name }; pieOf[inst.ticker] = p.name; tv += v; ti += i; tr += res;
      }
      if (tv > 0) pieLive[p.name] = { value: pyRound(tv, 2), invested: pyRound(ti, 2), result: pyRound(tr, 2) };
    }
    const fills = inp.fills.filter(f => f.ticker && f.filled_at && num(f.quantity) !== 0);
    if (!fills.length) return { error: 'no fills synced yet' };
    const tickers = sortedStr(new Set([...fills.map(f => f.ticker), ...Object.keys(positions)]));
    const firstDay = fills.map(f => f.filled_at.slice(0, 10)).sort()[0];
    const symOf = {}; for (const t of tickers) symOf[t] = S.t212ToYahoo(t, (positions[t] || {}).exchange || S.exchangeOf(t))[0];
    const dkeys = bdays(firstDay, inp.today), N = dkeys.length, di = new Map(dkeys.map((d, i) => [d, i]));
    const fxCache = {}, fx = ccy => { if (ccy === 'GBP') return null; if (!(ccy in fxCache)) fxCache[ccy] = inp.fx[ccy] ? bfill(ffillOnto(dkeys, inp.fx[ccy])) : null; return fxCache[ccy]; };
    const byT = {}; for (const f of fills) (byT[f.ticker] = byT[f.ticker] || []).push(f);
    const cumulate = daily => { const out = []; let acc = 0; for (const k of dkeys) { acc += daily[k] || 0; out.push(Math.abs(acc) > 1e-9 ? acc : 0); } return out; };

    const T = {}, excluded = [], verification = [], fillChecks = [], notes = [];
    for (const t of tickers) {
      const sym = symOf[t], px = inp.prices[sym];
      const closesOk = !!(px && px.dates.some((d, i) => px.close[i] !== null && px.close[i] !== undefined && !Number.isNaN(px.close[i])));
      const splitList = px && px.splits ? px.splits.filter(([, v]) => v && v > 0) : [];
      const fillPx = [], q = { pie: {}, direct: {} }, iv = { pie: {}, direct: {} };
      for (const f of byT[t] || []) {
        const d = f.filled_at.slice(0, 10), factor = splitList.length ? splitList.reduce((p, [sd, r]) => (sd > d ? p * r : p), 1) : 1;
        const ch = f.channel === 'AUTOINVEST' ? 'pie' : 'direct', sign = f.side === 'BUY' ? 1 : -1, sq = Math.abs(num(f.quantity)) * factor;
        q[ch][d] = (q[ch][d] || 0) + sign * sq;
        if (sq > 0 && num(f.net_value) > 0) fillPx.push([d, Math.abs(num(f.net_value)) / sq]);
        iv[ch][d] = (iv[ch][d] || 0) + sign * Math.abs(num(f.net_value));
      }
      let qp = cumulate(q.pie), qd = cumulate(q.direct), ip = cumulate(iv.pie), idr = cumulate(iv.direct);
      const qt = qp.map((a, i) => a + qd[i]), it = ip.map((a, i) => a + idr[i]);
      const liveTotal = num((positions[t] || {}).quantity), livePie = (pieInst[t] || {}).qty || 0, liveDir = Math.max(liveTotal - livePie, 0);
      const splitOk = Math.abs(qp[N - 1] - livePie) < QTY_EPS && Math.abs(qd[N - 1] - liveDir) < QTY_EPS;
      if (!splitOk && liveTotal > 0) {
        const fp = livePie / liveTotal;
        qp = qt.map(x => x * fp); qd = qt.map(x => x * (1 - fp)); ip = it.map(x => x * fp); idr = it.map(x => x * (1 - fp));
      }
      const qCcy = inp.ccyOf[t] || (((raw.instrument_meta || {})[t]) || {}).ccy || 'GBP';
      const [ccy, unit] = SUBUNIT[qCcy] || [qCcy, 1.0];
      let pps = null;
      if (closesOk) {
        const c = ffillOnto(dkeys, px), fxs = fx(ccy);
        if (fxs !== null || ccy === 'GBP') {
          pps = c.map((v, i) => v === null ? null : v * unit / (fxs !== null ? fxs[i] : 1.0));
          if (t in pieInst && pieInst[t].qty > 0 && pps[N - 1]) {
            const livePps = pieInst[t].value / pieInst[t].qty; let matched = false;
            for (const k of [1, 100, 0.01]) if (Math.abs(pps[N - 1] * k / livePps - 1) <= 0.12) { if (k !== 1) pps = pps.map(p => p !== null ? p * k : null); matched = true; break; }
            if (!matched) { excluded.push({ ticker: t, reason: `market price £${pps[N - 1].toFixed(4)} doesn't match Trading 212's £${livePps.toFixed(4)} — valued at cost` }); pps = null; }
          }
          if (pps !== null && fillPx.length) {
            const ratios = fillPx.filter(([d]) => di.has(d) && pps[di.get(d)]).map(([d, fp]) => fp / pps[di.get(d)]).sort((a, b) => a - b);
            if (ratios.length) {
              const med = ratios[Math.floor(ratios.length / 2)]; fillChecks.push([t, med, ratios.length]);
              if (!(t in pieInst) && Math.abs(med - 1) > 0.12) {
                const kk = [100, 0.01].find(k => Math.abs(med / k - 1) <= 0.12), k = kk !== undefined ? kk : med;
                pps = pps.map(p => p !== null ? p * k : null); notes.push({ ticker: t, note: `history rescaled ×${fmtG4(k)} to match the prices you traded at` });
              }
            }
          }
        } else excluded.push({ ticker: t, reason: `no FX history for ${ccy} — valued at cost while held` });
      } else if (qt.some(x => x)) excluded.push({ ticker: t, reason: `no price data for ${sym} (likely delisted) — valued at cost while held` });
      const atCost = pps === null;
      const value = (qa, ia) => atCost ? qa.map((x, i) => Math.abs(x) > 1e-9 ? Math.max(ia[i], 0.0) : 0.0) : qa.map((x, i) => Math.abs(x) <= 1e-9 ? 0.0 : (pps[i] === null ? null : x * pps[i]));
      T[t] = { pie: { qty: qp, invested: ip, value: value(qp, ip) }, direct: { qty: qd, invested: idr, value: value(qd, idr) }, total: { qty: qt, invested: it, value: value(qt, it) } };
      if (liveTotal > 0 || Math.abs(qt[N - 1]) > QTY_EPS) {
        const okTotal = Math.abs(qt[N - 1] - liveTotal) < Math.max(QTY_EPS, liveTotal * 0.001);
        verification.push({ ticker: t, pie: pieOf[t] !== undefined ? pieOf[t] : null, qty_rebuilt: pyRound(qt[N - 1], 6), qty_t212: pyRound(liveTotal, 6), pie_qty_t212: pyRound(livePie, 6), direct_qty_t212: pyRound(liveDir, 6),
          ok: okTotal, split: splitOk ? 'exact' : 'apportioned', issue: okTotal ? null : (liveTotal ? 'quantity differs from Trading 212' : 'rebuilt as still held, but not in your Trading 212 account'),
          note: splitOk || !liveTotal ? null : "shares were moved between pie and direct holdings — daily split uses today's proportion" });
      }
    }
    const series = (members, channel, liveNow, perTicker = true) => {
      const vals = [], invs = [];
      for (let i = 0; i < N; i++) { let v = 0, ivt = 0, ok = true; for (const t of members) { const d = T[t][channel]; ivt += d.invested[i]; if (d.value[i] === null) ok = false; else v += d.value[i]; } vals.push(ok ? r2(v) : null); invs.push(r2(ivt)); }
      let start = N - 1; for (let i = 0; i < N; i++) if ((vals[i] || 0) > 0 || Math.abs(invs[i] || 0) > 0) { start = i; break; }
      const s = { source: 'orders', channel, dates: dkeys.slice(start), value: vals.slice(start), invested: invs.slice(start), current: liveNow,
        verification: verification.filter(x => members.includes(x.ticker)), excluded: excluded.filter(x => members.includes(x.ticker)) };
      if (perTicker) { s.tickers = {}; for (const t of members) s.tickers[t] = { qty: T[t][channel].qty.slice(start).map(x => pyRound(x, 6)), value: T[t][channel].value.slice(start).map(r2), invested: T[t][channel].invested.slice(start).map(r2) }; }
      return s;
    };
    const a = raw.account || {}; let accValue, accResult;
    if (a.invested !== null && a.invested !== undefined) { accResult = num(a.ppl); accValue = Number(a.invested) + accResult; }
    else { accValue = num(snap.total_value) - num(snap.cash); accResult = num(snap.total_ppl); }
    const acc = { value: pyRound(accValue, 2), invested: pyRound(accValue - accResult, 2), result: pyRound(accResult, 2) };
    const piesTot = {}; for (const k of ['value', 'invested', 'result']) piesTot[k] = Object.values(pieLive).reduce((s, c) => s + c[k], 0);
    const directLive = {}; for (const k of ['value', 'invested', 'result']) directLive[k] = pyRound(acc[k] - piesTot[k], 2);
    const rows = [];
    for (const [pie, cur] of Object.entries(pieLive)) rows.push({ pie, series: series(tickers.filter(t => pieOf[t] === pie), 'pie', cur) });
    const heldDirect = tickers.filter(t => positions[t] && T[t].direct.qty[N - 1] > 1e-9);
    if (heldDirect.length) rows.push({ pie: '__DIRECT__', series: series(heldDirect, 'direct', directLive) });
    const sold = tickers.filter(t => !positions[t]);
    if (sold.length) rows.push({ pie: '__SOLD__', series: series(sold, 'total', null, false) });
    rows.push({ pie: '__ALL__', series: series(tickers, 'total', acc, false) });
    return { rows, symOf, tickers, firstDay, fillChecks, notes };
  }

  // Gathers the inputs from the encrypted store + market data, computes, saves one pie_history row per series.
  // opts: { store, market (ZKMarket), ccyOf }
  async function run(opts, nowDate) {
    const { store, market } = opts, S = root.ZKSymbols, d = nowDate || new Date(), today = d.toISOString().slice(0, 10);
    const snaps = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), snap = snaps[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = {}; for (const p of await store.load('positions')) if (p.snapshot_id === snap.id) positions[p.ticker] = { exchange: p.exchange, quantity: p.quantity };
    const orders = (await store.load('t212_orders')).filter(o => ['FILLED', 'PARTIALLY_FILLED'].includes(o.status));
    const fills = orders.map(o => ({ ticker: o.ticker, side: o.side, status: o.status, filled_at: o.filled_at, quantity: o.quantity, net_value: o.net_value, id: o.id, channel: ((o.raw || {}).order || {}).initiatedFrom }))
      .sort((a, b) => String(a.filled_at).localeCompare(String(b.filled_at)) || String(a.id).localeCompare(String(b.id)));
    const tickers = sortedStr(new Set([...fills.filter(f => f.ticker).map(f => f.ticker), ...Object.keys(positions)]));
    const first = fills.map(f => (f.filled_at || '').slice(0, 10)).filter(Boolean).sort()[0] || today;
    const syms = [...new Set(tickers.map(t => S.t212ToYahoo(t, (positions[t] || {}).exchange || S.exchangeOf(t))[0]))];
    const prices = {}, ccyOf = Object.assign({}, opts.ccyOf || {}), range = (dnOf(today) - dnOf(first)) > 1800 ? 'max' : (dnOf(today) - dnOf(first)) > 730 ? '5y' : (dnOf(today) - dnOf(first)) > 365 ? '2y' : '1y';
    await Promise.all(syms.map(async s => { const c = await market.chart(s, range); if (c) { prices[s] = { dates: c.dates, close: c.close, splits: c.splits.map(x => [x.date, x.ratio]) }; for (const t of tickers) if (!ccyOf[t] && S.t212ToYahoo(t, (positions[t] || {}).exchange || S.exchangeOf(t))[0] === s && c.currency) ccyOf[t] = c.currency; } }));
    const need = new Set(); for (const t of tickers) { const c = ccyOf[t] || ((snap.raw || {}).instrument_meta || {})[t] && snap.raw.instrument_meta[t].ccy || 'GBP'; const u = ({ GBX: 'GBP', GBp: 'GBP', ZAc: 'ZAR', ILA: 'ILS' })[c] || c; if (u !== 'GBP') need.add(u); }
    const fxm = {}; await Promise.all([...need].map(async c => { const x = await market.chart(`GBP${c}=X`, range); if (x) fxm[c] = { dates: x.dates, close: x.close }; }));
    const out = compute({ snap, positions, fills, ccyOf, prices, fx: fxm, today });
    if (out.error) return out;
    const stamp = d.toISOString(), existing = await store.load('pie_history');
    await store.put('pie_history', out.rows.map(r => Object.assign({ updated_at: stamp }, r)), r => r.pie);
    const keep = new Set(out.rows.map(r => r.pie)); for (const e of existing) if (!keep.has(e.pie)) await store.remove('pie_history', e.pie);
    return out;
  }
  root.ZKPieHistory = { compute, run };
  if (typeof module !== 'undefined') module.exports = root.ZKPieHistory;
})(typeof window !== 'undefined' ? window : globalThis);
