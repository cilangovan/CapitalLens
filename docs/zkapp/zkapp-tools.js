// "Refresh data" panel: runs the whole pipeline (sync -> snapshot -> analyses -> alert report + push) in this browser.
// Trading 212 credentials are used for this run only: they are never stored, and the fields are cleared afterwards.
function zkToolsOpen() { document.getElementById('zk-tools').style.display = 'flex'; const c = document.getElementById('zk-chip'); if (c) c.style.display = 'none'; }
var ZK_RUN = { running: false, started: 0, last: '', timer: null };
function zkChip() {            // small progress chip: the refresh keeps running while the panel is hidden and you use the dashboard
  let c = document.getElementById('zk-chip');
  if (!c) {
    c = document.createElement('div'); c.id = 'zk-chip';
    c.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:40;max-width:340px;background:var(--card,#161b22);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--text);cursor:pointer;box-shadow:0 4px 18px #0006;display:none';
    c.onclick = zkToolsOpen; document.body.appendChild(c);
  }
  return c;
}
function zkChipUpdate(done, msg) {
  const c = zkChip(), panelOpen = document.getElementById('zk-tools').style.display === 'flex';
  if (panelOpen && !done) { c.style.display = 'none'; return; }
  const secs = Math.round((Date.now() - ZK_RUN.started) / 1000), t = Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  c.textContent = done ? (msg || 'Refresh finished') + ' (click for details)' : '🔄 Refreshing… ' + t + ' · ' + (ZK_RUN.last || 'starting') + ' — click for details';
  c.style.display = 'block';
}
function zkToolsClose() { document.getElementById('zk-tools').style.display = 'none'; if (ZK_RUN.running) zkChipUpdate(false); }
async function zkToolsSaveTopic() {
  const v = document.getElementById('zk-topic').value.trim(), msg = document.getElementById('zk-topic-msg');
  try { await ZKNotify.saveTopic(ZKCTX.store, v); msg.textContent = 'Saved (encrypted). Phone alerts on.'; document.getElementById('zk-topic').value = ''; } catch (e) { msg.textContent = e.message; }
}
async function zkToolsRun() {
  if (!ZKCTX) return;
  const key = document.getElementById('zk-key').value.trim(), sec = document.getElementById('zk-sec').value.trim(), full = document.getElementById('zk-full').checked;
  const logEl = document.getElementById('zk-log'), btn = document.getElementById('zk-run'), status = document.getElementById('zk-status');
  logEl.textContent = ''; btn.disabled = true; status.textContent = 'Working…';
  ZK_RUN.running = true; ZK_RUN.started = Date.now(); ZK_RUN.last = '';
  document.getElementById('zk-run').textContent = 'Running…';
  const closeBtn = document.querySelector('#zk-tools button[onclick^=zkToolsClose]'); if (closeBtn) closeBtn.textContent = 'Hide (keeps running)';
  const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', beforeUnload);
  ZK_RUN.timer = setInterval(() => zkChipUpdate(false), 1000);
  const log = m => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; if (String(m).trim()) ZK_RUN.last = String(m).trim().slice(0, 70); };
  try {
    const p = ZKPipeline.create({ store: ZKCTX.store, market: ZKCTX.market, call: ZKCTX.call, token: ZKCTX.token, relayUrl: RELAY_URL, log });
    const r = await p.run(key, sec, { full });
    status.textContent = r.ok ? 'Done — everything refreshed.' : 'Finished with problems: ' + r.results.filter(x => !x.ok).map(x => x.name).join(', ');
  } catch (e) { status.textContent = 'Failed: ' + (e.message || e); }
  ZK_RUN.running = false; clearInterval(ZK_RUN.timer); window.removeEventListener('beforeunload', beforeUnload);
  document.getElementById('zk-key').value = ''; document.getElementById('zk-sec').value = ''; btn.disabled = false; btn.textContent = 'Refresh now';
  if (closeBtn) closeBtn.textContent = 'Close';
  if (document.getElementById('zk-tools').style.display !== 'flex') zkChipUpdate(true, '✅ ' + status.textContent); else zkChip().style.display = 'none';
  try { _cache = {}; } catch (e) {}
  const active = document.querySelector('.tab.active'); if (active && typeof loadTab === 'function') loadTab(active.id);
  if (typeof loadTab === 'function') loadTab('alerts');
}
