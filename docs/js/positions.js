// ── POSITIONS ─────────────────────────────────────────────────
async function loadPositions() {
  if (IS_GUEST) {
    document.getElementById('positions-list').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view holdings</div>';
    return;
  }
  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) return;
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*`);
  const analystRows = await api('analyst_ratings','?select=ticker,star_rating,recommendation,source').catch(()=>[]);
  const analystMap = {};
  analystRows.forEach(a => { analystMap[a.ticker] = a; });

  const groups = {};
  positions.forEach(p => {
    if (!p.pie) return;                             // held only outside pies → Untagged group below
    if (!groups[p.pie]) groups[p.pie] = [];
    groups[p.pie].push(p);
  });

  const container = document.getElementById('positions-list');
  container.innerHTML = '';
  PD.snap = null;                                   // drill-down reloads fresh data
  const meta = snap.raw?.instrument_meta || {};
  // T212 quotes prices in the instrument currency (GBX = pence). Show them that way, not as £.
  const fmtQuote = (v, t) => {
    if (v == null) return '—';
    const c = meta[t]?.ccy;
    if (c === 'GBX' || c === 'GBp') return Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + 'p';
    const sym = { GBP: '£', USD: '$', EUR: '€' }[c];
    return sym ? sym + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Number(v).toFixed(2) + (c ? ' ' + c : '');
  };
  const src = { pies: snap.raw?.pies || [], total_value: snap.total_value, cash: snap.cash, total_ppl: snap.total_ppl, acc: snap.raw?.account };
  const pieLive = name => (typeof pdLive === 'function') ? pdLive(src, name) : null;
  const all = pieLive('__ALL__');
  if (all && all.value) {
    const ror = all.invested ? all.result / all.invested * 100 : null;
    const card = document.createElement('div');
    card.className = 'card pd-allcard';
    card.setAttribute('role', 'button');
    card.onclick = () => pdOpen('__ALL__');
    card.innerHTML = `<div class="w-dim w-small">ALL POSITIONS · tap for chart</div>
      <div class="pd-allrow"><span class="pd-allval">${fmtGbpPlain(all.value)}</span>
      <span class="${clr(all.result)}">${pdArrow(ror)} ${ror != null ? Math.abs(ror).toFixed(1) + '%' : '—'} · ${fmtGbpPlain(all.result)}</span>
      <span class="w-chev">›</span></div>`;
    container.appendChild(card);
  }

  Object.entries(groups).forEach(([pieName, pos]) => {
    const totalPpl = pos.reduce((s,p) => s + (p.ppl||0), 0);
    const pl = pieLive(pieName);
    const pror = pl && pl.invested ? pl.result / pl.invested * 100 : null;
    const div = document.createElement('div');
    div.className = 'pie-group';
    div.innerHTML = `
      <div class="pie-header" onclick="togglePie(this)">
        <span class="pie-name"><a href="#positions/${encodeURIComponent(pieName)}" class="w-link" onclick="pdOpen('${pieName.replace(/'/g, "\\'")}', null, event)">${pieName}</a></span>
        <span class="pie-meta">${pl && pl.value ? `${fmtGbpPlain(pl.value)} · <span class="${clr(pror)}">${pdArrow(pror)} ${pror != null ? Math.abs(pror).toFixed(1) + '%' : ''}</span> · ` : ''}${pos.length} holdings · P&amp;L <span class="${clr(totalPpl)}">${fmtGbpPlain(totalPpl)}</span>
          <button class="pd-chartbtn" title="Chart & returns" onclick="pdOpen('${pieName.replace(/'/g, "\\'")}', null, event)">📈</button></span>
      </div>
      <div class="pie-body">
        <div class="pos-row">
          <span class="pos-head">Ticker</span>
          <span class="pos-head">Price</span>
          <span class="pos-head">Avg</span>
          <span class="pos-head">Gain %</span>
          <span class="pos-head">Dip</span>
          <span class="pos-head">Analyst</span>
        </div>
        ${pos.map(p => {
          const a = analystMap[p.ticker] || {};
          const analystHtml = a.star_rating
            ? `<span class="stars">${'★'.repeat(a.star_rating)}</span> ${badgeRating(a)}`
            : '—';
          const pplCell = IS_GUEST
            ? `<span class="masked">***</span>`
            : `<span class="${clr(p.gain_pct)}">${fmt(p.gain_pct)}%</span>`;
          return `<div class="pos-row">
            <span><a href="#positions/${encodeURIComponent(p.ticker)}" class="w-link" onclick="pdOpen('${(p.pie || '__ALL__').replace(/'/g, "\\'")}','${p.ticker}', event)">${p.display||p.ticker}</a></span>
            <span>${fmtQuote(p.current_price, p.ticker)}</span>
            <span>${fmtQuote(p.avg_price, p.ticker)}</span>
            ${pplCell}
            <span class="${clr(p.dip_from_high)}">${fmt(p.dip_from_high)}%</span>
            <span>${analystHtml}</span>
          </div>`;
        }).join('')}
      </div>`;
    container.appendChild(div);
  });

  // ── Untagged: shares held outside any pie (manual app orders, shares moved out of a pie) ──
  const pies = snap.raw?.pies || [];
  const pieQty = {}, pieRes = {}, pps = {}, gbpPer = {};   // pps = £/share from the pie; gbpPer = £ per quote unit, by currency
  pies.forEach(pp => (pp.instruments || []).forEach(i => {
    const r = i.result || {}, q = +i.qty || 0, v = +r.priceAvgValue || 0;
    pieQty[i.ticker] = (pieQty[i.ticker] || 0) + q;
    pieRes[i.ticker] = (pieRes[i.ticker] || 0) + (+r.priceAvgResult || 0);
    if (q > 0 && v > 0) {
      pps[i.ticker] = v / q;
      const pos = positions.find(x => x.ticker === i.ticker), c = meta[i.ticker]?.ccy;
      if (pos?.current_price && c && !gbpPer[c]) gbpPer[c] = (v / q) / +pos.current_price;
    }
  }));
  gbpPer.GBP = 1; gbpPer.GBX = gbpPer.GBX || 0.01; gbpPer.GBp = 0.01;
  const untagged = positions.map(p => {
    const dq = (+p.quantity || 0) - (pieQty[p.ticker] || 0);
    if (dq <= 1e-6) return null;
    const c = meta[p.ticker]?.ccy;
    const unitGbp = pps[p.ticker] ?? (gbpPer[c] && p.current_price ? gbpPer[c] * +p.current_price : null);
    const value = unitGbp != null ? dq * unitGbp : null;
    const res = p.ppl != null ? +p.ppl - (pieRes[p.ticker] || 0) : null;
    const gain = value != null && res != null && value - res > 0 ? res / (value - res) * 100 : null;
    return { ...p, dq, value, res, gain };
  }).filter(Boolean).sort((x, y) => (y.value || 0) - (x.value || 0));
  if (untagged.length) {
    const tv = untagged.reduce((a, u) => a + (u.value || 0), 0), tr = untagged.reduce((a, u) => a + (u.res || 0), 0);
    const tror = tv - tr > 0 ? tr / (tv - tr) * 100 : null;
    const div = document.createElement('div');
    div.className = 'pie-group';
    div.innerHTML = `
      <div class="pie-header" onclick="togglePie(this)">
        <span class="pie-name"><a href="#positions/untagged" class="w-link" onclick="pdOpen('__DIRECT__', null, event)">Untagged</a> <span class="w-dim w-small">outside pies</span></span>
        <span class="pie-meta">${fmtGbpPlain(tv)} · <span class="${clr(tror)}">${pdArrow(tror)} ${tror != null ? Math.abs(tror).toFixed(1) + '%' : ''}</span> · ${untagged.length} holding${untagged.length > 1 ? 's' : ''} · P&amp;L <span class="${clr(tr)}">${fmtGbpPlain(tr)}</span>
          <button class="pd-chartbtn" title="Chart & returns" onclick="pdOpen('__DIRECT__', null, event)">📈</button></span>
      </div>
      <div class="pie-body">
        <div class="pos-row">
          <span class="pos-head">Ticker</span>
          <span class="pos-head">Price</span>
          <span class="pos-head">Value</span>
          <span class="pos-head">Gain %</span>
          <span class="pos-head">Dip</span>
          <span class="pos-head">Analyst</span>
        </div>
        ${untagged.map(u => {
          const a = analystMap[u.ticker] || {};
          const analystHtml = a.star_rating ? `<span class="stars">${'★'.repeat(a.star_rating)}</span> ${badgeRating(a)}` : '—';
          const also = pieQty[u.ticker] > 1e-6 ? ` · also in ${pdEsc(u.pie || 'a pie')}` : '';
          return `<div class="pos-row">
            <span><a href="#positions/${encodeURIComponent(u.ticker)}" class="w-link" onclick="pdOpen('__DIRECT__','${u.ticker}', event)">${u.display || u.ticker}</a>
              <div class="w-dim w-small">${(+u.dq).toLocaleString('en-GB', { maximumFractionDigits: 4 })} sh${also}</div></span>
            <span>${fmtQuote(u.current_price, u.ticker)}</span>
            <span>${IS_GUEST ? '<span class="masked">***</span>' : u.value != null ? fmtGbpPlain(u.value) : '—'}</span>
            <span class="${clr(u.gain)}">${IS_GUEST ? '<span class="masked">***</span>' : u.gain != null ? fmt(u.gain) + '%' : '—'}</span>
            <span class="${clr(u.dip_from_high)}">${fmt(u.dip_from_high)}%</span>
            <span>${analystHtml}</span>
          </div>`;
        }).join('')}
      </div>`;
    container.appendChild(div);
  }
}

function togglePie(header) {
  header.nextElementSibling.classList.toggle('open');
}
