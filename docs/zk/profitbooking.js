// Port of services/profit_booking_service.py: five-layer score per holding, staged profit-booking ladder, trailing exit,
// sizing, concentration and a portfolio summary. compute() is pure; run() gathers prices/info through the relay.
(function (root) {
  'use strict';
  const RISK_PER_TRADE_PCT = 1.0, MAX_STOCK_PCT = 8.0, MAX_SECTOR_PCT = 25.0, ATR_MULT = 3.0, DRIFT_PP = 5.0, DRIFT_REL = 0.20;
  const TARGET_OVERRIDES = { 'Wider ETF': { VWCEd_EQ: 0.50, VUSAa_EQ: 0.25, SXRVd_EQ: 0.15, QDVEd_EQ: 0.10 } };
  const STOCK_LADDER = [[10, 'Hold — review valuation', 0.00, 0.00], [15, 'Check momentum, volume & fundamentals', 0.00, 0.00],
    [20, 'Trim 10–15%', 0.10, 0.15], [30, 'Trim another 15–20%', 0.15, 0.20], [45, 'Recover initial capital', null, null]];
  const SECTOR_ETF = { Technology: 'XLK', 'Communication Services': 'XLC', 'Consumer Cyclical': 'XLY', 'Consumer Defensive': 'XLP', 'Financial Services': 'XLF', Healthcare: 'XLV',
    Industrials: 'XLI', Energy: 'XLE', 'Basic Materials': 'XLB', Utilities: 'XLU', 'Real Estate': 'XLRE' };
  const ETF_LOOKTHROUGH = {
    'QDVE.DE': { Technology: 1.0 }, 'SXRV.DE': { Technology: 0.60, 'Communication Services': 0.15, 'Consumer Cyclical': 0.15, Other: 0.10 },
    'VUSA.AS': { Technology: 0.33, 'Financial Services': 0.13, Healthcare: 0.10, 'Consumer Cyclical': 0.10, 'Communication Services': 0.09, Other: 0.25 },
    'VWCE.DE': { Technology: 0.26, 'Financial Services': 0.17, Healthcare: 0.10, 'Consumer Cyclical': 0.11, Industrials: 0.11, Other: 0.25 },
    'SGLN.L': { 'Precious metals': 1.0 }, 'SSLN.L': { 'Precious metals': 1.0 }, 'ITWN.L': { Technology: 0.60, 'Financial Services': 0.15, Other: 0.25 },
    'IAEX.L': { Technology: 0.25, 'Financial Services': 0.20, Other: 0.55 }, 'XDAX.L': { Industrials: 0.25, 'Financial Services': 0.22, Technology: 0.12, Other: 0.41 },
    'IMIB.L': { 'Financial Services': 0.34, Utilities: 0.15, Energy: 0.10, Other: 0.41 }, 'IPOL.L': { 'Financial Services': 0.36, Energy: 0.15, Other: 0.49 },
    'CS1.L': { 'Financial Services': 0.13, Healthcare: 0.14, Other: 0.73 } };
  const NAME_KEYWORDS = [[['semiconductor', 'chip'], 'Technology'], [['cyber', 'software', 'robot', 'artificial', ' ai ', 'tech'], 'Technology'], [['defence', 'defense', 'aerospace'], 'Industrials'],
    [['gold', 'silver', 'precious'], 'Precious metals'], [['miner', 'mining', 'metal'], 'Basic Materials'], [['health', 'biotech', 'pharma'], 'Healthcare'], [['bank', 'financ'], 'Financial Services'],
    [['energy', 'oil', 'uranium', 'nuclear'], 'Energy'], [['water', 'infrastructure', 'utilit', 'clean'], 'Utilities'], [['property', 'reit', 'real estate'], 'Real Estate']];

  const PR = () => root.ZKReturns.pyRound;
  const rnd = (x, d) => PR()(x, d);
  const fmt = (x, d) => rnd(x, d).toFixed(d);                                           // Python f"{x:.{d}f}"
  const fmtC = (x, d) => { const [i, f] = rnd(Math.abs(x), d).toFixed(d).split('.'); return (x < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+$)/g, ',') + (f ? '.' + f : ''); };
  const pyFloat = x => Number.isInteger(x) ? x.toFixed(1) : String(x);                  // Python str(float)
  const truthy = v => v !== null && v !== undefined && v !== 0 && v !== '' && !Number.isNaN(v);
  const num = v => Number(v || 0);
  const sma = (xs, n) => { xs = xs.slice(-n); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const ret = (c, days) => (!c || c.length <= days) ? null : (c[c.length - 1] / c[c.length - days - 1] - 1) * 100;
  const sum = a => a.reduce((x, y) => x + y, 0);

  function trendOf(d) {
    if (!d) return null;
    const c = d.c, p = c[c.length - 1], m50 = sma(c, 50), m200 = sma(c, 200), mx = Math.max(...c);
    return { price: p, above50: p > m50, above200: p > m200, ret3m: ret(c, 63), dd: (mx - p) / mx * 100 };
  }
  function atr(d, n = 14) {
    const trs = []; for (let i = 1; i < d.c.length; i++) { const h = d.h[i], l = d.l[i], pc = d.c[i - 1]; trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
    return trs.length ? sum(trs.slice(-n)) / Math.min(n, trs.length) : null;
  }
  const marketScore = b => !b ? 10 : (b.above50 && b.above200) ? 20 : b.above200 ? 12 : b.above50 ? 8 : 0;
  const sectorScore = r => r === null ? 10 : r > 3 ? 20 : r > 0 ? 14 : r > -3 ? 8 : 0;
  const momentumScore = t => !t ? 7 : (t.above50 && t.above200) ? 15 : t.above200 ? 9 : t.above50 ? 5 : 0;
  function classifyEtf(yahoo, name) {
    if (yahoo in ETF_LOOKTHROUGH) {
      const lt = ETF_LOOKTHROUGH[yahoo]; let main = 'Broad market', best = -Infinity;
      for (const k of Object.keys(lt)) if (k !== 'Other' && lt[k] > best) { best = lt[k]; main = k; }
      return [(lt[main] || 0) >= 0.5 ? main : 'Broad market', lt];
    }
    const n = ` ${(name || '').toLowerCase()} `;
    for (const [words, sector] of NAME_KEYWORDS) if (words.some(w => n.includes(w))) return [sector, { [sector]: 1.0 }];
    return ['Broad market', { 'Broad market': 1.0 }];
  }
  function volumeRead(d) {
    const v = d.v, c = d.c, base = v.length >= 25 ? sma(v.slice(-25, -5), 20) : null, recent = sma(v, 5);
    const rv = (truthy(base) && base > 0 && truthy(recent)) ? recent / base : null, move5 = ret(c, 5) || 0;
    if (rv === null) return [null, 8, 'no volume data'];
    if (move5 > 0.5) return [rv, rv >= 1.2 ? 15 : 11, rv >= 1.2 ? 'rising on heavy volume — genuine buying' : 'rising on normal volume'];
    if (move5 < -0.5) return [rv, rv >= 1.5 ? 0 : 5, rv >= 1.5 ? 'falling on heavy volume — distribution' : 'drifting lower, light volume'];
    return [rv, 8, 'flat'];
  }
  const unitOf = ex => { const e = (ex || '').toUpperCase(); return e.includes('NASDAQ') || e.includes('NYSE') ? '$' : e === 'LSE' ? 'p' : '€'; };
  const comboRule = (m, s, vb) => m && s && !vb ? 'Strong market + strong sector → let winners run' : !m && s ? 'Weak market + strong sector → selectively hold'
    : m && !s ? 'Strong market + weak sector → review this position' : vb ? 'Weak market + weak sector + heavy selling → reduce if thesis has deteriorated' : 'Weak market + weak sector → hold only with conviction';
  const band = s => s >= 80 ? ['run', 'Let it run — add only if allocation permits'] : s >= 65 ? ['hold', 'Hold & monitor'] : s >= 50 ? ['trim', 'Consider partial profit booking / reduce exposure'] : ['reassess', 'Reassess the thesis — exit if it no longer qualifies'];

  // inp: { snap:{raw,total_value,cash}, positions, ratings:{ticker:row}, hist:{sym:{c,h,l,v}|null}, info:{sym:{}}, nowIso }
  function compute(inp) {
    const S = root.ZKSymbols, snap = inp.snap, now = inp.nowIso, ratings = inp.ratings || {};
    const H = sym => { const d = inp.hist[sym] || null; return d && d.c.length >= 30 ? d : null; };
    const trend = sym => trendOf(H(sym)), info = sym => inp.info[sym] || {};
    const piesRaw = (snap.raw || {}).pies || [], positions = inp.positions, inst = {};
    for (const p of piesRaw) {
      const pname = p.name.trim(), over = TARGET_OVERRIDES[pname] || {};
      for (const i of p.instruments || []) {
        const r = i.result || {};
        inst[i.ticker] = { pie: pname, value: num(r.priceAvgValue), invested: num(r.priceAvgInvestedValue), current: num(i.current) * 100, t212_target: num(i.expected) * 100,
          target: (i.ticker in over ? over[i.ticker] : (i.expected || 0)) * 100, override: i.ticker in over };
      }
    }
    const total = sum(Object.values(inst).map(v => v.value)) || 1.0;
    const tickMap = {}; for (const p of positions) tickMap[p.ticker] = S.t212ToYahoo(p.ticker, p.exchange)[0];
    const trends = {}; for (const t of Object.keys(tickMap)) trends[t] = trend(tickMap[t]);
    const valid = Object.values(trends).filter(Boolean);
    const breadth = valid.length ? rnd(valid.filter(t => t.above50).length / valid.length * 100, 0) : null;
    const spx = trend('^GSPC'), acwi = trend('ACWI'), vixD = H('^VIX'), vix = vixD ? vixD.c[vixD.c.length - 1] : null;
    let pts = 0; for (const t of [spx, acwi]) if (t) pts += (t.above50 ? 1 : 0) + (t.above200 ? 1 : 0);
    if (vix !== null) pts += vix < 20 ? 1 : vix > 28 ? -1 : 0;
    if (breadth !== null) pts += breadth >= 60 ? 1 : breadth < 40 ? -1 : 0;
    const mode = pts >= 4 ? 'Aggressive' : pts <= 1 ? 'Defensive' : 'Neutral';
    const reg = { mode, points: pts, spx: spx ? { above50: spx.above50, above200: spx.above200, ret3m: rnd(spx.ret3m, 1) } : null, acwi: acwi ? { above50: acwi.above50, above200: acwi.above200, ret3m: rnd(acwi.ret3m, 1) } : null,
      vix: truthy(vix) ? rnd(vix, 1) : null, breadth_pct: breadth };
    const sectorRet = {}, spy = trend('SPY'), rows = [], sectorExp = {};
    for (const p of positions) {
      const t = p.ticker, y = tickMap[t], d = H(y), tr = trends[t], rt = ratings[t] || {}, iv = inst[t] || {};
      const isStock = (rt.analyst_count || 0) > 0, kind = isStock ? 'stock' : 'etf', value = iv.value || 0.0, weight = value / total * 100;
      const gain = num(p.gain_pct), qty = num(p.quantity), cur = num(p.current_price), avg = num(p.avg_price), u = unitOf(p.exchange), notes = [];
      let sector, lt, rel, bench, upside;
      if (isStock) {
        const inf = info(y); sector = inf.sector || 'Other'; lt = { [sector]: 1.0 };
        const proxy = SECTOR_ETF[sector];
        if (proxy && !(proxy in sectorRet)) { const st = trend(proxy); sectorRet[proxy] = st ? st.ret3m : null; }
        rel = proxy && sectorRet[proxy] !== null && sectorRet[proxy] !== undefined && spy ? sectorRet[proxy] - spy.ret3m : null;
        bench = spx; upside = truthy(inf.currentPrice) && truthy(inf.targetMeanPrice) ? ((inf.targetMeanPrice || 0) / inf.currentPrice - 1) * 100 : null;
      } else {
        const inf = !(y in ETF_LOOKTHROUGH) ? info(y) : {};
        [sector, lt] = classifyEtf(y, inf.longName || inf.shortName);
        rel = tr && acwi && tr.ret3m !== null ? tr.ret3m - acwi.ret3m : null;
        bench = ['VUSA.AS', 'QDVE.DE', 'SXRV.DE'].includes(y) ? spx : acwi; upside = null;
      }
      for (const [s, w] of Object.entries(lt)) if (s !== 'Other' && s !== 'Broad market') sectorExp[s] = (sectorExp[s] || 0) + value * w;
      const sMkt = marketScore(bench), sSec = sectorScore(rel), sMom = momentumScore(tr);
      const [rv, sVol, volNote] = d ? volumeRead(d) : [null, 8, 'no data'];
      const star = rt.star_rating || 3; let sFun, sCon;
      if (isStock) { sFun = Math.min(20, star * 3 + ((upside || 0) > 15 ? 5 : (upside || 0) > 5 ? 3 : (upside || 0) > 0 ? 1 : 0)); sCon = weight <= 5 ? 10 : weight <= MAX_STOCK_PCT ? 6 : 0; }
      else { sFun = star * 4; sCon = weight <= 15 ? 10 : weight <= 25 ? 5 : 0; }
      const score = rnd(sMkt + sSec + sMom + sVol + sFun + sCon, 0); let [level, action] = band(score);
      const breakdown = { market: sMkt, sector: sSec, momentum: sMom, volume: sVol, fundamentals: sFun, concentration: sCon };
      const signals = { rule: comboRule(sMkt === 20, sSec >= 14, sVol === 0), volume: volNote, sector_rel_3m: rel !== null ? rnd(rel, 1) : null, upside_pct: upside !== null ? rnd(upside, 1) : null,
        drawdown_pct: tr ? rnd(tr.dd, 1) : null, above50: tr ? tr.above50 : null, above200: tr ? tr.above200 : null };
      const trimPlan = []; let trail = null, dist = null, maxPos = null, breached = false;
      if (isStock) {
        for (const [lvl, label, hi, lo] of STOCK_LADDER) {
          let pct = score >= 80 ? hi : lo; if (pct === null) pct = 1 / (1 + lvl / 100);
          trimPlan.push({ gain: lvl, label, price: rnd(avg * (1 + lvl / 100), 2), unit: u, hit: gain >= lvl, sell_pct: rnd(pct * 100, 0), sell_qty: rnd(qty * pct, 4), sell_gbp: rnd(value * pct, 2) });
        }
        if (d) {
          const a = atr(d), hi = Math.max(...d.c.slice(-63));
          if (truthy(a)) {
            const py = d.c[d.c.length - 1], stopY = hi - ATR_MULT * a; dist = (py - stopY) / py; trail = rnd(cur * stopY / py, 2); breached = py < stopY;
            const sizeDist = ATR_MULT * a / py; maxPos = rnd(total * RISK_PER_TRADE_PCT / 100 / sizeDist, 2);
          }
        }
        if (breached) { notes.push(`Trailing exit breached — price is ${fmt(Math.abs(dist) * 100, 0)}% below the 3×ATR exit from the 3-month high; trend has broken, decide hold vs exit on the thesis`); signals.trail_breached = true; }
        if (truthy(maxPos) && value > maxPos) notes.push(`Oversized for 1% risk: £${fmtC(value, 0)} vs £${fmtC(maxPos, 0)} max`);
        const hit = trimPlan.filter(x => x.hit && x.sell_pct);
        if (hit.length && level !== 'reassess') {
          const h = hit[hit.length - 1];
          action = `${h.label} — sell ~${pyFloat(h.sell_qty)} sh (≈£${fmt(h.sell_gbp, 0)})` + (score >= 80 ? ' · score strong, smaller trim' : ''); level = 'trim';
        } else if (level === 'trim' && gain <= 0) action = "Score 50–64 while in a loss — don't add; reduce only if the thesis has weakened";
        else if (gain >= 15 && (level === 'run' || level === 'hold')) notes.push('+15% reached — check momentum, volume and fundamentals before the +20% trim');
        if (weight > MAX_STOCK_PCT) notes.push(`Above ${fmt(MAX_STOCK_PCT, 0)}% single-stock limit (${fmt(weight, 1)}%)`);
      } else {
        if (gain >= 20) notes.push('Gain 20–30%+: trim only if overweight'); else if (gain >= 10) notes.push('Gain 10–20%: review allocation & underlying index'); else if (gain >= 5) notes.push('Gain 5–10%: hold — no automatic selling');
        const tgt = iv.target, curw = iv.current;
        if (truthy(tgt)) {
          const overPp = curw - tgt, overRel = tgt ? curw / tgt - 1 : 0;
          if (overPp >= DRIFT_PP || overRel >= DRIFT_REL) {
            level = level !== 'reassess' ? 'rebalance' : level;
            action = `Overweight ${fmt(curw, 0)}% vs ${fmt(tgt, 0)}% target — stop adding, route new money to underweight holdings; sell down only at quarterly review`;
          } else if (tgt - curw >= DRIFT_PP || (truthy(curw) && tgt / Math.max(curw, 0.01) - 1 >= DRIFT_REL)) notes.push(`Underweight ${fmt(curw, 0)}% vs ${fmt(tgt, 0)}% target — direct new contributions here`);
          if (iv.override) notes.push(`Target from agreed plan (${fmt(tgt, 0)}%); T212 pie set to ${fmt(iv.t212_target, 0)}%`);
        }
        const dd = tr ? tr.dd : 0;
        if (dd >= 20) notes.push(`${fmt(dd, 0)}% below 52w high — reassess risk & thesis`); else if (dd >= 10) notes.push(`${fmt(dd, 0)}% below 52w high — review, don't panic sell`);
        if (weight > 25) notes.push(`${fmt(weight, 0)}% of all holdings in one ETF — concentration risk`);
      }
      rows.push({ ticker: t, display: p.display, yahoo_ticker: y, pie: (p.pie || '').trim(), kind, sector, value_gbp: rnd(value, 2), weight_pct: rnd(weight, 2), gain_pct: gain, score, breakdown, action, action_level: level,
        trim_plan: trimPlan, trailing_stop: trail, stop_distance_pct: truthy(dist) ? rnd(dist * 100, 1) : null, max_position_gbp: maxPos, rel_volume: truthy(rv) ? rnd(rv, 2) : null, signals, notes, updated_at: now });
    }
    const sectors = Object.entries(sectorExp).map(([s, v]) => ({ sector: s, gbp: rnd(v, 2), pct: rnd(v / total * 100, 1), over: v / total * 100 > MAX_SECTOR_PCT })).sort((a, b) => b.pct - a.pct);
    const pies = piesRaw.map(p => {
      const pname = p.name.trim(), items = Object.values(inst).filter(v => v.pie === pname), val = sum(items.map(i => i.value)), invd = sum(items.map(i => i.invested)), pr = rows.filter(r => r.pie === pname);
      return { pie: pname, gbp: rnd(val, 2), pct: rnd(val / total * 100, 1), gain_pct: invd ? rnd((val / invd - 1) * 100, 1) : null, avg_score: pr.length ? rnd(sum(pr.map(r => r.score)) / pr.length, 0) : null,
        flags: pr.filter(r => ['trim', 'rebalance', 'reassess'].includes(r.action_level)).map(r => r.display) };
    }).sort((a, b) => b.gbp - a.gbp);
    let trims = 0; for (const r of rows) if (r.kind === 'stock' && r.action_level === 'trim') { const x = [...r.trim_plan].reverse().find(z => z.hit && z.sell_pct); trims += x ? x.sell_gbp : 0; }
    const notes = [], tech = sectors.find(s => s.sector === 'Technology');
    if (tech && tech.over) notes.push(`Technology look-through is ${tech.pct}% of holdings (limit ${fmt(MAX_SECTOR_PCT, 0)}%) — QDVE, SXRV, VUSA, VWCE and Mag 7 overlap; grow VWCE towards 50% of Wider ETF with new money`);
    for (const s of sectors) if (s.over && s.sector !== 'Technology') notes.push(`${s.sector} is ${s.pct}% of holdings — above the ${fmt(MAX_SECTOR_PCT, 0)}% sector cap`);
    let top = null; for (const r of rows) if (!top || r.weight_pct > top.weight_pct) top = r;
    if (top && top.weight_pct > 20) notes.push(`Largest single holding: ${top.display} at ${top.weight_pct}% of holdings`);
    notes.push({ Aggressive: 'Market regime Aggressive — let winners run, trim only at ladder levels.', Neutral: 'Market regime Neutral — follow the ladder, tighten review on weak sectors.',
      Defensive: 'Market regime Defensive — book ladder profits fully, protect gains, avoid new stock risk.' }[reg.mode]);
    const counts = {}; for (const l of ['run', 'hold', 'trim', 'rebalance', 'reassess']) counts[l] = rows.filter(r => r.action_level === l).length;
    const summary = { regime: reg, sectors, pies, limits: { risk_per_trade_pct: RISK_PER_TRADE_PCT, risk_per_trade_gbp: rnd(total * RISK_PER_TRADE_PCT / 100, 2), max_stock_pct: MAX_STOCK_PCT, max_sector_pct: MAX_SECTOR_PCT, atr_mult: ATR_MULT, drift_pp: DRIFT_PP, drift_rel_pct: DRIFT_REL * 100 },
      totals: { holdings_gbp: rnd(total, 2), invested_gbp: rnd(sum(Object.values(inst).map(v => v.invested)), 2), account_total: snap.total_value, cash: snap.cash, suggested_trims_gbp: rnd(trims, 2), counts }, notes, updated_at: now };
    return { rows, summary };
  }

  // opts: { store, market }
  async function run(opts, nowDate) {
    const { store, market } = opts, S = root.ZKSymbols, d = nowDate || new Date();
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = (await store.load('positions')).filter(p => p.snapshot_id === snap.id);
    const ratings = {}; for (const r of opts.ratings || []) ratings[r.ticker] = r;
    const syms = new Set(['^GSPC', 'ACWI', '^VIX', 'SPY', ...Object.values(SECTOR_ETF)]);
    for (const p of positions) syms.add(S.t212ToYahoo(p.ticker, p.exchange)[0]);
    const hist = {}, infos = {};
    await Promise.all([...syms].map(async s => { const c = await market.chart(s, '1y'); hist[s] = c ? { c: c.close, h: c.high.map((x, i) => x == null ? c.close[i] : x), l: c.low.map((x, i) => x == null ? c.close[i] : x), v: c.volume.map(x => x || 0) } : null; }));
    await Promise.all(positions.map(async p => { const y = S.t212ToYahoo(p.ticker, p.exchange)[0]; const st = (ratings[p.ticker] || {}).analyst_count > 0; if (st || !(y in ETF_LOOKTHROUGH)) infos[y] = await market.info(y); }));
    const out = compute({ snap, positions, ratings, hist, info: infos, nowIso: d.toISOString() });
    await store.put('profit_booking', out.rows, r => r.ticker);
    const keep = new Set(out.rows.map(r => r.ticker)); for (const e of await store.load('profit_booking')) if (!keep.has(e.ticker)) await store.remove('profit_booking', e.ticker);
    await store.put('profit_booking_summary', [out.summary], () => 'main');
    return out;
  }
  root.ZKProfitBooking = { compute, run, classifyEtf };
  if (typeof module !== 'undefined') module.exports = root.ZKProfitBooking;
})(typeof window !== 'undefined' ? window : globalThis);
