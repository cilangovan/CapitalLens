// ── HEATMAP ───────────────────────────────────────────────────
async function loadHeatmap() {
  if (IS_GUEST) {
    document.getElementById('heatmap-grid').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view heatmap</div>';
    return;
  }
  const snap = (await api('portfolio_snapshots','?select=*&order=created_at.desc&limit=1'))[0];
  if (!snap) return;
  const positions = await api('positions', `?snapshot_id=eq.${snap.id}&select=*`);

  const minPpl = Math.min(...positions.map(p => p.ppl||0));
  const maxPpl = Math.max(...positions.map(p => p.ppl||0));
  const range = maxPpl - minPpl || 1;

  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = '';

  const snapDate = new Date(snap.created_at);
  const snapLabel = snapDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  document.getElementById('heatmap-updated').textContent = `· data as of ${snapLabel}`;

  positions.forEach(p => {
    const gain = p.gain_pct || 0;
    const ppl = p.ppl || 0;
    const size = 60 + Math.abs(ppl - minPpl) / range * 80;
    const alpha = Math.min(0.9, 0.3 + Math.abs(gain) / 40);
    const bg = gain >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`;
    const tile = document.createElement('div');
    tile.className = 'hm-tile';
    tile.style.cssText = `width:${size}px;height:${size}px;background:${bg};`;
    const tooltipPpl = IS_GUEST ? '***' : fmtGbpPlain(ppl);
    tile.title = `${p.display||p.ticker} | Gain: ${fmt(gain)}% | P&L: ${tooltipPpl} | Dip: ${fmt(p.dip_from_high)}%`;
    tile.innerHTML = `<span class="hm-tick">${p.ticker||''}</span><span class="hm-pct">${fmt(gain,1)}%</span>`;
    grid.appendChild(tile);
  });
}
