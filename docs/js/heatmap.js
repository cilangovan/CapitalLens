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

  // colour: red → yellow → green mapped to -1…0…+1
  const pplColor = (val, maxAbs) => {
    if (maxAbs === 0) return '#334155';
    const t = Math.max(-1, Math.min(1, val / maxAbs));
    if (t >= 0) {
      // 0→green: yellow→lime→green
      const r = Math.round(255 * (1 - t));
      const g = Math.round(200 + 55 * t);
      return `rgb(${r},${g},60)`;
    } else {
      // 0→red
      const r = Math.round(220 + 35 * (-t));
      const g = Math.round(80 * (1 + t));
      return `rgb(${r},${g},60)`;
    }
  };

  // ── SVG radial chart ─────────────────────────────────────────
  const N        = tickers.length;
  const nRings   = periods.length;
  const W        = 540;
  const cx       = W / 2;
  const cy       = W / 2;
  const innerR   = 70;
  const outerR   = 240;
  const ringW    = (outerR - innerR) / nRings;
  const gap      = 0.018; // radians gap between segments

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

    // ticker label at outer edge
    const labelR = outerR + 14;
    const lp = polarToXY(aMid, labelR);
    const deg = (aMid * 180 / Math.PI) + 90;
    const flip = aMid > Math.PI / 2 && aMid < 3 * Math.PI / 2;
    const p = curMap[ticker];
    const sym = (p.display || ticker).replace(/_EQ$/, '');
    labels += `<text x="${lp.x}" y="${lp.y}" font-size="8" fill="#8892a4" text-anchor="middle" dominant-baseline="middle"
      transform="rotate(${flip ? deg + 180 : deg}, ${lp.x}, ${lp.y})">${sym}</text>`;
  });

  // ring labels (inside inner circle or alongside)
  let ringLabels = '';
  periods.forEach((p, ri) => {
    const r = innerR + ri * ringW + ringW / 2;
    ringLabels += `<text x="${cx}" y="${cy - r}" font-size="7.5" fill="#475569" text-anchor="middle" dominant-baseline="middle">${p.label}</text>`;
  });

  // centre label
  const snapLabel = now.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  document.getElementById('heatmap-updated').textContent = `· ${snapLabel}`;

  // legend
  const legend = `
    <defs>
      <linearGradient id="legGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%"   stop-color="rgb(60,200,60)"/>
        <stop offset="50%"  stop-color="rgb(255,220,0)"/>
        <stop offset="100%" stop-color="rgb(220,40,40)"/>
      </linearGradient>
    </defs>
    <rect x="${W-28}" y="${cy-60}" width="10" height="120" fill="url(#legGrad)" rx="3"/>
    <text x="${W-14}" y="${cy-60}" font-size="8" fill="#8892a4" dominant-baseline="middle">+</text>
    <text x="${W-14}" y="${cy}"    font-size="8" fill="#8892a4" dominant-baseline="middle">0</text>
    <text x="${W-14}" y="${cy+60}" font-size="8" fill="#8892a4" dominant-baseline="middle">−</text>
    <text x="${W-16}" y="${cy+80}" font-size="7" fill="#475569" text-anchor="middle">P&amp;L</text>
  `;

  const svgH = W + 20;
  wrap.innerHTML = `
    <div style="position:relative;width:100%;max-width:560px;margin:0 auto">
      <svg id="radial-svg" viewBox="0 0 ${W} ${svgH}" width="100%" style="display:block">
        ${legend}
        ${paths}
        ${labels}
        ${ringLabels}
        <circle cx="${cx}" cy="${cy}" r="${innerR - 2}" fill="#0f1117"/>
        <text x="${cx}" y="${cy - 10}" font-size="13" font-weight="700" fill="#e2e8f0" text-anchor="middle">Portfolio</text>
        <text x="${cx}" y="${cy + 8}"  font-size="10" fill="#8892a4" text-anchor="middle">P&amp;L Rings</text>
        <text x="${cx}" y="${cy + 22}" font-size="8"  fill="#475569" text-anchor="middle">${N} positions</text>
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
