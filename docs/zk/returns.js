// Port of services/returns_service.py: your real returns rebuilt from money flows (XIRR, time-weighted, periods).
// Pure function: compute(input) -> returns_summary row. No network; runs on data decrypted in the browser.
(function (root) {
  'use strict';
  const MS = 86400000;
  const dn = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / MS);                 // day number from y/m/d
  const iso = n => new Date(n * MS).toISOString().slice(0, 10);
  const parts = n => { const d = new Date(n * MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
  const day = s => { const p = String(s).slice(0, 10).split('-').map(Number); return dn(p[0], p[1], p[2]); };

  // Python-compatible round(): exact ties go to the even digit, everything else as the correctly rounded decimal.
  function pyRound(x, d) {
    const full = Math.abs(x).toFixed(Math.min(100, d + 40)), cut = full.indexOf('.') + 1 + d;
    if (/^50*$/.test(full.slice(cut))) {                       // exact decimal tie: round half to even digit
      const kept = full.slice(0, cut).replace('.', ''), last = Number(kept[kept.length - 1]);
      const down = Number(full.slice(0, cut)), up = down + Math.pow(10, -d);
      return Math.sign(x) * Number((last % 2 === 0 ? down : up).toFixed(d));
    }
    return Number(x.toFixed(d));
  }
  const r2 = v => v === null || v === undefined || !Number.isFinite(v) ? null : pyRound(v, 2);
  const pct = v => v === null || v === undefined ? null : pyRound(v * 100, 2);
  const nz = v => Number(v || 0);

  function xirr(flows) {
    flows = flows.filter(([, a]) => Math.abs(a) > 1e-9);
    if (flows.length < 2 || !flows.some(([, a]) => a < 0) || !flows.some(([, a]) => a > 0)) return null;
    const d0 = Math.min(...flows.map(f => f[0]));
    const npv = r => flows.reduce((s, [d, a]) => s + a / Math.pow(1 + r, (d - d0) / 365.0), 0);
    let lo = -0.99, hi = 10.0, flo = npv(lo); const fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7) break;
      if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const sumRange = (m, a, b) => { let s = 0; for (const [d, v] of m) if (d >= a && d <= b) s += v; return s; };

  // input: { snap: {total_value, cash, raw}, txns, divs, orders, hist: {series} | null, today: 'YYYY-MM-DD', nowIso }
  function compute(inp) {
    const snap = inp.snap; if (!snap) return { error: 'no snapshot' };
    const acc = (snap.raw || {}).account || {};
    const liveTotal = nz(acc.total || snap.total_value);
    const liveCash = nz(acc.free || snap.cash) + nz(acc.blocked) + nz(acc.pieCash);
    const unrealised = nz(acc.ppl);
    const txns = [...inp.txns].sort((a, b) => String(a.date_time).localeCompare(String(b.date_time)));
    if (!txns.length) return { error: 'no Trading 212 transactions synced yet' };

    const ext = new Map(), cashd = new Map(), dep = new Map(), wdr = new Map(), intr = new Map(), other = new Map(), divd = new Map(), real = new Map();
    for (const t of txns) {
      if (!t.date_time || t.amount === null || t.amount === undefined) continue;
      const d = day(t.date_time), a = Number(t.amount), ty = (t.type || '').toUpperCase();
      add(cashd, d, a);
      if (ty === 'DEPOSIT') { add(ext, d, a); add(dep, d, a); }
      else if (ty === 'WITHDRAW' || ty === 'WITHDRAWAL') { add(ext, d, a); add(wdr, d, a); }
      else if (ty.includes('INTEREST')) add(intr, d, a);
      else add(other, d, a);
    }
    for (const x of inp.divs) if (x.paid_on && x.amount !== null && x.amount !== undefined) { const d = day(x.paid_on); add(cashd, d, Number(x.amount)); add(divd, d, Number(x.amount)); }
    for (const o of inp.orders) {
      if (!o.filled_at) continue;
      const d = day(o.filled_at), v = Math.abs(nz(o.net_value));
      if (o.side === 'BUY') add(cashd, d, -v); else add(cashd, d, v);
      if (o.realised_pnl !== null && o.realised_pnl !== undefined) add(real, d, Number(o.realised_pnl));
    }
    if (!ext.size) return { error: 'no deposits found' };

    const today = day(inp.today), start = Math.min(Math.min(...ext.keys()), Math.min(...cashd.keys()));
    const days = []; for (let n = start; n <= today; n++) days.push(n);
    const hv = new Map();
    if (inp.hist) { const s = inp.hist.series || {}; (s.dates || []).forEach((d, i) => { const v = (s.value || [])[i]; if (v !== null && v !== undefined) hv.set(day(d), Number(v)); }); }

    const V = [], C = [], H = [], F = [], netin = []; let c = 0, h = 0, n = 0;
    for (const d of days) {
      c += cashd.get(d) || 0; if (hv.has(d)) h = hv.get(d); n += ext.get(d) || 0;
      C.push(c); H.push(h); F.push(ext.get(d) || 0); netin.push(n); V.push(h + c);
    }
    const rebuiltTotal = V[V.length - 1]; V[V.length - 1] = liveTotal;
    const R = [0.0];
    for (let i = 1; i < days.length; i++) { const base = V[i - 1] + F[i]; R.push(base > 1 ? V[i] / base - 1 : 0.0); }
    const idx = d => Math.max(0, Math.min(days.length - 1, d - start));

    function period(d0, d1, label) {
      const i0 = d0 >= start ? idx(d0) : -1, i1 = idx(d1), v0 = i0 >= 0 ? V[i0] : 0.0;
      const flows = F.slice(i0 + 1, i1 + 1).reduce((a, b) => a + b, 0), profit = V[i1] - v0 - flows;
      let g = 1.0; for (const r of R.slice(i0 + 1, i1 + 1)) g *= 1 + r;
      let avgCap = v0; for (let i = i0 + 1; i <= i1; i++) avgCap += F[i] * (i1 - i) / Math.max(i1 - i0, 1);
      return { label, from: i0 >= 0 ? iso(d0 + 1) : iso(start), to: iso(d1), start_value: r2(v0), end_value: r2(V[i1]), net_added: r2(flows), profit: r2(profit),
        twr_pct: pct(g - 1), dietz_pct: avgCap > 1 ? pct(profit / avgCap) : null };
    }
    const T = parts(today), ytd0 = dn(T.y, 1, 1) - 1;
    const periods = [period(today - 7, today, '1W'), period(today - 30, today, '1M'), period(today - 91, today, '3M'), period(ytd0, today, 'YTD'), period(today - 365, today, '1Y'), period(start - 1, today, 'All')];

    const totalProfit = V[V.length - 1] - netin[netin.length - 1], yearsHeld = Math.max((today - start) / 365.25, 1e-9);
    const twrAll = R.reduce((p, r) => p * (1 + r), 1) - 1, twrAnn = yearsHeld >= 1 ? Math.pow(1 + twrAll, 1 / yearsHeld) - 1 : null;
    const x = xirr([...[...ext.entries()].sort((a, b) => a[0] - b[0]).map(([d, a]) => [d, -a]), [today, V[V.length - 1]]]);

    const S = parts(start), yearly = {}, monthly = {};
    for (let y = S.y; y <= T.y; y++) {
      const a = dn(y, 1, 1), b = Math.min(dn(y, 12, 31), today), p = period(a - 1, b, String(y));
      Object.assign(p, { deposited: r2(sumRange(dep, a, b)), withdrawn: r2(-sumRange(wdr, a, b)), realised: r2(sumRange(real, a, b)), dividends: r2(sumRange(divd, a, b)), interest: r2(sumRange(intr, a, b)) });
      yearly[String(y)] = p;
    }
    let my = T.y, mm = T.m;
    for (let k = 0; k < 24; k++) {
      const m0 = dn(my, mm, 1); if (m0 < dn(S.y, S.m, 1)) break;
      const nxt = dn(my + (mm === 12 ? 1 : 0), (mm % 12) + 1, 1), key = `${my}-${String(mm).padStart(2, '0')}`;
      monthly[key] = period(m0 - 1, Math.min(nxt - 1, today), key);
      if (mm === 1) { my -= 1; mm = 12; } else mm -= 1;
    }
    const series = { dates: [], value: [], net_in: [] };
    days.forEach((d, i) => { if (i % 7 === 0 || i === days.length - 1) { series.dates.push(iso(d)); series.value.push(r2(V[i])); series.net_in.push(r2(netin[i])); } });

    const sum = m => [...m.values()].reduce((a, b) => a + b, 0);
    const realised = sum(real), dividends = sum(divd), interest = sum(intr), others = sum(other), explained = unrealised + realised + dividends + interest + others;
    const lastNet = netin[netin.length - 1];
    const details = {
      as_of: inp.nowIso, since: iso(start), years: pyRound(yearsHeld, 2), account_value: r2(V[V.length - 1]), holdings_value: r2(V[V.length - 1] - liveCash), cash: r2(liveCash),
      money_in: { deposited: r2(sum(dep)), withdrawn: r2(-sum(wdr)), net: r2(lastNet), deposits: [...dep.values()].filter(v => v).length, first: iso(start) },
      profit: { total: r2(totalProfit), pct_of_net_in: lastNet > 0 ? pct(totalProfit / lastNet) : null, unrealised: r2(unrealised), realised: r2(realised), dividends: r2(dividends), interest: r2(interest), other: r2(others), costs: r2(totalProfit - explained) },
      xirr_pct: pct(x), twr_pct: pct(twrAll), twr_annual_pct: pct(twrAnn), periods, series,
      check: { cash_rebuilt: r2(C[C.length - 1]), cash_t212: r2(liveCash), account_rebuilt: r2(rebuiltTotal), account_t212: r2(liveTotal) },
    };
    return { row: { xirr_pct: pct(x), annualised_pct: pct(x), total_return_pct: details.profit.pct_of_net_in, yearly_breakdown: yearly, monthly_breakdown: monthly, details, updated_at: inp.nowIso } };
  }
  // Reads the encrypted tables, computes, and saves one returns_summary row (replaced on every run).
  async function run(store, nowDate) {
    const d = nowDate || new Date();
    const snaps = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const hist = (await store.load('pie_history')).find(r => r.pie === '__ALL__') || null;
    const out = compute({ snap: snaps[0] || null, txns: await store.load('t212_transactions'), divs: await store.load('t212_dividends'),
      orders: (await store.load('t212_orders')).filter(o => ['FILLED', 'PARTIALLY_FILLED'].includes(o.status)), hist, today: d.toISOString().slice(0, 10), nowIso: d.toISOString() });
    if (out.row) await store.put('returns_summary', [out.row], () => 'main');
    return out;
  }
  root.ZKReturns = { compute, run, xirr, pyRound };
  if (typeof module !== 'undefined') module.exports = root.ZKReturns;
})(typeof window !== 'undefined' ? window : globalThis);
