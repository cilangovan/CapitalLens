// "Refresh data" panel: runs the whole pipeline (sync -> snapshot -> analyses -> alert report + push) in this browser.
// Trading 212 credentials are used for this run only: they are never stored, and the fields are cleared afterwards.
function zkToolsOpen() { document.getElementById('zk-tools').style.display = 'flex'; }
function zkToolsClose() { document.getElementById('zk-tools').style.display = 'none'; }
async function zkToolsSaveTopic() {
  const v = document.getElementById('zk-topic').value.trim(), msg = document.getElementById('zk-topic-msg');
  try { await ZKNotify.saveTopic(ZKCTX.store, v); msg.textContent = 'Saved (encrypted). Phone alerts on.'; document.getElementById('zk-topic').value = ''; } catch (e) { msg.textContent = e.message; }
}
async function zkToolsRun() {
  if (!ZKCTX) return;
  const key = document.getElementById('zk-key').value.trim(), sec = document.getElementById('zk-sec').value.trim(), full = document.getElementById('zk-full').checked;
  const logEl = document.getElementById('zk-log'), btn = document.getElementById('zk-run'), status = document.getElementById('zk-status');
  logEl.textContent = ''; btn.disabled = true; status.textContent = 'Working…';
  const log = m => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  try {
    const p = ZKPipeline.create({ store: ZKCTX.store, market: ZKCTX.market, call: ZKCTX.call, token: ZKCTX.token, relayUrl: RELAY_URL, log });
    const r = await p.run(key, sec, { full });
    status.textContent = r.ok ? 'Done — everything refreshed.' : 'Finished with problems: ' + r.results.filter(x => !x.ok).map(x => x.name).join(', ');
  } catch (e) { status.textContent = 'Failed: ' + (e.message || e); }
  document.getElementById('zk-key').value = ''; document.getElementById('zk-sec').value = ''; btn.disabled = false;
  try { _cache = {}; } catch (e) {}
  const active = document.querySelector('.tab.active'); if (active && typeof loadTab === 'function') loadTab(active.id);
  if (typeof loadTab === 'function') loadTab('alerts');
}
