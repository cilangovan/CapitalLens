// ── PURCHASES OUTSIDE PIES (Positions tab): every buy of a share you hold outside a pie, how each one is doing, stop-loss and sell levels ──
// Source: your filled Trading 212 BUY and SELL orders. Only shares you STILL hold outside a pie are listed: sell the lot and it disappears by itself.
// A sale takes off your oldest buys first (FIFO) - Trading 212 itself reports one blended average price, so this is an estimate and says so.
// Gain per buy = (latest price / your fill price - 1) x cash paid for the shares still held. FX moves and fees are not included. Nothing is placed or sold from here:
// the stop and limit levels are suggestions you enter yourself in Trading 212.
(function (root) {
  'use strict';
  const STOPS = [5, 10], STEPS = [10, 20, 30], TOL = 1e-4;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const num = v => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
  const r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 10000) / 10000;
  const sym = t => String(t || '').split('_')[0];

  // untagged: [{ ticker, display, pie, dq (shares held OUTSIDE pies), current_price, avg_price }] as worked out by positions.js
  function rows(orders, untagged, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs, byT = new Map();
    for (const o of orders || []) {
      if (!o || !o.ticker || !['BUY', 'SELL'].includes(o.side) || !['FILLED', 'PARTIALLY_FILLED'].includes(o.status)) continue;
      const t = Date.parse(o.filled_at), q = num(o.quantity); if (!Number.isFinite(t) || t > now + 3600000 || !(q > 0)) continue;
      (byT.get(o.ticker) || byT.set(o.ticker, []).get(o.ticker)).push({ side: o.side, t, q, px: num(o.price), cost: num(o.net_value) == null ? null : Math.abs(num(o.net_value)), id: String(o.id || o.order_id || '') });
    }
    const out = [];
    for (const u of untagged || []) {
      if (!u || !u.ticker) continue; const dq = num(u.dq); if (!(dq > TOL)) continue;                 // nothing held outside pies (or sold): not listed
      const fills = (byT.get(u.ticker) || []).sort((a, b) => a.t - b.t || (a.side === 'BUY' ? -1 : 1) - (b.side === 'BUY' ? -1 : 1) || a.id.localeCompare(b.id)), lots = [];
      for (const f of fills) {
        if (f.side === 'BUY') { lots.push({ t: f.t, qty: f.q, left: f.q, px: f.px, cost: f.cost }); continue; }
        let s = f.q; for (const l of lots) { if (s <= TOL) break; const take = Math.min(l.left, s); l.left -= take; s -= take; }   // FIFO: oldest buys go first
      }
      const open = lots.filter(l => l.left > TOL), tracked = open.reduce((a, l) => a + l.left, 0), cur = num(u.current_price);
      const lotRows = open.map(l => {
        const frac = l.left / l.qty, cost = l.cost == null ? null : r2(l.cost * frac), pct = l.px && cur != null ? Math.round((cur / l.px - 1) * 1e8) / 1e6 : null;     // rounded so +20.000% really counts as +20%
        const stops = STOPS.map(s => ({ pct: s, price: l.px ? r4(l.px * (1 - s / 100)) : null, loss: cost == null ? null : r2(cost * s / 100), hit: l.px && cur != null ? cur <= r4(l.px * (1 - s / 100)) : null }));
        const steps = STEPS.map(g => ({ pct: g, price: l.px ? r4(l.px * (1 + g / 100)) : null, hit: pct == null ? null : pct >= g }));
        return { bought_at: l.t, qty: r4(l.left), of: r4(l.qty), px: l.px, cost, pct: pct == null ? null : r2(pct), gain: pct != null && cost != null ? r2(cost * pct / 100) : null, stops, steps,
                 next: steps.find(s => s.hit === false) || null };
      }).sort((a, b) => a.bought_at - b.bought_at);
      const miss = dq - tracked, costK = lotRows.every(l => l.cost != null) && lotRows.length > 0, cost = costK ? r2(lotRows.reduce((a, l) => a + l.cost, 0)) : null;
      const gainK = lotRows.length > 0 && lotRows.every(l => l.gain != null);
      out.push({ ticker: u.ticker, display: u.display || sym(u.ticker), pie: u.pie || null, held: r4(dq), current: cur, t212_avg: num(u.avg_price), lots: lotRows,
        gap: miss > TOL ? { qty: r4(miss), kind: 'earlier' } : miss < -TOL ? { qty: r4(-miss), kind: 'extra' } : null,    // earlier = bought before the synced history; extra = orders list more than you hold outside pies
        cost, gain: gainK ? r2(lotRows.reduce((a, l) => a + l.gain, 0)) : null, best: lotRows.reduce((m, l) => l.pct != null && (m == null || l.pct > m) ? l.pct : m, null),
        worst: lotRows.reduce((m, l) => l.pct != null && (m == null || l.pct < m) ? l.pct : m, null),
        fromNow: cur != null ? STOPS.map(s => ({ pct: s, price: r4(cur * (1 - s / 100)) })) : null });
    }
    return out.sort((a, b) => (b.gain == null ? -1e9 : b.gain) - (a.gain == null ? -1e9 : a.gain));
  }

  function html(list, o) {
    if (!list || !list.length) return '';                                      // nothing held outside pies: no card
    o = o || {}; const q = o.quote || ((v) => String(v)), gbp = o.gbp || (v => '£' + Number(v).toFixed(2)), cls = v => v > 0 ? 'green' : v < 0 ? 'red' : '';
    const date = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), nf = v => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 4 });
    const sgn = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d);
    const money = v => (v < 0 ? '−' : '') + esc(gbp(Math.abs(v)));
    const lot = (s, l) => {
      const nx = l.next ? `<code class="lt-order" title="Limit sell: enter this in Trading 212 yourself">SELL ${nf(l.qty)} ${esc(sym(s.ticker))} limit ${esc(q(l.next.price, s.ticker))}</code> <span class="lt-sub">(+${l.next.pct}% on this buy)</span>` : '<span class="lt-sub">above every sell step (+30%): decide your own target</span>';
      return `<div class="lt-lot"><div class="lt-top"><span><b>${esc(date(l.bought_at))}</b> · ${esc(nf(l.qty))} sh${l.qty < l.of - TOL ? ` <span class="lt-sub">(of ${esc(nf(l.of))}, rest sold)</span>` : ''}</span>
        <span class="lt-res">${l.pct == null ? '<span class="lt-na">price n/a</span>' : `<span class="${cls(l.pct)}">${l.pct > 0 ? '▲' : l.pct < 0 ? '▼' : '■'} ${esc(sgn(l.pct, 2))}%</span>`}</span></div>
        <div class="lt-sub">paid ${l.px != null ? esc(q(l.px, s.ticker)) : 'price n/a'}${l.cost != null ? ' · ' + esc(gbp(l.cost)) : ''}${s.current != null ? ' · now ' + esc(q(s.current, s.ticker)) : ''}${l.gain != null ? ` · <span class="${cls(l.gain)}">${money(l.gain)}</span>` : ''}</div>
        <div class="lt-lv"><b>Stop-loss</b> ${l.stops.map(x => `<span class="lt-chip ${x.hit ? 'red' : ''}">−${x.pct}% ${x.price != null ? esc(q(x.price, s.ticker)) : 'n/a'}${x.loss != null ? ` (−${esc(gbp(x.loss))})` : ''}${x.hit ? ' · hit' : ''}</span>`).join('')}</div>
        <div class="lt-lv"><b>Sell steps</b> ${l.steps.map(x => `<span class="lt-chip ${x.hit ? 'green' : ''}">+${x.pct}% ${x.price != null ? esc(q(x.price, s.ticker)) : 'n/a'}${x.hit ? ' ✓' : ''}</span>`).join('')}</div>
        <div class="lt-lv">${nx}</div></div>`;
    };
    const stock = s => `<details class="lt-stock" ${list.length === 1 ? 'open' : ''}><summary><span class="lt-name">${esc(s.display)}${s.pie ? ` <span class="lt-sub">also in ${esc(s.pie)}</span>` : ''}</span>
        <span class="lt-res">${s.gain == null ? '<span class="lt-na">n/a</span>' : `<span class="${cls(s.gain)}">${money(s.gain)}</span>`}<span class="lt-sub"> · ${s.lots.length} buy${s.lots.length === 1 ? '' : 's'}${s.best != null && s.lots.length > 1 ? ` · ${esc(sgn(s.worst))}% to ${esc(sgn(s.best))}%` : ''}</span></span></summary>
      <div class="lt-body"><div class="lt-sub">${esc(nf(s.held))} sh held outside pies${s.t212_avg != null ? ` · Trading 212 average ${esc(q(s.t212_avg, s.ticker))} (blends every buy)` : ''}${s.cost != null ? ` · cost of the buys below ${esc(gbp(s.cost))}` : ''}</div>
        ${s.fromNow ? `<div class="lt-lv"><b>Stop from today's price</b> ${s.fromNow.map(x => `<span class="lt-chip">−${x.pct}% ${esc(q(x.price, s.ticker))}</span>`).join('')}</div>` : ''}
        ${s.lots.map(l => lot(s, l)).join('')}
        ${s.gap ? `<div class="lt-warn">${s.gap.kind === 'earlier' ? `${esc(nf(s.gap.qty))} sh are not in the synced order history (bought earlier, or moved out of a pie): no per-buy figures for them, so judge them on the Trading 212 average above.` : `The order history lists ${esc(nf(s.gap.qty))} sh more than you hold outside pies (some may have moved into a pie): check against Trading 212.`}</div>` : ''}</div></details>`;
    const tot = list.reduce((a, s) => (s.gain != null ? a + s.gain : a), 0), allG = list.every(s => s.gain != null);
    return `<div class="card lt-card" id="lots-card"><h3>🧾 Purchases outside pies</h3>
      <div class="lt-note">Each buy of a share you still hold outside a pie, with its own return, stop-loss and sell levels. A sold share disappears. Estimate from your Trading 212 fill prices and the latest price at your last Refresh: a sale takes off your oldest buys first, FX moves and fees are not included. Levels are suggestions; place any limit or stop order yourself in Trading 212.</div>
      ${list.map(stock).join('')}
      ${list.length > 1 ? `<div class="lt-total">All buys: <span class="${cls(tot)}">${money(tot)}</span>${allG ? '' : ' <span class="lt-na">(some not priced)</span>'}</div>` : ''}</div>`;
  }

  async function show(container, untagged, o) {
    try {
      const old = container.querySelector('#lots-card'); if (old) old.remove();
      if (o.guest || !untagged || !untagged.length) return;
      const orders = await o.api('t212_orders', '?select=id,ticker,side,status,filled_at,quantity,price,net_value&order=filled_at.asc&limit=2000');
      const h = html(rows(orders, untagged, o.now), { quote: o.quote, gbp: o.gbp });
      if (h) container.insertAdjacentHTML('beforeend', h);
    } catch (e) { /* orders could not be read: show nothing rather than a wrong card */ }
  }

  root.Lots = { STOPS, STEPS, rows, html, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Lots;
})(typeof window !== 'undefined' ? window : globalThis);
