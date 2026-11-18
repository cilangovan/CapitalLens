// Port of services/alert_service.py: daily per-pie review report (weights, verified-price thresholds, review flag, data coverage).
(function (root) {
  'use strict';
  const F = root.ZKAlertFmt || (typeof require !== 'undefined' ? require('./alertfmt.js') : null);
  const WEIGHT_BAND_PP = 5.0, DIP = -8.0, DEEP = -12.0, SHARP = -3.0, PROFIT = 40.0, SESSIONS = 20, TOL = 0.06, STALE_H = 24;
  const rnd = (x, d) => root.ZKReturns.pyRound(x, d);
  const f0 = x => rnd(x, 0).toFixed(0);
  const dateOf = iso => new Date(iso + 'T00:00:00Z');
  const num = v => Number(v || 0);

  function lastWeekdaySession(todayIso) {
    const d = dateOf(todayIso); d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  // chart: market.chart(sym,'3mo') result (unadjusted closes) or null -> [data, reason]
  function verifyPrices(sym, chart, t212Price, todayIso) {
    if (!chart || !chart.close || !chart.close.length) return [null, 'no daily price history'];
    const closes = []; chart.close.forEach((c, i) => { if (c !== null && c !== undefined && !Number.isNaN(c)) closes.push([chart.dates[i], Number(c)]); });
    if (!closes.length) return [null, 'no daily price history'];
    if (closes.length < SESSIONS) return [null, `only ${closes.length} sessions of history (need ${SESSIONS})`];
    const lastDate = closes[closes.length - 1][0];
    if (lastDate < lastWeekdaySession(todayIso)) return [null, `latest close is stale (${F.dayMonth(dateOf(lastDate))})`];
    const ccy = (chart.currency || '').trim();
    if (!ccy) return [null, 'listing currency unknown'];
    const [scale, ccyOut] = (ccy === 'GBp' || ccy === 'GBX') ? [0.01, 'GBP'] : [1.0, ccy.toUpperCase()];
    const window = closes.slice(-SESSIONS).map(x => x[1]), jumps = [];
    for (let i = 0; i < window.length - 1; i++) if (window[i] > 0) jumps.push(window[i + 1] / window[i]);
    if (Math.min(...window) <= 0 || jumps.some(j => j > 8 || j < 1 / 8)) return [null, 'inconsistent price units in history'];
    const nativeLast = closes[closes.length - 1][1];
    if (t212Price && t212Price > 0 && !([t212Price, t212Price / 100, t212Price * 100].some(c => Math.abs(nativeLast / c - 1) <= TOL))) return [null, "price does not match Trading 212's live quote"];
    const last = nativeLast * scale, prev = closes[closes.length - 2][1] * scale, high = Math.max(...window) * scale;
    return [{ symbol: sym, ccy: ccyOut, last, last_date: lastDate, daily: (last / prev - 1) * 100, high20: high, drawdown: (last / high - 1) * 100 }, null];
  }

  function reviewFlag(name, weightState, price, gain, analyst) {
    const dip = price && price.drawdown <= DIP, deep = price && price.drawdown <= DEEP, sharp = price && price.daily <= SHARP, falling = dip || sharp;
    let star = (analyst || {}).star_rating || 0; if ((analyst || {}).source === 'trend') star = 0;
    if (weightState === 'overweight') {
      let msg = `Keep regular ${name} additions paused while it remains overweight.`;
      msg += falling ? ' A large fall does not automatically make it a good entry.' : ' Let new contributions to the other holdings bring it back to target.';
      return msg;
    }
    if (weightState === 'underweight') {
      if (deep) return `${name} is underweight and well below its 20-day high. New contributions can go here first, but check why it fell before adding a lump sum.`;
      return `${name} is underweight. Direct new contributions here first until it is back near target.`;
    }
    if (falling) {
      const base = `${name} is on target weight but has fallen.`;
      if (star >= 4) return base + ` Analysts still rate it ⭐${star}. Review the news before adding; a fall alone is not a buy signal.`;
      return base + ' Review the news and analyst view before adding; a fall alone is not a buy signal.';
    }
    if (gain !== null && gain >= PROFIT) return `Up ${F.pct(gain, 1)} on your average cost. Consider booking part of the profit (see the Profit Booking tab).`;
    return null;
  }

  // ctx: { getChart(sym,range)->chart|null, yahooSymbol(ticker,exchange), fx(ccy)->rate|null (async), nowMs }
  async function buildPieReport(pie, posBy, meta, analystMap, snapTime, todayIso, ctx) {
    const coverage = [], fxCache = {};
    const moneyGbp = async (v, ccy) => { const s = F.money(v, ccy); if (ccy === 'GBP') return s; if (!(ccy in fxCache)) fxCache[ccy] = await ctx.fx(ccy); const r = fxCache[ccy]; return r ? `${s} (≈ ${F.money(v / r, 'GBP')})` : s; };
    const insts = (pie.instruments || []).slice().sort((a, b) => -(Math.abs(num(a.current) - num(a.expected))) - -(Math.abs(num(b.current) - num(b.expected))));
    const snapAgeH = (ctx.nowMs - snapTime.getTime()) / 3600000;
    let weightSrc = `Source: Trading 212 API pie data, ${F.dayMonth(snapTime)} ${F.hhmm(snapTime)} UTC.`;
    if (snapAgeH > STALE_H) weightSrc += ` The holding weight is not live-verified (snapshot ${f0(snapAgeH)}h old).`;
    const flagged = [], clear = [], flags = [];
    for (const inst of insts) {
      const ticker = inst.ticker || '', pos = posBy[ticker] || {}, mname = (meta[ticker] || {}).name;
      const label = F.friendly(ticker, mname), name = F.shortName(ticker, mname);
      const curW = num(inst.current) * 100, tgtW = num(inst.expected) * 100, diff = curW - tgtW;
      const weightState = diff >= WEIGHT_BAND_PP ? 'overweight' : diff <= -WEIGHT_BAND_PP ? 'underweight' : null;
      const t212 = num(pos.current_price), avg = num(pos.avg_price), gain = (t212 && avg) ? (t212 / avg - 1) * 100 : null;
      const sym = ctx.yahooSymbol(ticker, pos.exchange === undefined ? '' : pos.exchange);
      const [price, reason] = verifyPrices(sym, await ctx.getChart(sym, '3mo'), t212, todayIso);
      if (reason) coverage.push([name, reason]);
      const crossed = [];
      if (price) { if (price.drawdown <= DEEP) crossed.push('deep dip'); else if (price.drawdown <= DIP) crossed.push('dip'); if (price.daily <= SHARP) crossed.push('sharp daily fall'); }
      if (gain !== null && gain >= PROFIT) crossed.push('profit target');
      const status = []; if (weightState) status.push(weightState); status.push(...crossed);
      if (!status.length && !price) continue;
      const s = new F.Section(`${label} — ${status.length ? status.join(', ') : 'no threshold crossed'}`);
      if (weightState) {
        s.table('Measure', 'Weight', [[`Last reported ${name} holding (${F.dayMonth(snapTime)})`, `${F.fx(curW, 2)}%`], ['Strategic target', `${F.fx(tgtW, 2)}%`], ['Difference', F.pp(diff)]]);
        s.line(weightSrc);
      }
      if (price) {
        const rows = [[`Latest ${price.ccy} price`, await moneyGbp(price.last, price.ccy)], ['Daily change', F.pct(price.daily)], ['20-day closing high', await moneyGbp(price.high20, price.ccy)], ['Drawdown', F.pct(price.drawdown)]];
        if (!weightState) rows.push(['Weight vs target', `${F.fx(curW, 2)}% vs ${F.fx(tgtW, 2)}% (${F.signed(diff)} pp)`]);
        if (gain !== null) rows.push(['Gain vs your average cost', F.pct(gain)]);
        const a = analystMap[ticker] || {};
        if (a.star_rating && a.source === 'trend') rows.push(['Trend rating', `⭐${a.star_rating} (no analyst coverage)`]);
        else if (a.star_rating) rows.push(['Analyst view', `⭐${a.star_rating} · ${f0(num(a.buy_pct))}% buy`]);
        s.table('Measure', 'Result', rows);
        s.line(`Source: Yahoo Finance daily closes (${price.symbol}), ${F.fullDate(dateOf(price.last_date))}; cross-checked against the Trading 212 live price.`);
      }
      const flag = reviewFlag(name, weightState, price, gain, analystMap[ticker]);
      if (flag) s.line(`Review flag: ${flag}`);
      (status.length ? flagged : clear).push(s);
      for (const x of status) flags.push(`${F.baseSymbol(ticker)}:${x}`);
    }
    const sections = flagged.concat(clear);
    if (coverage.length) {
      const names = coverage.map(c => c[0]), joined = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      const s = new F.Section('Data coverage');
      s.line(`Could not reliably verify today's price and full ${SESSIONS}-session history for ${joined}. They are not marked clear and no price alerts were generated for them without evidence.`);
      for (const [n, r] of coverage) s.line(`• ${n}: ${r}`);
      sections.push(s);
    }
    return { sections, flags, coverage };
  }
  function titleFor(pieName, flags, coverage, count) {
    if (flags.length) { const uniq = [...new Set(flags.map(f => f.split(':').slice(1).join(':')))].sort(); return `⚠️ ${pieName} — ${flags.length} flag${flags.length !== 1 ? 's' : ''} (${uniq.join(', ')})`; }
    if (coverage.length && coverage.length >= count) return `❔ ${pieName} — data unverified`;
    return `✅ ${pieName} — no threshold crossed`;
  }
  async function sha1Hex10(text) {
    const d = await root.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
  }

  // inp: { snap:{created_at,raw}, positions, ratings:[analyst rows], todays:[alert rows], nowMs, getChart, yahooSymbol, fx }
  // returns { actions:[{op:'post'|'patch'|'delete'|'skip', ...}], pushes:[{title,body,priority,tags}] }
  async function compute(inp) {
    const snapTime = new Date(inp.snap.created_at), raw = inp.snap.raw || {}, pies = raw.pies || [], meta = raw.instrument_meta || {};
    const posBy = {}; for (const p of inp.positions) posBy[p.ticker] = p;
    const analystMap = {}; for (const r of inp.ratings || []) analystMap[r.ticker] = r;
    const todayIso = new Date(inp.nowMs).toISOString().slice(0, 10), todays = inp.todays || [], actions = [], pushes = [];
    const ctx = { getChart: inp.getChart, yahooSymbol: inp.yahooSymbol, fx: inp.fx, nowMs: inp.nowMs };
    for (const pie of pies) {
      if (num(pie.value) <= 0) continue;
      const name = pie.name, { sections, flags, coverage } = await buildPieReport(pie, posBy, meta, analystMap, snapTime, todayIso, ctx);
      if (!sections.length) continue;
      const sig = await sha1Hex10(flags.slice().sort().join('|')), key = `report:${name}:${todayIso}:${sig}`, title = titleFor(name, flags, coverage, (pie.instruments || []).length);
      const alreadyPushed = todays.some(r => r.dedup_key === key), same = todays.filter(r => r.dedup_key === key), body = F.renderText(sections);
      if (same.some(r => r.archived_at || r.dismissed_at)) actions.push({ op: 'skip', pie: name, title });
      else if (same.length) actions.push({ op: 'patch', pie: name, id: same[0].id, title, body });
      else {
        for (const r of todays) if (r.pie === name && !(r.archived_at || r.dismissed_at)) actions.push({ op: 'delete', pie: name, id: r.id });
        actions.push({ op: 'post', pie: name, title, body, dedup_key: key });
      }
      if (flags.length && !alreadyPushed) { const high = flags.some(f => f.includes('dip') || f.includes('fall')); pushes.push({ title, body: F.renderPush(sections), priority: high ? 'high' : 'default', tags: high ? 'warning' : 'scales' }); }
    }
    return { actions, pushes };
  }

  // opts: { store, market, ratings, notify(push) }
  async function run(opts, nowDate) {
    const { store, market } = opts, S = root.ZKSymbols, d = nowDate || new Date(), nowMs = d.getTime();
    const snap = (await store.load('portfolio_snapshots')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!snap) return { error: 'no snapshot' };
    const positions = (await store.load('positions')).filter(p => p.snapshot_id === snap.id), dayStart = d.toISOString().slice(0, 10);
    const todays = (await store.load('alerts')).filter(a => a.alert_type === 'report' && String(a.created_at) >= dayStart);
    const out = await compute({ snap, positions, ratings: opts.ratings || [], todays, nowMs,
      getChart: async (sym, range) => market.chart(sym, range), yahooSymbol: (t, ex) => S.t212ToYahoo(t, ex)[0],
      fx: async ccy => { const c = await market.chart(`GBP${ccy}=X`, '5d'); const v = c ? c.close.filter(x => x !== null && x !== undefined && !Number.isNaN(x)) : []; return v.length ? v[v.length - 1] : null; } });
    for (const a of out.actions) {
      if (a.op === 'delete') await store.remove('alerts', a.id);
      else if (a.op === 'patch') { const row = todays.find(r => r.id === a.id); await store.put('alerts', [Object.assign({}, row, { title: a.title, body: a.body })], r => r.id); }
      else if (a.op === 'post') await store.put('alerts', [{ id: a.dedup_key, alert_type: 'report', type: 'report', pie: a.pie, ticker: null, title: a.title, body: a.body, dedup_key: a.dedup_key, created_at: d.toISOString() }], r => r.id);
    }
    if (opts.notify) for (const p of out.pushes) await opts.notify(p);
    return out;
  }
  root.ZKAlertReport = { compute, run, verifyPrices, reviewFlag, titleFor, lastWeekdaySession };
  if (typeof module !== 'undefined') module.exports = root.ZKAlertReport;
})(typeof window !== 'undefined' ? window : globalThis);
