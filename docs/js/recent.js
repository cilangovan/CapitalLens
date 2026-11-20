// ── RECENT PURCHASES (Positions tab): what you bought in the last 7 days and how it is doing since ───────────────
// Source: your filled Trading 212 BUY orders (fill price, quantity, cash paid) against the latest price from the last refresh.
// A purchase shows for 7 days from its fill time, then drops off by itself; with none left the card is not shown at all.
// The result is an ESTIMATE: (latest price / your fill price − 1) × cash paid. It ignores FX moves on the way and is only as fresh as the last Refresh.
(function (root) {
  'use strict';
  const DAYS = 7, DAY = 86400000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const num = v => { const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };

  // One row per ticker bought inside the window (several fills of the same ticker are combined at their weighted fill price).
  function rows(orders, positions, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs, byT = new Map(), pos = new Map((positions || []).map(p => [p.ticker, p]));
    for (const o of orders || []) {
      if (!o || o.side !== 'BUY' || !['FILLED', 'PARTIALLY_FILLED'].includes(o.status) || !o.ticker) continue;
      const t = Date.parse(o.filled_at); if (!Number.isFinite(t) || t > now + 3600000 || now - t >= DAYS * DAY) continue;   // older than 7 days = expired
      const q = num(o.quantity), px = num(o.price), cost = num(o.net_value) == null ? null : Math.abs(num(o.net_value));
      const r = byT.get(o.ticker) || { ticker: o.ticker, qty: 0, pxq: 0, pxqty: 0, cost: 0, costKnown: false, first: t, last: t, fills: 0 };
      r.fills++; r.first = Math.min(r.first, t); r.last = Math.max(r.last, t);
      if (q != null && q > 0) { r.qty += q; if (px != null) { r.pxq += px * q; r.pxqty += q; } }
      if (cost != null) { r.cost += cost; r.costKnown = true; }
      byT.set(o.ticker, r);
    }
    return [...byT.values()].sort((a, b) => b.last - a.last).map(r => {
      const p = pos.get(r.ticker), fill = r.pxqty ? r.pxq / r.pxqty : null, cur = p ? num(p.current_price) : null;
      const pct = fill && cur != null ? (cur / fill - 1) * 100 : null;          // null = cannot be worked out: say so, never 0
      const expires = r.first + DAYS * DAY, left = Math.max(0, Math.ceil((expires - now) / DAY));
      return { ticker: r.ticker, display: (p && p.display) || r.ticker.split('_')[0], pie: p ? p.pie || null : null, held: !!p, qty: r.qty || null,
               fill, current: cur, cost: r.costKnown ? Math.round(r.cost * 100) / 100 : null, fills: r.fills, bought_at: r.first, days_left: left,
               pct: pct == null ? null : Math.round(pct * 100) / 100, gain: pct != null && r.costKnown ? Math.round(r.cost * pct) / 100 : null };
    });
  }

  function html(list, o) {
    if (!list || !list.length) return '';                                       // nothing in the last 7 days = no card
    o = o || {}; const q = o.quote || (v => String(v)), gbp = o.gbp || (v => '£' + Number(v).toFixed(2)), cls = v => v > 0 ? 'green' : v < 0 ? 'red' : '';
    const age = r => { const d = Math.floor(((o.now == null ? Date.now() : o.now) - r.bought_at) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
    const one = r => `<div class="rb-row"><div class="rb-main"><span class="rb-name">${esc(r.display)}</span>${r.pie ? ` <span class="rb-pie">${esc(r.pie)}</span>` : ''}
        <div class="rb-sub">${age(r)}${r.cost != null ? ' · paid ' + esc(gbp(r.cost)) : ''}${r.fill != null ? ' · fill ' + esc(q(r.fill, r.ticker)) : ''}${r.current != null ? ' · now ' + esc(q(r.current, r.ticker)) : ''}</div></div>
        <div class="rb-res">${r.pct == null ? `<span class="rb-na">${r.held ? 'price n/a' : 'not held now'}</span>` :
          `<span class="${cls(r.pct)}">${r.pct > 0 ? '▲' : r.pct < 0 ? '▼' : '■'} ${Math.abs(r.pct).toFixed(2)}%</span>${r.gain != null ? `<div class="rb-sub ${cls(r.gain)}">${r.gain < 0 ? '−' : ''}${esc(gbp(Math.abs(r.gain)))}</div>` : ''}`}
        <div class="rb-sub">${r.days_left}d left</div></div></div>`;
    const tot = list.reduce((s, r) => (r.gain != null ? s + r.gain : s), 0), allG = list.every(r => r.gain != null);
    return `<div class="card rb-card" id="recent-buys"><h3>🆕 Recent purchases · last 7 days</h3>
      <div class="rb-note">Estimate from your Trading 212 fill price and the latest price at your last Refresh (FX moves not included). Each purchase drops off by itself after 7 days.</div>
      ${list.map(one).join('')}
      ${list.length > 1 ? `<div class="rb-total">Since purchase: <span class="${cls(tot)}">${tot < 0 ? '−' : ''}${esc(gbp(Math.abs(tot)))}</span>${allG ? '' : ' <span class="rb-na">(some not priced)</span>'}</div>` : ''}</div>`;
  }

  // Loads the orders (newest first), keeps the last 7 days and puts the card at the top of `container`. Orders unreadable = no card, no claim.
  async function show(container, positions, o) {
    try {
      const orders = await o.api('t212_orders', '?select=ticker,side,status,filled_at,quantity,price,net_value&order=filled_at.desc&limit=200');
      const h = html(rows(orders, positions, o.now), { quote: o.quote, gbp: o.gbp, now: o.now });
      const old = container.querySelector('#recent-buys'); if (old) old.remove();
      if (h) container.insertAdjacentHTML('afterbegin', h);
    } catch (e) { /* orders could not be read: show nothing rather than a wrong card */ }
  }

  root.RecentBuys = { DAYS, rows, html, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RecentBuys;
})(typeof window !== 'undefined' ? window : globalThis);
