// Port of services/holding_decision_service.py: weekly per-holding decision score (6 factors), 5-level selling framework, buy rules.
(function (root) {
  'use strict';
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d);
  const EXCHANGE_SUFFIX = { LSE: '.L', XETRA: '.DE', AMS: '.AS', EURONEXT: '.PA', 'NASDAQ/NYSE': '', NYSE: '', NASDAQ: '' };
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  function calcRsi(closes, period = 14) {
    if (closes.length < period + 1) return 50.0;
    const deltas = closes.slice(1).map((c, i) => c - closes[i]), gains = deltas.map(d => d > 0 ? d : 0.0), losses = deltas.map(d => d < 0 ? -d : 0.0);
    let ag = mean(gains.slice(0, period)), al = mean(losses.slice(0, period));
    for (let i = period; i < deltas.length; i++) { ag = (ag * (period - 1) + gains[i]) / period; al = (al * (period - 1) + losses[i]) / period; }
    if (al === 0) return 100.0;
    return rnd(100 - 100 / (1 + ag / al), 1);
  }
  // h: { c:[], h:[], v:[] } (6 months of daily, split/dividend adjusted)
  function techMetrics(h) {
    if (!h || h.c.length < 10) return null;
    const c = h.c, v = h.v, current = c[c.length - 1], high52 = Math.max(...h.h);
    const ma20 = c.length >= 20 ? mean(c.slice(-20)) : c[c.length - 1], ma50 = c.length >= 50 ? mean(c.slice(-50)) : c[c.length - 1];
    const volR = v.length >= 20 ? mean(v.slice(-5)) / mean(v.slice(-20, -5)) : 1.0;
    return { current: rnd(current, 4), ma20: rnd(ma20, 4), ma50: rnd(ma50, 4), rsi: calcRsi(c), vol_ratio: rnd(volR, 2),
      mom_4w: c.length >= 20 ? rnd((c[c.length - 1] / c[c.length - 20] - 1) * 100, 1) : 0.0, mom_1w: c.length >= 5 ? rnd((c[c.length - 1] / c[c.length - 5] - 1) * 100, 1) : 0.0,
      pct_from_high: rnd((current - high52) / high52 * 100, 1) };
  }
  const exchangeToRegion = ex => { ex = (ex || '').toUpperCase(); return ['NASDAQ/NYSE', 'NYSE', 'NASDAQ'].includes(ex) ? 'USA' : ex === 'LSE' ? 'UK' : ['XETRA', 'AMS', 'EURONEXT'].includes(ex) ? 'Europe' : null; };
  function yfSymbol(display, exchange) {
    const suffix = EXCHANGE_SUFFIX[(exchange || '').toUpperCase()] || '';
    let sym = display;
    if (suffix === '.L') { if (sym.endsWith('l') && !sym.endsWith('.L')) sym = sym.slice(0, -1); if (!sym.endsWith('.L')) sym += '.L'; }
    else if (suffix === '.DE') { if (sym.endsWith('d') && sym.length > 2) sym = sym.slice(0, -1); sym += '.DE'; }
    else if (suffix === '.AS') { if (sym.endsWith('a') && sym.length > 2) sym = sym.slice(0, -1); sym += '.AS'; }
    return sym;
  }
  const clamp = (lo, hi, s) => Math.max(lo, Math.min(hi, s));
  function scoreInstitutional(d) { let s = 10; if (d.vol_ratio > 1.3) s += 4; else if (d.vol_ratio > 1.1) s += 2; else if (d.vol_ratio < 0.8) s -= 3;
    if (d.mom_4w > 5) s += 4; else if (d.mom_4w > 2) s += 2; else if (d.mom_4w < -5) s -= 4; else if (d.mom_4w < -2) s -= 2; return clamp(0, 20, s); }
  function scorePriceTrend(d) { let s = 10; if (d.current > d.ma20 && d.ma20 > d.ma50) s += 6; else if (d.current > d.ma50) s += 3; else if (d.current < d.ma50) s -= 4;
    if (d.mom_1w > 1.5) s += 4; else if (d.mom_1w > 0) s += 2; else if (d.mom_1w < -3) s -= 4; else if (d.mom_1w < 0) s -= 1; return clamp(0, 20, s); }
  function scoreFinancialHealth(d) { let s = 13; const r = d.rsi; if (r >= 50 && r <= 70) s += 7; else if (r >= 40 && r < 50) s += 3; else if (r > 75) s -= 3; else if (r < 35) s -= 5;
    if (d.mom_4w > 0 && d.mom_1w > 0) s += 5; else if (d.mom_4w < 0 && d.mom_1w < 0) s -= 5; return clamp(0, 25, s); }
  function scoreValuation(d) { const p = d.pct_from_high; let s = 7; if (p < -25) s += 7; else if (p < -15) s += 5; else if (p < -8) s += 3; else if (p < -3) s += 1; else if (p > -1) s -= 3; return clamp(0, 15, s); }
  const scoreSector = rs => clamp(0, 10, rnd(rs / 10, 0));
  function scoreRisk(d) { let s = 5; const p = d.pct_from_high; if (p > -5) s -= 3; else if (p < -20) s += 3; if (d.rsi > 70) s -= 2; else if (d.rsi < 40) s += 2; return clamp(0, 10, s); }
  function sellLevel(d, inst) {
    const p = d.pct_from_high, below = d.current < d.ma50, weak = inst < 10;
    if (p > -5) return [0, null];
    if (p > -8) return [1, 'Warning — down 5-8% from recent high; investigate'];
    if (p > -12) { const l = !(below && weak) ? 2 : 3; return [l, l === 2 ? 'Weakness — down 10-12%, trend deteriorating; stop adding' : 'Distribution — institutional selling + price breakdown']; }
    if (p > -20) { if (weak && below) return [3, 'Distribution — persistent selling; consider reducing 20-25%']; return [2, 'Weakness — extended drawdown; monitor closely']; }
    if (weak && below && d.rsi < 40) return [4, 'Thesis deterioration risk — consider reducing 25-50%; reassess'];
    return [3, 'Distribution — significant drawdown; review investment thesis'];
  }
  function buySignal(d, inst) {
    const above = d.current >= d.ma50, acc = inst >= 14;
    if (acc && above) return 'BUY signal — institutional accumulation + price above MA50; consider gradual entry';
    if (acc && !above) return 'WAIT — institutional buying but price below MA50; wait for price confirmation';
    if (!acc && above) return 'HOLD — no institutional accumulation; hold existing position';
    return 'AVOID — institutional selling + price below MA50; no new buying';
  }
  const decisionLabel = s => s >= 80 ? 'Strong Hold / Consider Buy' : s >= 65 ? 'Hold' : s >= 50 ? 'Watch / No Additional Buying' : s >= 35 ? 'Consider Reducing' : 'Consider Exit';
  function regionScores(markets) {
    let m = markets; if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return {}; } }
    const out = {}; if (Array.isArray(m)) for (const x of m) out[x.region] = x.score; return out;
  }

  // inp: { today, positions:[{ticker,display,pie,exchange}], metrics:{ticker: techMetrics|null}, regionScores }
  function compute(inp) {
    const seen = new Set(), positions = inp.positions.filter(p => { if (seen.has(p.ticker)) return false; seen.add(p.ticker); return true; }), rows = [];
    for (const pos of positions) {
      const ticker = pos.ticker, exchange = pos.exchange === undefined ? '' : pos.exchange, d = inp.metrics[ticker];
      if (!d) continue;
      const region = exchangeToRegion(exchange), regScore = region && region in inp.regionScores ? inp.regionScores[region] : 50;
      const sI = scoreInstitutional(d), sP = scorePriceTrend(d), sF = scoreFinancialHealth(d), sV = scoreValuation(d), sS = scoreSector(regScore), sR = scoreRisk(d), total = sI + sP + sF + sV + sS + sR;
      const [sl, ss] = sellLevel(d, sI), bs = buySignal(d, sI), decision = decisionLabel(total), parts = [];
      if (sl >= 3) parts.push(ss); if (total >= 65 && sl === 0) parts.push('No selling signals');
      rows.push({ report_date: inp.today, ticker, display: pos.display === undefined ? ticker : pos.display, pie: (pos.pie || '').trim() || null, exchange, score: total, decision, sell_level: sl, sell_signal: ss, buy_signal: bs,
        inst_score: sI, price_score: sP, fin_score: sF, val_score: sV, sector_score: sS, risk_score: sR, rsi: d.rsi, mom_4w: d.mom_4w, mom_1w: d.mom_1w, pct_from_high: d.pct_from_high, above_ma50: d.current >= d.ma50, vol_ratio: d.vol_ratio, notes: parts.length ? parts.join('; ') : null });
    }
    return { rows };
  }

  // opts: { store, market, flowReport: institutional_flow_reports row (shared, public) }
  async function run(opts, nowDate) {
    const { store, market } = opts, d = nowDate || new Date(), today = d.toISOString().slice(0, 10);
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = (await store.load('positions')).filter(p => p.snapshot_id === snap.id).sort((a, b) => String(a.pie).localeCompare(String(b.pie)) || String(a.ticker).localeCompare(String(b.ticker)));
    const metrics = {};
    await Promise.all(positions.map(async p => {
      const c = await market.chart(yfSymbol(p.display || p.ticker, p.exchange || ''), '6mo');
      if (c) { const r = c.close.map((x, i) => c.adjclose[i] / x); metrics[p.ticker] = techMetrics({ c: c.adjclose, h: c.high.map((x, i) => (x == null ? c.close[i] : x) * r[i]), v: c.volume.map(x => x || 0) }); }
    }));
    const out = compute({ today, positions, metrics, regionScores: regionScores(opts.flowReport && opts.flowReport.markets) });
    await store.put('holding_decisions', out.rows, r => r.report_date + '|' + r.ticker);
    return out;
  }
  root.ZKHoldingDecision = { compute, run, techMetrics, calcRsi, yfSymbol, regionScores };
  if (typeof module !== 'undefined') module.exports = root.ZKHoldingDecision;
})(typeof window !== 'undefined' ? window : globalThis);
