// ── SUPPORT LEVELS (Strategy tab, under Entry Analysis) ───────────────────────
// For stocks you HOLD only: where each one is likely to find support (public table support_levels: an external analyst view, every row names
// its source and capture date), how far the LIVE price is from that zone, and a plain-language comment. A summary table closes the section.
// Held = in your latest positions snapshot; matching happens in the browser, so what you hold never goes to the server.
// Live price comes from the Entry Analysis rows (value_buy_scores, native currency). If it is missing or in another currency the card says so
// instead of guessing. Nothing here is advice; levels are not our calculation. Rendering escapes everything; no inline handlers.
(function (root) {
  'use strict';
  const CCY = { USD: '$', GBP: '£', EUR: '€', INR: '₹', HKD: 'HK$', JPY: '¥' };
  const TONE = { good: 'g', warn: 'y', bad: 'r', neutral: '' };
  const ST = {                       // status key → [label, colour class, sort order]
    below: ['Below the zone', 'r', 0], in: ['In the zone', 'y', 1], near: ['Approaching the zone', 'y', 2], above: ['Above the zone', 'g', 3], nolive: ['Live price unavailable', 'dim', 4] };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const fmt = n => n >= 100 ? n.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(+Number(n).toFixed(2));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) ? `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : 'unknown date';

  // Trading 212 ticker → the symbol used by support_levels (FB is the old META ticker). Non-US listings never match a US level.
  function symOf(t) {
    t = String(t || ''); if (t === 'FB_US_EQ') return 'META';
    return /_US_EQ$/.test(t) ? t.replace(/_US_EQ$/, '') : t.replace(/_EQ$/, '');
  }
  const sym = lv => CCY[lv.currency] !== undefined ? CCY[lv.currency] : (lv.currency ? lv.currency + ' ' : '');
  const range = lv => { const s = sym(lv), lo = num(lv.zone_low), hi = num(lv.zone_high), a = lv.approx ? '~' : '';
    return lo === hi ? `${a}${s}${fmt(lo)}` : `${a}${s}${fmt(lo)}–${fmt(hi)}`; };

  // #52: levels are a capture on a date. Older than STALE_DAYS → say so on the card and in the section header. Computed levels are always today's.
  const STALE_DAYS = 14;
  const ageDays = (asOf, today) => { const a = Date.parse(String(asOf || '').slice(0, 10)), b = Date.parse(String(today || new Date().toISOString()).slice(0, 10)); return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 864e5) : null; };

  // #50: in-house level. 200-week EMA from weekly closes (last close of each week) of ~5 years of price history ([[unix seconds, close], ...]).
  // Seeded with the simple average of the first 200 weekly closes, then smoothed with 2/(200+1). Needs at least 200 weeks, otherwise null (never a guess).
  function ema200w(points) {
    const wk = new Map();
    for (const p of points || []) {
      const t = num(p && p[0]), c = num(p && p[1]); if (t === null || c === null || c <= 0) continue;
      const d = new Date(t * 1000), mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      if (!wk.has(mon) || t >= wk.get(mon)[0]) wk.set(mon, [t, c]);
    }
    const closes = [...wk.keys()].sort((a, b) => a - b).map(k => wk.get(k)[1]);
    if (closes.length < 200) return null;
    let e = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200; const k = 2 / 201;
    for (let i = 200; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return { value: e, weeks: closes.length };
  }
  function computedLevel(symbol, name, ema, currency, asOf) {
    return { symbol, name: name || symbol, level_label: 'Support level', zone_low: +ema.value.toFixed(2), zone_high: +ema.value.toFixed(2), approx: false, currency: currency || 'USD',
      tags: [{ t: '200-week EMA (computed)', tone: 'neutral' }], snap_price: null, snap_pct_from_high: null, source_name: 'CapitalLens (computed)', as_of: asOf, computed: true,
      note: `200-week EMA from ${ema.weeks} weekly closes` };
  }

  // Where is the live price against the zone? A single-number level counts as "in" within 1.5%; "approaching" = within 3% above the zone.
  function status(lv, live) {
    const p = num(live), lo = num(lv.zone_low), hi = num(lv.zone_high);
    if (p === null || lo === null || hi === null) return { key: 'nolive', pct: null };
    const pad = lo === hi ? lo * 0.015 : 0, a = lo - pad, b = hi + pad;
    if (p < a) return { key: 'below', pct: (p / a - 1) * 100 };
    if (p <= b) return { key: 'in', pct: 0 };
    const away = (p / b - 1) * 100;
    return { key: away <= 3 ? 'near' : 'above', pct: away };
  }

  // Plain-language commentary from the numbers only (no invented facts). Describes, does not instruct.
  function comment(lv, live, st, avgCost) {
    const z = range(lv), out = [], pc = st.pct === null ? null : Math.abs(st.pct).toFixed(1);
    const wait = lv.level_label === 'Wait for';
    if (st.key === 'nolive') out.push(`No live price to compare with ${z}. The captured price was ${num(lv.snap_price) === null ? 'not recorded' : sym(lv) + fmt(lv.snap_price)} on ${fmtDate(lv.as_of)}.`);
    else if (st.key === 'above') out.push(wait ? `Trades ${pc}% above ${z}, the level the source says to wait for. Until it gets there the level is only a marker.`
      : `Trades ${pc}% above the zone, so support is not in play yet. It matters only if the price falls back to ${z}.`);
    else if (st.key === 'near') out.push(`Within ${pc}% of ${z}. Holding above it keeps the setup intact; a close below it weakens it.`);
    else if (st.key === 'in') out.push(`Price is inside ${z} right now, the area the source marks. Holding here is the constructive read; a close below the zone is the warning sign.`);
    else out.push(`Price is ${pc}% below ${z}, so the level has failed for now. Reclaiming the top of the zone (${sym(lv)}${fmt(lv.zone_high)}) would be the first sign of recovery.`);
    const ac = num(avgCost);
    if (ac !== null && ac > 0 && st.key !== 'nolive') out.push(ac < num(lv.zone_low) ? `Your average cost (${sym(lv)}${fmt(ac)}) is below the zone, so a test of it would still be above cost.`
      : ac > num(lv.zone_high) ? `Your average cost (${sym(lv)}${fmt(ac)}) is above the zone, so a test of it would be below cost.` : `Your average cost (${sym(lv)}${fmt(ac)}) sits inside the zone.`);
    const tags = (Array.isArray(lv.tags) ? lv.tags : []).map(t => t && t.t).filter(Boolean);
    if (tags.length) out.push(`Source notes: ${tags.join(' · ')}.`);
    return out;
  }

  // held: Set of symbols you hold. live: { SYMBOL: { price, high52, avgCost, sym } } from Entry Analysis rows.
  function build(levels, held, live) {
    return (levels || []).filter(l => l && held.has(l.symbol)).map(l => {
      const v = live[l.symbol] || null, ok = v && num(v.price) !== null && (v.sym === undefined || v.sym === null || v.sym === sym(l));
      const price = ok ? num(v.price) : null, st = status(l, price);
      const fromHigh = ok && num(v.high52) > 0 ? (price / num(v.high52) - 1) * 100 : null;
      return { lv: l, price, st, fromHigh, avgCost: ok ? v.avgCost : null, text: comment(l, price, st, ok ? v.avgCost : null),
               mismatch: !!(v && num(v.price) !== null && !ok) };
    }).sort((a, b) => ST[a.st.key][2] - ST[b.st.key][2] || a.lv.symbol.localeCompare(b.lv.symbol));
  }

  const pill = (t, c) => `<span class="sl-pill${c ? ' ' + c : ''}">${esc(t)}</span>`;
  function card(r, today) {
    const l = r.lv, s = ST[r.st.key], dist = r.st.key === 'nolive' ? '' : r.st.key === 'in' ? 'inside the zone' : `${Math.abs(r.st.pct).toFixed(1)}% ${r.st.key === 'below' ? 'below' : 'above'} the zone`;
    const age = l.computed ? 0 : ageDays(l.as_of, today), stale = age !== null && age > STALE_DAYS;
    const tags = (Array.isArray(l.tags) ? l.tags : []).map(t => t && t.t ? pill(t.t, TONE[t.tone] || '') : '').join('') + (stale ? pill(`Captured ${age} days ago`, 'y') : '');
    return `<div class="sl-card sl-${s[1] || 'n'}">
      <div class="sl-top"><div class="sl-name"><strong>${esc(l.name)}</strong> <span class="sl-tick">${esc(l.symbol)}</span></div>${pill(s[0], s[1])}</div>
      <div class="sl-zone"><span class="sl-lbl">${esc(l.level_label)}</span><span class="sl-val">${esc(range(l))}</span></div>
      ${tags ? `<div class="sl-tags">${tags}</div>` : ''}
      <div class="sl-stats">
        <span>Live <strong>${r.price === null ? '—' : esc(sym(l) + fmt(r.price))}</strong></span>
        ${dist ? `<span>${esc(dist)}</span>` : ''}
        ${r.fromHigh !== null ? `<span>${esc(r.fromHigh.toFixed(0))}% from 52w high</span>` : ''}
        ${num(l.snap_price) !== null ? `<span class="sl-dim">Captured ${esc(sym(l) + fmt(l.snap_price))}${num(l.snap_pct_from_high) !== null ? ` (${esc(l.snap_pct_from_high)}% from high)` : ''}</span>` : ''}
      </div>
      <div class="sl-note">${r.text.map(t => `<p>${esc(t)}</p>`).join('')}${l.computed ? `<p>${esc('Computed by CapitalLens, not an analyst view: ' + l.note + '.')}</p>` : ''}${stale ? `<p>${esc('This level is ' + age + ' days old; the market may have moved since.')}</p>` : ''}${r.mismatch ? '<p>Live price is in a different currency, so it is not compared with this zone.</p>' : ''}</div>
    </div>`;
  }
  function table(rows) {
    return `<div class="sl-tablewrap"><table class="sl-table"><thead><tr><th>Stock</th><th>Zone</th><th>Live</th><th>Status</th></tr></thead><tbody>${rows.map(r => {
      const l = r.lv, s = ST[r.st.key];
      return `<tr><td><strong>${esc(l.symbol)}</strong></td><td class="sl-g">${esc(range(l))}</td><td>${r.price === null ? '—' : esc(sym(l) + fmt(r.price))}</td><td>${pill(s[0], s[1])}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function html(rows, notHeld, today) {
    if (!rows.length) return `<div class="card"><h3>🛡️ Support Levels</h3><div class="sl-empty">None of the stocks you hold has a support level on file yet.${notHeld ? ` ${esc(notHeld)} level${notHeld === 1 ? '' : 's'} exist for stocks you do not hold, and they are not shown.` : ''}</div></div>`;
    const src = [...new Set(rows.map(r => r.lv.source_name).filter(Boolean))].join(', '), asof = rows.filter(r => !r.lv.computed).map(r => r.lv.as_of).filter(Boolean).sort()[0];
    return `<div class="card"><h3>🛡️ Support Levels</h3>
      <div class="sl-sub">Stocks you hold only · where buyers have stepped in before, against the live price. Source: ${esc(src || 'not named')}${asof ? `, captured ${esc(fmtDate(asof))}` : ''}. Levels are an external view or a plain indicator, not advice.</div>
      ${rows.map(r => card(r, today)).join('')}
      <h4 class="sl-h4">Summary</h4>${table(rows)}</div>`;
  }

  // 5 years of daily closes through the dashboard's own /chart route (cached for the page's life); null when unavailable
  const EMA_CACHE = new Map();
  function emaFor(sym) {
    if (!EMA_CACHE.has(sym)) EMA_CACHE.set(sym, (async () => {
      try {
        const r = await fetch(`${PROXY}/chart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: typeof SESSION_TOKEN !== 'undefined' ? SESSION_TOKEN : undefined, symbol: sym, range: '5y' }) });
        const d = r.ok ? await r.json().catch(() => null) : null;
        return d && d.points ? ema200w(d.points) : null;
      } catch (e) { return null; }
    })());
    return EMA_CACHE.get(sym);
  }
  async function load(vbRows) {
    const el = typeof document !== 'undefined' && document.getElementById('support-levels-content'); if (!el) return;
    if (typeof IS_GUEST !== 'undefined' && IS_GUEST) { el.innerHTML = ''; return; }
    try {
      const snap = (await api('portfolio_snapshots', '?select=id&order=created_at.desc&limit=1'))[0];
      const pos = snap ? await api('positions', `?snapshot_id=eq.${snap.id}&select=ticker`) : [];
      const levels = await api('support_levels', '?select=*&order=symbol.asc');
      const held = new Set(pos.map(p => symOf(p.ticker))), live = {};
      (vbRows || []).forEach(v => { const t = v.this_week || {}, k = symOf(v.ticker); if (num(t.current) !== null) live[k] = { price: t.current, high52: t.high_52w, avgCost: t.avg_cost, sym: v.currency_symbol || null }; });
      const have = new Set(levels.map(l => l.symbol)), today = new Date().toISOString().slice(0, 10), extra = [];
      const names = {}; (vbRows || []).forEach(v => { names[symOf(v.ticker)] = v.display || v.ticker; });
      const want = pos.filter(p => /^[A-Z0-9.]{1,12}_US_EQ$/.test(p.ticker || '') && !have.has(symOf(p.ticker))).map(p => symOf(p.ticker)).slice(0, 15);
      await Promise.all(want.map(async s => { const c = await emaFor(s); if (c) extra.push(computedLevel(s, names[s], c, 'USD', today)); }));
      const rows = build(levels.concat(extra), held, live);
      el.innerHTML = html(rows, levels.filter(l => !held.has(l.symbol)).length, today);
    } catch (e) { el.innerHTML = '<div class="card"><h3>🛡️ Support Levels</h3><div class="sl-empty">Support levels could not be loaded. Try Refresh.</div></div>'; }
  }
  root.loadSupportLevels = load;
  root.SupportLevels = { symOf, status, comment, build, html, range, fmtDate, ageDays, ema200w, computedLevel, STALE_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SupportLevels;
})(typeof window !== 'undefined' ? window : globalThis);
