// ── INSTRUMENT INFO (full name + flag) — comes from the database, not from this file ──
// Table public.instrument_exposure (ticker → display_name, flag, exposure): shared reference data,
// read-only for signed-in users via row-level security. If it can't be read, tooltips still show the ticker and P&L.
async function loadExposure() {
  try {
    const rows = await api('instrument_exposure', '?select=ticker,display_name,flag,exposure');
    const m = {};
    (Array.isArray(rows) ? rows : []).forEach(r => { m[r.ticker] = r; });
    return m;
  } catch (e) { return {}; }
}
const _hmEsc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ── RADIAL P&L CHART ──────────────────────────────────────────
async function loadHeatmap() {
  const wrap = document.getElementById('heatmap-grid');
  if (IS_GUEST) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view radial P&L</div>';
    return;
  }

  const snaps = await api('portfolio_snapshots','?select=id,created_at&order=created_at.desc&limit=60');
  if (!snaps.length) { wrap.innerHTML = '<div class="loading">No snapshot data yet.</div>'; return; }

  const latest   = snaps[0];
  const now      = new Date(latest.created_at);

  const findSnap = (daysAgo) => {
    const target = now - daysAgo * 86400000;
    const candidates = snaps.slice(1);
    if (!candidates.length) return null;
    return candidates.reduce((best, s) =>
      Math.abs(new Date(s.created_at) - target) < Math.abs(new Date(best.created_at) - target) ? s : best
    , candidates[0]);
  };

  const daySnap   = findSnap(1);
  const weekSnap  = findSnap(7);
  const monthSnap = findSnap(30);

  const fetchPos = async (snap) => {
    if (!snap) return {};
    const rows = await api('positions', `?snapshot_id=eq.${snap.id}&select=ticker,ppl`).catch(() => []);
    const m = {};
    rows.forEach(r => { m[r.ticker] = +r.ppl || 0; });
    return m;
  };

  const [curRows, dayMap, weekMap, monthMap, exposure] = await Promise.all([
    api('positions', `?snapshot_id=eq.${latest.id}&select=ticker,display,pie,ppl,gain_pct`),
    fetchPos(daySnap),
    fetchPos(weekSnap),
    fetchPos(monthSnap),
    loadExposure(),
  ]);

  const tickers  = curRows.map(p => p.ticker);
  const curMap   = {};
  curRows.forEach(r => { curMap[r.ticker] = r; });

  const delta = (ticker, refMap) => {
    const c = curMap[ticker]?.ppl ?? 0;
    const r = refMap[ticker] ?? c;
    return c - r;
  };

  const periods = [
    { label: 'Monthly',  refMap: monthMap, hasRef: !!monthSnap, snap: monthSnap, target: 30 },
    { label: 'Weekly',   refMap: weekMap,  hasRef: !!weekSnap,  snap: weekSnap,  target: 7  },
    { label: 'Daily',    refMap: dayMap,   hasRef: !!daySnap,   snap: daySnap,   target: 1  },
    { label: 'All-time', refMap: null,     hasRef: true,        snap: null,      target: 0  },
  ];
  // Actual look-back we really have for each period (history may be shorter than the period name says)
  periods.forEach(pd => { pd.span = pd.snap ? (now - new Date(pd.snap.created_at)) / 86400000 : null; });

  // colour: vivid indigo/purple → cyan → emerald (gain) | red→orange (loss)
  const pplColor = (val, maxAbs) => {
    if (maxAbs === 0) return '#1e293b';
    const t = Math.max(-1, Math.min(1, val / maxAbs));
    if (t >= 0) {
      // 0 → +1 : cyan #06b6d4 → emerald #10b981 → lime #84cc16
      const r = Math.round(6   + (132 - 6)   * t);
      const g = Math.round(182 + (204 - 182) * t);
      const b = Math.round(212 + (22  - 212) * Math.min(t * 2, 1));
      return `rgb(${r},${g},${b})`;
    } else {
      // 0 → -1 : amber #f59e0b → rose #f43f5e → crimson
      const u = -t;
      const r = Math.round(245 - (245 - 180) * u);
      const g = Math.round(158 - (158 - 20)  * u);
      const b = Math.round(11  + (60  - 11)  * u);
      return `rgb(${r},${g},${b})`;
    }
  };

  // ── SVG radial chart ─────────────────────────────────────────
  const N        = tickers.length;
  const nRings   = periods.length;
  const W        = 820;
  const cx       = W / 2;
  const cy       = W / 2;
  const innerR   = 110;
  const outerR   = 340;
  const ringW    = (outerR - innerR) / nRings;
  const gap      = 0.022; // radians gap between segments

  const anglePerTick  = (2 * Math.PI) / N;
  const startOffset   = -Math.PI / 2; // 12 o'clock

  const polarToXY = (angle, r) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });

  const arcPath = (startAngle, endAngle, r1, r2) => {
    const s1 = polarToXY(startAngle, r1);
    const e1 = polarToXY(endAngle,   r1);
    const s2 = polarToXY(startAngle, r2);
    const e2 = polarToXY(endAngle,   r2);
    const large = (endAngle - startAngle) > Math.PI ? 1 : 0;
    return [
      `M ${s1.x} ${s1.y}`,
      `A ${r1} ${r1} 0 ${large} 1 ${e1.x} ${e1.y}`,
      `L ${e2.x} ${e2.y}`,
      `A ${r2} ${r2} 0 ${large} 0 ${s2.x} ${s2.y}`,
      'Z'
    ].join(' ');
  };

  // per-ring max abs for colour scaling
  const ringMaxAbs = periods.map(p => {
    if (!p.refMap) {
      return Math.max(...tickers.map(t => Math.abs(curMap[t]?.ppl || 0)), 0.01);
    }
    return Math.max(...tickers.map(t => Math.abs(delta(t, p.refMap))), 0.01);
  });

  let paths = '';
  let labels = '';

  // data-* attributes the tooltip reads: symbol, full name, flag, note, and the value line
  const tipAttrs = (ticker, sym, line) => {
    const info = exposure[ticker] || {};
    return `data-sym="${_hmEsc(sym)}" data-name="${_hmEsc(info.display_name || '')}" data-flag="${_hmEsc(info.flag || '')}" data-note="${_hmEsc(info.exposure || '')}" data-line="${_hmEsc(line)}"`;
  };

  tickers.forEach((ticker, ti) => {
    const aStart = startOffset + ti * anglePerTick + gap;
    const aEnd   = startOffset + (ti + 1) * anglePerTick - gap;
    const aMid   = (aStart + aEnd) / 2;
    const p0  = curMap[ticker];
    const sym0 = (p0.display || ticker).replace(/_EQ$/, '');

    periods.forEach((period, ri) => {
      const r1 = innerR + ri * ringW;
      const r2 = r1 + ringW - 1;
      const val = period.refMap
        ? delta(ticker, period.refMap)
        : (curMap[ticker]?.ppl || 0);
      const col = period.hasRef ? pplColor(val, ringMaxAbs[ri]) : '#1e2a3a';
      const path = arcPath(aStart, aEnd, r1, r2);
      const line = `${period.label}: ${val >= 0 ? '+' : ''}£${val.toFixed(2)}${period.refMap ? ' Δ' : ''}`;
      paths += `<path d="${path}" fill="${col}" stroke="#0f1117" stroke-width="0.8" ${tipAttrs(ticker, sym0, line)} class="rad-seg" data-ri="${ri}"/>`;
    });

    // ticker label at outer edge — always reads outward, never flipped
    const labelR = outerR + 26;
    const lp = polarToXY(aMid, labelR);
    // rotate so baseline points away from centre; right half normal, left half +180 with flipped anchor
    const leftHalf = aMid > Math.PI / 2 && aMid < 3 * Math.PI / 2;
    const baseDeg  = aMid * 180 / Math.PI - 90; // -90 so text runs tangentially outward
    const rotDeg   = leftHalf ? baseDeg + 180 : baseDeg;
    const anchor   = leftHalf ? 'end' : 'start';
    const p = curMap[ticker];
    const sym = (p.display || ticker).replace(/_EQ$/, '');
    const gainPct = p.gain_pct != null ? (p.gain_pct >= 0 ? '+' : '') + p.gain_pct.toFixed(1) + '%' : '';
    const labelColor = p.gain_pct >= 0 ? '#34d399' : '#f87171';
    const lblTip = tipAttrs(ticker, sym, `All-time gain: ${gainPct || 'n/a'}`);
    labels += `<text x="${lp.x}" y="${lp.y}" font-size="13" font-weight="700" fill="#e2e8f0" text-anchor="${anchor}" dominant-baseline="middle"
      transform="rotate(${rotDeg}, ${lp.x}, ${lp.y})" dy="-5" class="rad-lbl" style="cursor:pointer" ${lblTip}>${_hmEsc(sym)}</text>`;
    labels += `<text x="${lp.x}" y="${lp.y}" font-size="11" fill="${labelColor}" text-anchor="${anchor}" dominant-baseline="middle"
      transform="rotate(${rotDeg}, ${lp.x}, ${lp.y})" dy="9" class="rad-lbl" style="cursor:pointer" ${lblTip}>${gainPct}</text>`;
  });

  // ring labels — on left spine at each ring midpoint
  let ringLabels = '';
  periods.forEach((p, ri) => {
    const r = innerR + ri * ringW + ringW / 2;
    const lx = cx - r * Math.cos(Math.PI * 0.18);
    const ly = cy - r * Math.sin(Math.PI * 0.18);
    ringLabels += `<text x="${lx}" y="${ly}" font-size="10" font-weight="600" fill="#64748b" text-anchor="middle" dominant-baseline="middle">${p.label}</text>`;
  });

  // centre label
  const snapLabel = now.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  document.getElementById('heatmap-updated').textContent = `· ${snapLabel}`;

  const legend = `<defs>
      <linearGradient id="legGrad" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%"   stop-color="#b91c1c"/>
        <stop offset="40%"  stop-color="#f59e0b"/>
        <stop offset="60%"  stop-color="#06b6d4"/>
        <stop offset="100%" stop-color="#84cc16"/>
      </linearGradient>
    </defs>`;

  const svgH = W + 20;
  wrap.innerHTML = `
    <div style="position:relative;width:100%;max-width:860px;margin:0 auto">
      <svg id="radial-svg" viewBox="0 0 ${W} ${svgH}" width="100%" style="display:block">
        ${legend}
        ${paths}
        ${labels}
        ${ringLabels}
        <circle cx="${cx}" cy="${cy}" r="${innerR - 2}" fill="#0d1117"/>
        <text x="${cx}" y="${cy - 16}" font-size="17" font-weight="800" fill="#e2e8f0" text-anchor="middle">Portfolio</text>
        <text x="${cx}" y="${cy + 6}"  font-size="13" fill="#8892a4" text-anchor="middle">P&amp;L Rings</text>
        <text x="${cx}" y="${cy + 24}" font-size="11" fill="#475569" text-anchor="middle">${N} positions</text>
      </svg>
      <!-- horizontal legend below chart -->
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#f87171;font-weight:600">Loss</span>
        <div style="width:180px;height:10px;border-radius:5px;background:linear-gradient(to right,#b91c1c,#f59e0b,#06b6d4,#84cc16)"></div>
        <span style="font-size:11px;color:#34d399;font-weight:600">Gain</span>
      </div>
      <div id="rad-tooltip" style="
        position:absolute;pointer-events:none;display:none;
        background:#1a1d27;border:1px solid #2d3353;border-radius:6px;
        padding:6px 10px;font-size:12px;color:#e2e8f0;max-width:260px;z-index:10;line-height:1.35
      "></div>
    </div>
    <div class="dd-ranges" id="rad-periods" style="justify-content:center;flex:0 0 100%;width:100%;flex-wrap:wrap;margin:12px 0 6px"></div>
    <div id="rad-detail" style="font-size:12px;flex:0 0 100%;width:100%"></div>
  `;

  // ── period buttons: focus one ring + ranked movers for that period ──
  const fmtD = v => `${v >= 0 ? '+' : '−'}£${Math.abs(v).toFixed(2)}`;
  const valFor = (period, t) => period.refMap ? delta(t, period.refMap) : (curMap[t]?.ppl || 0);
  const symOf = t => (curMap[t].display || t).replace(/_EQ$/, '');
  const spanTxt = pd => {
    if (pd.target === 0) return 'since you bought';
    if (!pd.snap) return 'no data yet';
    const d = pd.span;
    const short = d < pd.target * 0.7;
    return short ? `${d < 1 ? Math.max(1, Math.round(d * 24)) + 'h' : Math.round(d) + 'd'} of data so far` : `last ${pd.target === 1 ? 'day' : pd.target + ' days'}`;
  };
  let focus = -1;
  const drawPeriods = () => {
    const box = document.getElementById('rad-periods'); if (!box) return;
    box.innerHTML = periods.map((pd, i) => {
      const tot = pd.hasRef ? tickers.reduce((a, t) => a + valFor(pd, t), 0) : null;
      return `<button data-pi="${i}" class="${focus === i ? 'active' : ''}" style="display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 12px">
        <span>${pd.label}</span>
        <span style="font-size:12px;font-weight:700;color:${tot == null ? '#64748b' : tot >= 0 ? '#34d399' : '#f87171'}">${tot == null ? '—' : fmtD(tot)}</span>
        <span style="font-size:9px;opacity:.7">${spanTxt(pd)}</span></button>`;
    }).join('');
    document.querySelectorAll('#radial-svg .rad-seg').forEach(sg => { sg.style.opacity = focus < 0 || +sg.dataset.ri === focus ? '1' : '0.18'; });
    const det = document.getElementById('rad-detail'); if (!det) return;
    if (focus < 0) { det.innerHTML = '<div style="text-align:center;color:#64748b;padding:4px">Tap a period to focus its ring and see which holdings moved most.</div>'; return; }
    const pd = periods[focus];
    const rows = tickers.map(t => ({ t, sym: symOf(t), v: valFor(pd, t) })).sort((a, b) => b.v - a.v);
    const chip = r => `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid #1e2740"><span style="font-weight:700;color:#a5b4fc">${_hmEsc(r.sym)}</span><span style="color:${r.v >= 0 ? '#34d399' : '#f87171'}">${fmtD(r.v)}</span></div>`;
    const up = rows.filter(r => r.v > 0).slice(0, 5), down = rows.filter(r => r.v < 0).slice(-5).reverse();
    det.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;max-width:560px;margin:6px auto 0">
      <div><div style="color:#34d399;font-weight:700;margin-bottom:4px">Top gainers · ${pd.label}</div>${up.map(chip).join('') || '<div style="color:#64748b">None</div>'}</div>
      <div><div style="color:#f87171;font-weight:700;margin-bottom:4px">Top losers · ${pd.label}</div>${down.map(chip).join('') || '<div style="color:#64748b">None</div>'}</div></div>`;
  };
  document.getElementById('rad-periods').onclick = e => {
    const b = e.target.closest('button[data-pi]'); if (!b) return;
    focus = focus === +b.dataset.pi ? -1 : +b.dataset.pi; drawPeriods();
  };
  drawPeriods();

  // tooltip interaction — hover on desktop, tap on phone. Hovering a bubble or a ticker label
  // shows: flag + full name, then symbol · what it is, then the value for that ring.
  const svg   = document.getElementById('radial-svg');
  const tip   = document.getElementById('rad-tooltip');
  const box   = svg.parentElement;
  const fillTip = (ds) => {
    tip.textContent = '';
    const head = document.createElement('div');
    head.style.fontWeight = '700';
    head.textContent = (ds.flag ? ds.flag + ' ' : '') + (ds.name || ds.sym);
    tip.appendChild(head);
    if (ds.name) {
      const sub = document.createElement('div');
      sub.style.cssText = 'color:#8892a4;font-size:11px';
      sub.textContent = ds.sym + (ds.note ? ' · ' + ds.note : '');
      tip.appendChild(sub);
    }
    const val = document.createElement('div');
    val.textContent = ds.line;
    tip.appendChild(val);
  };
  const placeTip = (e) => {
    const rect = box.getBoundingClientRect();
    let left = e.clientX - rect.left + 12;
    let top  = e.clientY - rect.top  - 10;
    left = Math.max(0, Math.min(left, rect.width - tip.offsetWidth - 4));
    top  = Math.max(0, top);
    tip.style.left = left + 'px';
    tip.style.top  = top + 'px';
  };
  svg.querySelectorAll('.rad-seg, .rad-lbl').forEach(el => {
    const isSeg = el.classList.contains('rad-seg');
    const show = (e) => {
      fillTip(el.dataset);
      tip.style.display = 'block';
      if (isSeg) el.setAttribute('opacity', '0.75');
      placeTip(e);
    };
    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', placeTip);
    el.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      if (isSeg) el.setAttribute('opacity', '1');
    });
    // tap (phones have no hover): show on tap, hide when tapping anywhere else
    el.addEventListener('click', (e) => { e.stopPropagation(); show(e); });
  });
  document.addEventListener('click', (e) => {
    if (!svg.contains(e.target)) tip.style.display = 'none';
  });
}
