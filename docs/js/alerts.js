// ── ALERTS LOG ────────────────────────────────────────────────
async function loadAlerts() {
  if (IS_GUEST) {
    document.getElementById('alerts-log').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:16px 0">🔒 Sign in to view alerts</div>';
    return;
  }
  const alerts = await api('alerts','?select=*&order=created_at.desc&limit=100');
  const el = document.getElementById('alerts-log');
  if (!alerts.length) { el.innerHTML = '<div class="loading">No alerts yet.</div>'; return; }
  el.innerHTML = alerts.map(a => {
    const type = a.alert_type || a.type || 'info';
    const t = a.title || '';
    let cls = type === 'buy' ? 'buy' : (type === 'sell' || type === 'trim') ? 'sell' : '';
    if (type === 'report') cls = t.startsWith('✅') ? 'buy' : t.startsWith('❔') ? 'muted' : '';
    const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const structured = /\nMeasure\s/.test('\n' + (a.body||'')) || type === 'report';
    return `<div class="alert-item ${cls}">
      <div class="a-title">${esc(t)}</div>
      <div class="a-body${structured ? ' a-report' : ''}">${esc(a.body)}</div>
      <div class="a-time">${a.created_at ? new Date(a.created_at).toLocaleString('en-GB') : ''} · ${type}</div>
    </div>`;
  }).join('');
}
