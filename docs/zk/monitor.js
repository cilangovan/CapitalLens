// Portfolio monitor, run in the browser. Port of monitor.py (fetch + analyse + save), minus e-mail/push delivery.
// Reads account, positions, pies and instrument names from Trading 212 through the stateless relay, tracks highs,
// raises dip / deep-dip / trim alerts, and saves the snapshot, positions and alerts ENCRYPTED.
(function (root) {
  'use strict';
  const A = () => root.ZKAlertFmt;
  const DIP_FROM_HIGH_PCT = 8.0, BUY_SIGNAL_PCT = 12.0, TRIM_GAIN_PCT = 40.0, REBALANCE_DRIFT_PCT = 5.0;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const rnd = (x, d) => { const m = Math.pow(10, d); return Math.round((x + Number.EPSILON * Math.sign(x)) * m) / m; };

  function resolvePie(ticker, pieMap) {
    if (pieMap[ticker]) return pieMap[ticker];
    const base = ticker.split('_')[0];
    for (const [k, v] of Object.entries(pieMap)) if (k.startsWith(base) || k.split('_')[0] === base) return v;
    return 'Solo holdings';
  }
  function resolveExchange(ticker) {
    const t = ticker.toUpperCase();
    if (t.includes('_US_EQ')) return 'NASDAQ/NYSE';
    if (t.endsWith('L_EQ')) return 'LSE';
    if (t.endsWith('D_EQ')) return 'XETRA';
    if (t.endsWith('A_EQ')) return 'AMS';
    return 'LSE';
  }
  const unitPrice = (price, ccy) => ccy === 'GBX' || ccy === 'GBp' ? [price / 100, 'GBP'] : [price, ccy || 'GBP'];

  function priceSection(title, ticker, meta, cur, avg, high, gainPct, dip, pieName, exchange, note, nowDate) {
    const F = A(), m = meta[ticker] || {}, ccy = m.ccy, s = new F.Section(title);
    let rows;
    if (ccy) {
      const [c, u] = unitPrice(cur, ccy), [h] = unitPrice(high, ccy), [a] = unitPrice(avg, ccy);
      rows = [[`Live ${u} price`, F.money(c, u)], ['Tracked high', F.money(h, u)], ['Drawdown from tracked high', F.pct(-dip)],
        ['Your average cost', F.money(a, u)], ['Gain vs your average cost', F.pct(gainPct)]];
    } else rows = [['Drawdown from tracked high', F.pct(-dip)], ['Gain vs your average cost', F.pct(gainPct)]];
    s.table('Measure', 'Result', [...rows, ['Pie', pieName], ['Exchange', exchange]]);
    let src = `Source: Trading 212 live quote, ${F.dayMonth(nowDate)} ${F.hhmm(nowDate)} UTC.`;
    if (!ccy) src += ' Quote currency not verified, so prices are not shown.';
    s.line(src); s.line(`Review flag: ${note}`);
    return s;
  }

  // Pure analysis: positions + pies + state -> { alerts, summary }. Marks cooldowns in state.
  // extra.levels (optional): rows of public.support_levels. Alerts on TRANSITIONS only (reached the zone / broke below it); first sight of a stock just records its status.
  function analyse(positions, pieMap, state, nowDate, extra) {
    const F = A(), alerts = [], summary = [], meta = state.held_meta || {}, nowS = nowDate.getTime() / 1000;
    const cooldown = (key, hours) => nowS - (state.last_alerts[key] || 0) < hours * 3600;
    const mark = key => { state.last_alerts[key] = nowS; };
    for (const pos of positions) {
      const ticker = pos.ticker || 'UNKNOWN', avg = num(pos.averagePrice), cur = num(pos.currentPrice), ppl = num(pos.ppl);
      if (cur === 0 || avg === 0) continue;
      const gainPct = (cur - avg) / avg * 100, high = state.highs[ticker] != null ? state.highs[ticker] : cur;
      const dip = high > 0 ? (high - cur) / high * 100 : 0;
      const pieName = resolvePie(ticker, pieMap), exchange = resolveExchange(ticker), display = ticker.split('_')[0];
      const label = F.friendly(ticker, (meta[ticker] || {}).name);
      summary.push({ ticker, display, current: cur, avg, qty: num(pos.quantity), gain_pct: rnd(gainPct, 2), dip_from_high: rnd(dip, 2), ppl: rnd(ppl, 2), pie: pieName, exchange });
      const args = [ticker, meta, cur, avg, high, gainPct, dip, pieName, exchange];
      const mk = (type, key, title, secTitle, note, priority) => {
        const sec = priceSection(secTitle, ...args, note, nowDate);
        alerts.push({ type, ticker: display, key, priority, title, body: F.renderText([sec]), push: F.renderPush([sec]) });
        mark(key);
      };
      if (dip >= BUY_SIGNAL_PCT) {
        const key = 'buy_' + ticker;
        if (!cooldown(key, 6)) mk('buy', key, `🔴 ${label} — down ${dip.toFixed(1)}% from tracked high`, `${label} — deep-dip threshold crossed`,
          'Check the daily report for its weight vs target first. A large fall does not automatically make it a good entry.', 'high');
      } else if (dip >= DIP_FROM_HIGH_PCT) {
        const key = 'dip_' + ticker;
        if (!cooldown(key, 6)) mk('dip', key, `🟡 ${label} — down ${dip.toFixed(1)}% from tracked high`, `${label} — dip threshold crossed`,
          'Watch only for now; review the news and analyst view before adding.', 'default');
      }
      const SL = root.SupportLevels, lv = SL && extra && extra.levels ? extra.levels.find(l => l.symbol === SL.symOf(ticker)) : null, ccy = (meta[ticker] || {}).ccy;
      if (lv && ccy && ccy === lv.currency) {                       // price and zone must be in the same currency, otherwise no comparison (no guess)
        const [c, u] = unitPrice(cur, ccy), st = SL.status(lv, c).key, sym = lv.symbol, prev = (state.support_status = state.support_status || {})[sym];
        state.support_status[sym] = st;
        const kind = !prev || prev === st ? null : st === 'below' ? 'break' : (st === 'in' && (prev === 'above' || prev === 'near')) ? 'reached' : null;
        const key = `support_${kind}_${ticker}`;
        if (kind && !cooldown(key, 24)) {
          const s = new F.Section(`${label} — ${kind === 'break' ? 'broke below its support zone' : 'reached its support zone'}`), z = SL.range(lv), d = SL.status(lv, c).pct;
          s.table('Measure', 'Result', [[`Live ${u} price`, F.money(c, u)], [lv.level_label, z], [kind === 'break' ? 'Below the zone by' : 'Position', kind === 'break' ? F.pct(d, 1, false) : 'inside the zone'],
            ['Your average cost', F.money(unitPrice(avg, ccy)[0], u)], ['Pie', pieName], ['Exchange', exchange]]);
          s.line(`Source: ${lv.source_name}, level captured ${SL.fmtDate(lv.as_of)}; live price from Trading 212, ${F.dayMonth(nowDate)} ${F.hhmm(nowDate)} UTC. An external view, not our calculation.`);
          s.line(kind === 'break' ? 'Review flag: the level has failed for now; reclaiming the top of the zone would be the first sign of recovery. Check the news before acting.'
                                  : 'Review flag: price is testing the level. Holding is the constructive read; a close below the zone is the warning sign.');
          alerts.push({ type: 'support', ticker: display, key, priority: kind === 'break' ? 'high' : 'default',
            title: `${kind === 'break' ? '🔻' : '🛡️'} ${label} — ${kind === 'break' ? 'below' : 'in'} its support zone ${z}`, body: F.renderText([s]), push: F.renderPush([s]) });
          mark(key);
        }
      }
      if (gainPct >= TRIM_GAIN_PCT) {
        const key = 'trim_' + ticker;
        if (!cooldown(key, 24)) mk('trim', key, `💰 ${label} — up ${gainPct.toFixed(1)}% on your cost`, `${label} — profit target crossed`,
          `Up ${gainPct.toFixed(1)}% on your average cost. Consider booking part of the profit (see the Profit Booking tab).`, 'default');
      }
    }
    return { alerts, summary };
  }

  function summarisePie(p, detail) {
    const name = ((detail.settings || {}).name || `Pie ${p.id}`).trim(), insts = detail.instruments || [];
    const val = i => { const r = i.result || {}; return num(r.priceAvgValue != null ? r.priceAvgValue : i.currentValue); };
    const total = insts.reduce((a, i) => a + val(i), 0);
    const invested = insts.reduce((a, i) => a + num((i.result || {}).priceAvgInvestedValue), 0);
    const gain = invested > 0 ? (total - invested) / invested * 100 : 0, drifts = [];
    if (total > 0) for (const i of insts) {
      const actual = val(i) / total * 100, target = i.expectedShare != null ? num(i.expectedShare) * 100 : actual;
      if (Math.abs(actual - target) >= REBALANCE_DRIFT_PCT) drifts.push(`${i.ticker || ''}: ${Math.abs(actual - target).toFixed(1)}%`);
    }
    return { name, instruments: insts, pie: { id: p.id, name, value: rnd(total, 2), gain_pct: rnd(gain, 2), holdings: insts.length, drifts,
      instruments: insts.map(i => ({ ticker: i.ticker || '', expected: i.expectedShare, current: i.currentShare, qty: i.ownedQuantity, result: i.result })) } };
  }

  // opts: { store, client (ZKT212.client), log, newId, nowDate }
  function create(opts) {
    const { store, client } = opts, log = opts.log || (() => {});
    const newId = opts.newId || (() => crypto.randomUUID());
    let problems = [];                       // what Trading 212 refused or could not give this run (never swallowed silently: it ends up in the refresh result)
    const soft = async (path, after) => { try { return await client.get(path, { after }); } catch (e) { problems.push({ path: path.split('?')[0], message: String(e.message || e) }); log(`  skipped ${path.split('?')[0]}: ${e.message}`); return null; } };
    // Plain-words reason for a failed call, naming what the owner can do about it
    const WHAT = { '/api/v0/equity/portfolio': 'your open positions', '/api/v0/equity/account/cash': 'your account balance', '/api/v0/equity/pies': 'your pies' };
    const explain = path => {
      const pr = problems.find(x => x.path === path); if (!pr) return null; const code = (/-> (\d{3})/.exec(pr.message) || [])[1], what = WHAT[path] || path;
      if (code === '401' || code === '403') return `Trading 212 refused the key for ${what} (HTTP ${code}). Check the key is live (not Practice) and has the Portfolio and Account data permissions, then refresh again`;
      if (code === '429') return `Trading 212 is rate-limiting requests, so ${what} could not be read. Wait a minute and refresh again`;
      return `Could not read ${what} from Trading 212 (${pr.message.slice(0, 120)})`;
    };

    async function run(apiKey, apiSecret) {
      client.setCreds(apiKey, apiSecret); problems = [];
      try {
        const nowDate = opts.nowDate ? opts.nowDate() : new Date();
        const state = (await store.get('monitor_state', 'main')) || { highs: {}, last_alerts: {}, run_count: 0 };
        state.highs = state.highs || {}; state.last_alerts = state.last_alerts || {};
        state.run_count = (state.run_count || 0) + 1;

        log('Fetching account, positions, pies');
        const account = await soft('/api/v0/equity/account/cash', 5000);
        const positions = (await soft('/api/v0/equity/portfolio', 5000)) || [];
        const pies = [], pieMap = {};
        const rawPies = await soft('/api/v0/equity/pies', 5000);
        for (const p of rawPies || []) {
          const detail = await soft(`/api/v0/equity/pies/${p.id}`, 8000);
          if (!detail) continue;
          const s = summarisePie(p, detail);
          for (const i of s.instruments) if (i.ticker) pieMap[i.ticker] = s.name;
          pies.push(s.pie);
        }
        if (!positions.length) {
          const why = explain('/api/v0/equity/portfolio') || 'Trading 212 returned no open positions'; log('No positions returned, nothing saved: ' + why);
          return { saved: false, reason: why + '. Nothing was saved, so the dashboards still show the previous snapshot' };
        }
        // Without the account figures the snapshot would carry a total of 0: refuse rather than store a wrong number (a missing figure is better than a made-up one)
        if (!account) {
          const why = explain('/api/v0/equity/account/cash') || 'Trading 212 returned no account balance'; log('No account balance returned, nothing saved: ' + why);
          return { saved: false, reason: why + '. Nothing was saved, so the dashboards still show the previous snapshot' };
        }

        for (const pos of positions) { const c = num(pos.currentPrice); if (pos.ticker && c > 0) state.highs[pos.ticker] = Math.max(state.highs[pos.ticker] || 0, c); }
        // instrument names/currency for held tickers, cached 7 days
        const held = positions.map(p => p.ticker).filter(Boolean), cache = state.instrument_meta_cache || {};
        const stale = !(nowDate.getTime() / 1000 - (cache.ts || 0) < 7 * 86400) || held.some(t => !(cache.data || {})[t]);
        if (stale) {
          const rows = await soft('/api/v0/equity/metadata/instruments', 5000);
          if (rows && rows.length) {
            const data = {};
            for (const r of rows) if (r.ticker && held.includes(r.ticker)) data[r.ticker] = { ccy: r.currencyCode, name: r.shortName || r.name };
            state.instrument_meta_cache = { ts: nowDate.getTime() / 1000, data };
          }
        }
        const data = (state.instrument_meta_cache || {}).data || {};
        state.held_meta = {}; for (const t of held) if (data[t]) state.held_meta[t] = data[t];

        let levels = []; try { levels = opts.supportLevels ? (await opts.supportLevels()) || [] : []; } catch (e) { log('  skipped support levels: ' + e.message); }
        const { alerts, summary } = analyse(positions, pieMap, state, nowDate, { levels });
        const acc = account || {}, total = num(acc.total), cash = num(acc.free), createdAt = nowDate.toISOString();
        // Trading 212's own split: investments value = cost basis + unrealised result (total − free cash would also count reserved/pie cash)
        const hasAcc = acc.invested != null && Number.isFinite(+acc.invested);
        const investedVal = hasAcc ? num(acc.invested) + num(acc.ppl) : total - cash;
        const totalPpl = hasAcc ? num(acc.ppl) : summary.reduce((a, p) => a + p.ppl, 0);
        const snapId = newId();
        const snap = { id: snapId, created_at: createdAt, total_value: rnd(total, 2), cash: rnd(cash, 2), invested: rnd(investedVal, 2),
          total_ppl: rnd(totalPpl, 2), run_count: state.run_count,
          raw: { pies, account: acc, highs: state.highs, instrument_meta: state.held_meta } };
        // Order matters: the dashboards read positions by the LATEST snapshot id, so the snapshot is written LAST, after everything it points at.
        // If the page is reloaded part-way, the unreferenced positions are harmless leftovers and the previous snapshot stays the latest, complete one.
        await store.put('positions', summary.map(p => ({ id: newId(), snapshot_id: snapId, created_at: createdAt, ticker: p.ticker, display: p.display, pie: p.pie, exchange: p.exchange,
          current_price: p.current, avg_price: p.avg, gain_pct: p.gain_pct, dip_from_high: p.dip_from_high, ppl: p.ppl, quantity: p.qty })), r => r.id);
        if (alerts.length) await store.put('alerts', alerts.map(a => ({ id: newId(), created_at: createdAt, type: a.type, alert_type: a.type, ticker: a.ticker, title: a.title, body: a.body })), r => r.id);
        await store.put('portfolio_snapshots', [snap], r => r.id);
        await store.put('monitor_state', [Object.assign({ key: 'main' }, state)], r => r.key);
        log(`${summary.length} positions, ${pies.length} pies, ${alerts.length} alerts saved (encrypted)`);
        const piePb = problems.some(x => x.path === '/api/v0/equity/pies' || x.path.startsWith('/api/v0/equity/pies/'));
        const warnings = piePb ? [explain('/api/v0/equity/pies') || 'Some pie details could not be read from Trading 212, so pie grouping in this snapshot may be incomplete'] : [];
        return { saved: true, snapshotId: snapId, positions: summary.length, pies: pies.length, alerts, warnings };
      } finally { client.clear(); }
    }
    return { run };
  }
  root.ZKMonitor = { create, analyse, resolvePie, resolveExchange, summarisePie };
  if (typeof module !== 'undefined') module.exports = root.ZKMonitor;
})(typeof window !== 'undefined' ? window : globalThis);
