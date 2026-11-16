// ── BUBBLE CHART (replaces heatmap) ───────────────────────────

async function loadHeatmap() {
  const wrap = document.getElementById('heatmap-grid');
  if (IS_GUEST) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view P&L bubbles</div>';
    return;
  }

  // ── fetch snapshots ──────────────────────────────────────────
  const snaps = await api('portfolio_snapshots','?select=id,created_at&order=created_at.desc&limit=60');
  if (!snaps.length) { wrap.innerHTML = '<div class="loading">No snapshot data yet.</div>'; return; }

  const now      = new Date(snaps[0].created_at);
  const snapId   = snaps[0].id;

  const findSnap = (daysAgo) => {
    const target = now - daysAgo * 86400000;
    return snaps.slice(1).reduce((best, s) => {
      const d = Math.abs(new Date(s.created_at) - target);
      return d < Math.abs(new Date(best.created_at) - target) ? s : best;
    }, snaps[snaps.length - 1]);
  };

  const daySnap   = snaps.length > 1 ? findSnap(1)  : null;
  const weekSnap  = snaps.length > 1 ? findSnap(7)  : null;
  const monthSnap = snaps.length > 1 ? findSnap(30) : null;

  // ── fetch positions ──────────────────────────────────────────
  const cur = await api('positions', `?snapshot_id=eq.${snapId}&select=ticker,display,pie,ppl,gain_pct`);

  const posMap = (rows) => {
    const m = {};
    rows.forEach(r => { m[r.ticker] = r; });
    return m;
  };

  const fetchSnap = async (s) => {
    if (!s) return {};
    const rows = await api('positions', `?snapshot_id=eq.${s.id}&select=ticker,ppl`).catch(() => []);
    return posMap(rows);
  };

  const [dayMap, weekMap, monthMap] = await Promise.all([
    fetchSnap(daySnap),
    fetchSnap(weekSnap),
    fetchSnap(monthSnap),
  ]);

  const curMap = posMap(cur);

  // ── build delta ppl per period ───────────────────────────────
  const delta = (ticker, refMap) => {
    const c = curMap[ticker]?.ppl ?? 0;
    const r = refMap[ticker]?.ppl ?? c; // if no ref, delta = 0
    return c - r;
  };

  // ── render ───────────────────────────────────────────────────
  const snapLabel = now.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('heatmap-updated').textContent = `· as of ${snapLabel}`;

  const periods = [
    { id: 'bubble-daily',   label: '📅 Daily P&L',   refMap: dayMap,   refSnap: daySnap,   days: 1  },
    { id: 'bubble-weekly',  label: '📆 Weekly P&L',  refMap: weekMap,  refSnap: weekSnap,  days: 7  },
    { id: 'bubble-monthly', label: '🗓️ Monthly P&L', refMap: monthMap, refSnap: monthSnap, days: 30 },
  ];

  wrap.innerHTML = periods.map(p => `
    <div style="margin-bottom:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">${p.label}</div>
        <div style="font-size:11px;color:var(--muted)">${p.refSnap ? 'vs ' + new Date(p.refSnap.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : 'baseline snapshot only'}</div>
      </div>
      <div style="position:relative;height:260px"><canvas id="${p.id}"></canvas></div>
    </div>
  `).join('');

  // ── draw each bubble chart ───────────────────────────────────
  periods.forEach(({ id, refMap, refSnap }) => {
    const tickers = cur.map(p => p.ticker);

    const deltas = tickers.map(t => delta(t, refMap));
    const maxAbs = Math.max(...deltas.map(Math.abs), 0.01);

    // bubble radius: 4–28 scaled to max delta
    const r = (v) => 4 + Math.abs(v) / maxAbs * 24;

    // x = gain_pct (spread left/right), y = random jitter for readability
    const seed = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h; };

    const datasets = tickers.map((t, i) => {
      const d = deltas[i];
      const p = curMap[t];
      const gainPct = p?.gain_pct ?? 0;
      const yJitter = ((seed(t) % 100) / 100) * 60 + 20; // 20–80

      return {
        label: p?.display || t,
        data: [{ x: gainPct, y: yJitter, r: r(d) }],
        backgroundColor: d >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)',
        borderColor:     d >= 0 ? '#22c55e' : '#ef4444',
        borderWidth: 1,
      };
    });

    // filter out zero-delta tickers if reference exists
    const hasRef = !!refSnap && Object.keys(refMap).length > 0;

    const ctx = document.getElementById(id).getContext('2d');
    new Chart(ctx, {
      type: 'bubble',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 10, bottom: 10 } },
        scales: {
          x: {
            title: { display: true, text: 'All-time gain %', color: '#8892a4', font: { size: 10 } },
            ticks: { color: '#8892a4', font: { size: 10 } },
            grid: { color: '#2d3353' },
          },
          y: {
            display: false,
            min: 0, max: 100,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const t = ctx.dataset.label;
                const d = deltas[tickers.indexOf(t.includes('_') ? t : (cur.find(p => (p.display||p.ticker) === t)?.ticker || t))];
                const gainPct = curMap[t]?.gain_pct ?? curMap[cur.find(p=>(p.display||p.ticker)===t)?.ticker]?.gain_pct ?? 0;
                const dStr = hasRef ? ` | Δ ${d >= 0 ? '+' : ''}£${d.toFixed(2)}` : ' | (no prior data)';
                return `${t} | ${gainPct.toFixed(1)}% gain${dStr}`;
              },
            },
          },
        },
      },
    });
  });
}
