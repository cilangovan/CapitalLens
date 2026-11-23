// ── ROUTER ────────────────────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  loadTab(id);
  if (id === 'alerts' && typeof alertsShown === 'function') alertsShown();   // start the market-signal scan only once the tab is really open
}

const loaders = {
  overview:  loadOverview,
  heatmap:   loadHeatmap,
  positions: loadPositions,
  analyst:   loadAnalyst,
  strategy:  loadStrategy,
  profit:    loadProfit,
  returns:   loadReturns,
  watchlist: async () => { if (typeof loadIpo === 'function') loadIpo().catch(() => {}); await loadWatchlist(); },
  alerts:    loadAlerts,
};
const loaded = {};

function loadTab(id) {
  if (loaded[id]) return;
  loaded[id] = true;
  loaders[id]().catch(e => {
    console.error(id, e);
    const el = document.querySelector(`#${id} .loading`) || document.getElementById(id);
    if (el) el.innerHTML = `<div class="loading" style="color:var(--red)">Error: ${esc(e.message)}</div>`;
  });
}
