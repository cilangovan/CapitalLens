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

  const [curRows, dayMap, weekMap, monthMap] = await Promise.all([
    api('positions', `?snapshot_id=eq.${latest.id}&select=ticker,display,pie,ppl,gain_pct`),
    fetchPos(daySnap),
    fetchPos(weekSnap),
    fetchPos(monthSnap),
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
    { label: 'Monthly',  refMap: monthMap, hasRef: !!monthSnap },
    { label: 'Weekly',   refMap: weekMap,  hasRef: !!weekSnap  },
    { label: 'Daily',    refMap: dayMap,   hasRef: !!daySnap   },
    { label: 'All-time', refMap: null,     hasRef: true        },
  ];

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
  let tooltipData = [];

  tickers.forEach((ticker, ti) => {
    const aStart = startOffset + ti * anglePerTick + gap;
    const aEnd   = startOffset + (ti + 1) * anglePerTick - gap;
    const aMid   = (aStart + aEnd) / 2;

    periods.forEach((period, ri) => {
      const r1 = innerR + ri * ringW;
      const r2 = r1 + ringW - 1;
      const val = period.refMap
        ? delta(ticker, period.refMap)
        : (curMap[ticker]?.ppl || 0);
      const col = period.hasRef ? pplColor(val, ringMaxAbs[ri]) : '#1e2a3a';
      const path = arcPath(aStart, aEnd, r1, r2);
      const p = curMap[ticker];
      const tooltipStr = `${p.display||ticker} | ${period.label}: ${val >= 0 ? '+' : ''}£${val.toFixed(2)}${period.refMap ? ' Δ' : ''}`;
      paths += `<path d="${path}" fill="${col}" stroke="#0f1117" stroke-width="0.8" data-tip="${tooltipStr}" class="rad-seg"/>`;
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
    labels += `<text x="${lp.x}" y="${lp.y}" font-size="13" font-weight="700" fill="#e2e8f0" text-anchor="${anchor}" dominant-baseline="middle"
      transform="rotate(${rotDeg}, ${lp.x}, ${lp.y})" dy="-5">${sym}</text>`;
    labels += `<text x="${lp.x}" y="${lp.y}" font-size="11" fill="${labelColor}" text-anchor="${anchor}" dominant-baseline="middle"
      transform="rotate(${rotDeg}, ${lp.x}, ${lp.y})" dy="9">${gainPct}</text>`;
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

  // legend
  const legend = `
    <defs>
      <linearGradient id="legGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%"   stop-color="#84cc16"/>
        <stop offset="40%"  stop-color="#06b6d4"/>
        <stop offset="60%"  stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#b91c1c"/>
      </linearGradient>
    </defs>
    <rect x="${W-36}" y="${cy-80}" width="14" height="160" fill="url(#legGrad)" rx="4"/>
    <text x="${W-16}" y="${cy-80}" font-size="10" fill="#34d399" dominant-baseline="middle">Gain</text>
    <text x="${W-16}" y="${cy}"    font-size="10" fill="#94a3b8" dominant-baseline="middle">Flat</text>
    <text x="${W-16}" y="${cy+80}" font-size="10" fill="#f87171" dominant-baseline="middle">Loss</text>
  `;

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
      <div id="rad-tooltip" style="
        position:absolute;pointer-events:none;display:none;
        background:#1a1d27;border:1px solid #2d3353;border-radius:6px;
        padding:6px 10px;font-size:12px;color:#e2e8f0;white-space:nowrap;z-index:10
      "></div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:11px;color:#475569">
      ${periods.map(p => `<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#334155;border-radius:2px"></span>${p.label}${!p.hasRef?' (no prior data)':''}</span>`).join('')}
    </div>
  `;

  // tooltip interaction
  const svg   = document.getElementById('radial-svg');
  const tip   = document.getElementById('rad-tooltip');
  const segs  = svg.querySelectorAll('.rad-seg');
  segs.forEach(seg => {
    seg.addEventListener('mouseenter', (e) => {
      tip.textContent = seg.dataset.tip;
      tip.style.display = 'block';
      seg.setAttribute('opacity', '0.75');
    });
    seg.addEventListener('mousemove', (e) => {
      const rect = svg.parentElement.getBoundingClientRect();
      tip.style.left = (e.clientX - rect.left + 12) + 'px';
      tip.style.top  = (e.clientY - rect.top  - 10) + 'px';
    });
    seg.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      seg.setAttribute('opacity', '1');
    });
  });
}
