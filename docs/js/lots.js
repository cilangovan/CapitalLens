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
        cost, gain: gainK ? r2(lotRows.reduce((a, l) => a + l.gain, 0)) : null, pct: gainK && costK && cost > 0 ? r2(lotRows.reduce((a, l) => a + l.gain, 0) / cost * 100) : null, best: lotRows.reduce((m, l) => l.pct != null && (m == null || l.pct > m) ? l.pct : m, null),
        worst: lotRows.reduce((m, l) => l.pct != null && (m == null || l.pct < m) ? l.pct : m, null),
        fromNow: cur != null ? STOPS.map(s => ({ pct: s, price: r4(cur * (1 - s / 100)) })) : null });
    }
    return out.sort((a, b) => (b.gain == null ? -1e9 : b.gain) - (a.gain == null ? -1e9 : a.gain));
  }

  function fmts(o) {
    o = o || {};
    return { q: o.quote || ((v) => String(v)), gbp: o.gbp || (v => '£' + Number(v).toFixed(2)), cls: v => v > 0 ? 'green' : v < 0 ? 'red' : '',
      date: t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), nf: v => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 4 }),
      sgn: (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d == null ? 1 : d) };
  }
  const money = (f, v) => (v < 0 ? '−' : '') + esc(f.gbp(Math.abs(v)));
  const retHtml = (f, pct) => pct == null ? '<span class="lt-na">n/a</span>' : `<span class="${f.cls(pct)}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} ${esc(f.sgn(pct, 1))}%</span>`;

  // THE CARD: one short line per stock; tap a stock to open its purchases in a pop-up
  function html(list, o) {
    if (!list || !list.length) return '';                                      // nothing held outside pies: no card
    const f = fmts(o), tot = list.reduce((a, s) => (s.gain != null ? a + s.gain : a), 0), allG = list.every(s => s.gain != null);
    const row = s => `<button type="button" class="lt-row" data-lt="${esc(s.ticker)}" aria-label="${esc(s.display)}: see ${s.lots.length} purchase${s.lots.length === 1 ? '' : 's'}">
        <span class="lt-name">${esc(s.display)}<span class="lt-sub">${s.lots.length} buy${s.lots.length === 1 ? '' : 's'} · ${esc(f.nf(s.held))} sh${s.gap ? ' · incomplete history' : ''}</span></span>
        <span class="lt-res">${retHtml(f, s.pct)}<span class="lt-sub">${s.gain == null ? 'n/a' : money(f, s.gain)}</span></span><span class="lt-go" aria-hidden="true">›</span></button>`;
    return `<div class="card lt-card" id="lots-card"><h3>🧾 Purchases outside pies</h3>
      <div class="lt-note">Shares you hold outside a pie. Tap a stock to see every purchase, its return and stop-loss / sell levels. A sold share disappears. Estimate only.</div>
      ${list.map(row).join('')}
      ${list.length > 1 ? `<div class="lt-total">All: <span class="${f.cls(tot)}">${money(f, tot)}</span>${allG ? '' : ' <span class="lt-na">(some not priced)</span>'}</div>` : ''}</div>`;
  }

  // THE POP-UP: table of this stock's buys; tap a buy for its stop-loss and sell levels
  function lotDetail(s, l, f) {
    const sell = l.next ? `<code class="lt-order" title="Limit sell: enter this in Trading 212 yourself">SELL ${f.nf(l.qty)} ${esc(sym(s.ticker))} limit ${esc(f.q(l.next.price, s.ticker))}</code> <span class="lt-sub">(+${l.next.pct}% on this buy)</span>` : '<span class="lt-sub">above every sell step (+30%): decide your own target</span>';
    return `<div class="lt-lot"><div class="lt-top"><span><b>${esc(f.date(l.bought_at))}</b> · ${esc(f.nf(l.qty))} sh${l.qty < l.of - TOL ? ` <span class="lt-sub">(of ${esc(f.nf(l.of))}, rest sold)</span>` : ''}</span><span class="lt-res">${retHtml(f, l.pct)}</span></div>
      <div class="lt-sub">paid ${l.px != null ? esc(f.q(l.px, s.ticker)) : 'price n/a'}${l.cost != null ? ' · ' + esc(f.gbp(l.cost)) : ''}${s.current != null ? ' · now ' + esc(f.q(s.current, s.ticker)) : ''}${l.gain != null ? ` · <span class="${f.cls(l.gain)}">${money(f, l.gain)}</span>` : ''}</div>
      <div class="lt-lv"><b>Stop-loss</b> ${l.stops.map(x => `<span class="lt-chip ${x.hit ? 'red' : ''}">−${x.pct}% ${x.price != null ? esc(f.q(x.price, s.ticker)) : 'n/a'}${x.loss != null ? ` (−${esc(f.gbp(x.loss))})` : ''}${x.hit ? ' · hit' : ''}</span>`).join('')}</div>
      <div class="lt-lv"><b>Sell steps</b> ${l.steps.map(x => `<span class="lt-chip ${x.hit ? 'green' : ''}">+${x.pct}% ${x.price != null ? esc(f.q(x.price, s.ticker)) : 'n/a'}${x.hit ? ' ✓' : ''}</span>`).join('')}</div>
      <div class="lt-lv">${sell}</div></div>`;
  }
  function modalHtml(s, o, idx) {
    if (!s) return '';
    const f = fmts(o), l = idx != null && s.lots[idx] ? s.lots[idx] : null, head = (title, back) => `<div class="lt-m-head">${back ? '<button type="button" class="lt-m-back" data-lt-back>‹ All buys</button>' : ''}<h3>${title}</h3><button type="button" class="lt-m-x" data-lt-close aria-label="Close">✕</button></div>`;
    let body;
    if (l) {
      body = lotDetail(s, l, f) + (s.fromNow ? `<div class="lt-lv"><b>Stop from today's price</b> ${s.fromNow.map(x => `<span class="lt-chip">−${x.pct}% ${esc(f.q(x.price, s.ticker))}</span>`).join('')}</div>` : '')
        + '<div class="lt-sub lt-foot">Levels are suggestions. CapitalLens places nothing: enter any limit or stop order yourself in Trading 212.</div>';
    } else {
      const tr = (x, i) => `<tr class="lt-tr" data-lot="${i}" tabindex="0" role="button" aria-label="Buy of ${esc(f.date(x.bought_at))}: stop-loss and sell levels"><td>${esc(f.date(x.bought_at))}</td><td>${esc(f.nf(x.qty))}</td><td>${x.px != null ? esc(f.q(x.px, s.ticker)) : 'n/a'}</td>
        <td>${retHtml(f, x.pct)}</td><td class="${f.cls(x.gain)}">${x.gain == null ? 'n/a' : money(f, x.gain)}</td></tr>`;
      body = `<div class="lt-sub">${esc(f.nf(s.held))} sh held outside pies${s.current != null ? ' · now ' + esc(f.q(s.current, s.ticker)) : ''}${s.t212_avg != null ? ` · Trading 212 average ${esc(f.q(s.t212_avg, s.ticker))}` : ''}</div>
        <table class="lt-tbl"><thead><tr><th>Bought</th><th>Shares</th><th>Paid</th><th>Return</th><th>£</th></tr></thead><tbody>${s.lots.map(tr).join('')}</tbody>
        ${s.lots.length > 1 ? `<tfoot><tr><td colspan="3">All ${s.lots.length} buys</td><td>${retHtml(f, s.pct)}</td><td class="${f.cls(s.gain)}">${s.gain == null ? 'n/a' : money(f, s.gain)}</td></tr></tfoot>` : ''}</table>
        <div class="lt-sub lt-foot">Tap a buy for its stop-loss (−5% / −10%) and sell levels. A sale takes off your oldest buys first. FX moves and fees are not included.</div>
        ${s.gap ? `<div class="lt-warn">${s.gap.kind === 'earlier' ? `${esc(f.nf(s.gap.qty))} sh are not in the synced order history (bought earlier, or moved out of a pie): no per-buy figures for them, so judge them on the Trading 212 average.` : `The order history lists ${esc(f.nf(s.gap.qty))} sh more than you hold outside pies (some may have moved into a pie): check against Trading 212.`}</div>` : ''}`;
    }
    return `<div class="lt-m-box" role="dialog" aria-modal="true" aria-label="${esc(s.display)} purchases">${head(`${esc(s.display)} · ${s.lots.length} buy${s.lots.length === 1 ? '' : 's'}`, !!l)}<div class="lt-m-body">${body}</div><button type="button" class="lt-m-close" data-lt-close>Close</button></div>`;
  }
  function closeModal() { const m = typeof document !== 'undefined' && document.getElementById('lt-modal'); if (m) m.classList.remove('open'); if (typeof document !== 'undefined') document.body.style.overflow = ''; }
  function openModal(s, o, idx) {
    if (typeof document === 'undefined' || !s) return null;
    let m = document.getElementById('lt-modal');
    if (!m) {
      m = document.createElement('div'); m.id = 'lt-modal'; document.body.appendChild(m);
      const act = e => {
        if (e.target === m || e.target.closest('[data-lt-close]')) return closeModal();
        if (e.target.closest('[data-lt-back]')) return openModal(m._s, m._o, null);
        const r = e.target.closest('[data-lot]'); if (r) openModal(m._s, m._o, Number(r.getAttribute('data-lot')));
      };
      m.addEventListener('click', act); m.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-lot]')) { e.preventDefault(); act(e); } });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    }
    m._s = s; m._o = o; m.innerHTML = modalHtml(s, o, idx); m.classList.add('open'); document.body.style.overflow = 'hidden';
    const first = m.querySelector('.lt-m-close'); if (first && first.focus) first.focus();
    return m;
  }

  async function show(container, untagged, o) {
    try {
      const old = container.querySelector('#lots-card'); if (old) old.remove();
      if (o.guest || !untagged || !untagged.length) return;
      const orders = await o.api('t212_orders', '?select=id,ticker,side,status,filled_at,quantity,price,net_value&order=filled_at.asc&limit=2000');
      const h = html(rows(orders, untagged, o.now), { quote: o.quote, gbp: o.gbp });
      if (!h) return; container.insertAdjacentHTML('beforeend', h);
      const card = container.querySelector('#lots-card'), list = rows(orders, untagged, o.now);
      if (card && card.addEventListener) card.addEventListener('click', e => { const r = e.target.closest('[data-lt]'); if (r) openModal(list.find(x => x.ticker === r.getAttribute('data-lt')), { quote: o.quote, gbp: o.gbp }, null); });
    } catch (e) { /* orders could not be read: show nothing rather than a wrong card */ }
  }

  root.Lots = { STOPS, STEPS, rows, html, modalHtml, openModal, closeModal, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Lots;
})(typeof window !== 'undefined' ? window : globalThis);
