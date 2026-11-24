// "Refresh data" panel: runs the whole pipeline (sync -> snapshot -> analyses -> alert report + push) in this browser.
// Trading 212 credentials are used for this run only: they are never stored, and the fields are cleared afterwards.
function zkToolsOpen() { document.getElementById('zk-tools').style.display = 'flex'; const c = document.getElementById('zk-chip'); if (c) c.style.display = 'none'; }
var ZK_RUN = { running: false, started: 0, last: '', timer: null };

// ── LIVE TICKER ───────────────────────────────────────────────────────────────
// Polls T212 account/cash + portfolio every LIVE_INTERVAL_MS while the tab is active.
// Credentials live in session memory only (never encrypted to DB, never persisted):
// _liveKey/_liveSec are cleared on logout via zkLiveStop().
const LIVE_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes (T212 rate limit ~10.5s/req; 2 reqs + margin = ok)
let _liveKey = null, _liveSec = null, _liveTimer = null, _liveTicking = false;

function zkLiveBadge(state, msg) {
  // state: 'live'|'error'|'off'
  let b = document.getElementById('zk-live-badge');
  if (!b) {
    b = document.createElement('div'); b.id = 'zk-live-badge';
    b.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:40;padding:5px 11px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px #0005;display:none';
    b.addEventListener('click', zkToolsOpen); document.body.appendChild(b);
  }
  if (state === 'off') { b.style.display = 'none'; return; }
  b.style.background = state === 'live' ? 'rgba(34,197,94,.18)' : 'rgba(239,68,68,.18)';
  b.style.color = state === 'live' ? 'var(--green)' : 'var(--red)';
  b.style.border = state === 'live' ? '1px solid rgba(34,197,94,.4)' : '1px solid rgba(239,68,68,.4)';
  b.textContent = state === 'live' ? '🟢 LIVE · ' + msg : '🔴 ' + msg;
  b.style.display = 'block';
}

async function zkLiveTick() {
  if (!ZKCTX || !_liveKey || !_liveSec || _liveTicking) return;
  _liveTicking = true;
  try {
    const client = ZKT212.client({ relayUrl: RELAY_URL });
    client.setCreds(_liveKey, _liveSec);
    const [account, positions] = await Promise.all([
      client.get('/api/v0/equity/account/cash', { after: 500 }),
      client.get('/api/v0/equity/portfolio', { after: 500 }),
    ]);
    client.clear();
    // Parse the live numbers
    const cash = account ? (Number(account.free) || 0) : 0;
    const invested = account ? (Number(account.invested) || 0) : 0;
    const ppl = positions ? positions.reduce((s, p) => s + (Number(p.ppl) || 0), 0) : 0;
    const total = invested + ppl + cash;
    // Update the stats strip headline numbers in-place (without re-rendering the whole overview)
    const tsEl = document.getElementById('live-ts');
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (tsEl) tsEl.textContent = now;
    const liveTotal = document.getElementById('live-total');
    const livePpl = document.getElementById('live-ppl');
    const liveCash = document.getElementById('live-cash');
    const liveInv = document.getElementById('live-invested');
    const fmtGbp = v => '£' + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (liveTotal) liveTotal.textContent = fmtGbp(total);
    if (livePpl) { livePpl.textContent = (ppl >= 0 ? '+' : '−') + fmtGbp(ppl); livePpl.style.color = ppl >= 0 ? 'var(--green)' : 'var(--red)'; }
    if (liveCash) liveCash.textContent = fmtGbp(cash);
    if (liveInv) liveInv.textContent = fmtGbp(invested);
    // Show/update the live strip if the overview hasn't rendered the live IDs yet — inject a mini live strip
    if (!liveTotal) zkLiveInjectStrip({ total, ppl, cash, invested, now });
    zkLiveBadge('live', now);
  } catch (e) {
    zkLiveBadge('error', (e.message || 'T212 error').slice(0, 40));
  } finally { _liveTicking = false; }
}

function zkLiveInjectStrip(d) {
  // If the overview hasn't loaded (or overview doesn't have live-* ids), inject a minimal live strip at the top of the page
  let strip = document.getElementById('zk-live-strip');
  const fmtGbp = v => '£' + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pplSign = d.ppl >= 0 ? '+' : '−';
  if (!strip) {
    strip = document.createElement('div'); strip.id = 'zk-live-strip';
    strip.style.cssText = 'background:var(--bg2);border-bottom:1px solid var(--border);padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:13px;position:sticky;top:0;z-index:30';
    const app = document.getElementById('app'); if (app) app.prepend(strip); else return;
  }
  strip.innerHTML = `<span style="color:var(--muted);font-size:11px">🟢 LIVE ${d.now}</span>
    <span><b style="font-size:15px" id="live-total">${fmtGbp(d.total)}</b> <span class="w-dim w-small">total</span></span>
    <span id="live-ppl" style="font-weight:600;color:${d.ppl>=0?'var(--green)':'var(--red)'}">${pplSign}${fmtGbp(d.ppl)}</span>
    <span class="w-dim w-small">cash <span id="live-cash">${fmtGbp(d.cash)}</span></span>
    <span class="w-dim w-small">inv <span id="live-invested">${fmtGbp(d.invested)}</span></span>
    <span style="color:var(--muted);font-size:11px;margin-left:auto" id="live-ts">${d.now}</span>`;
}

function zkLiveStart(key, sec) {
  _liveKey = key; _liveSec = sec;
  if (_liveTimer) clearInterval(_liveTimer);
  zkLiveTick();   // immediate first tick
  _liveTimer = setInterval(zkLiveTick, LIVE_INTERVAL_MS);
  // Update UI state in the Tools panel
  const btn = document.getElementById('zk-live-btn');
  const status = document.getElementById('zk-live-status');
  if (btn) { btn.textContent = '⏹ Stop live feed'; btn.style.display = ''; }
  if (status) status.textContent = 'Live — updating every 5 min';
}

function zkLiveStop() {
  _liveKey = null; _liveSec = null;
  if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
  zkLiveBadge('off');
  const strip = document.getElementById('zk-live-strip'); if (strip) strip.remove();
  const btn = document.getElementById('zk-live-btn');
  const status = document.getElementById('zk-live-status');
  if (btn) { btn.textContent = '⏹ Stop live feed'; btn.style.display = 'none'; }
  if (status) status.textContent = 'Live is off. Press Refresh now (with your key) to turn it on.';
}

function zkLiveToggle() {
  if (_liveKey) { zkLiveStop(); return; }
  const status = document.getElementById('zk-live-status');             // not live: the only way on is Refresh now (one button, one key entry)
  if (status) status.textContent = 'Press Refresh now above with your key: it refreshes and turns live on.';
}
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
function zkToolsHelp() { const h = document.getElementById('zk-help'); h.style.display = h.style.display === 'none' ? 'block' : 'none'; }
function zkToolsMinimize() {
  document.getElementById('zk-tools').style.display = 'none';
  if (ZK_RUN.running) { zkChipUpdate(false); return; }
  const c = zkChip(); c.textContent = '⚙ Settings (minimised) — click to reopen'; c.style.display = 'block';
}
function zkToolsClose() { document.getElementById('zk-tools').style.display = 'none'; if (ZK_RUN.running) zkChipUpdate(false); }
async function zkToolsSaveTopic() {
  const v = document.getElementById('zk-topic').value.trim(), msg = document.getElementById('zk-topic-msg');
  try { await ZKNotify.saveTopic(ZKCTX.store, v); msg.textContent = 'Saved (encrypted). Phone alerts on.'; document.getElementById('zk-topic').value = ''; } catch (e) { msg.textContent = e.message; }
}
const ZK_ANALYSIS_VERSION = 'lynch-11';      // bump when a release changes what the analysis produces: every browser then re-analyses once on its next login
const ZK_AUTO_MAX_HOURS = 6;
async function zkAutoRefresh() {            // re-analyse stored data (no Trading 212 call, no credentials) after login when stale or after an app update
  if (!ZKCTX || ZK_RUN.running || window.__zkAutoDone) return; window.__zkAutoDone = true;
  let rec = null; try { rec = await ZKCTX.store.get('settings', 'last_analysis'); } catch (e) {}
  const ageH = rec && rec.at ? (Date.now() - new Date(rec.at).getTime()) / 3600000 : Infinity;
  if (rec && rec.version === ZK_ANALYSIS_VERSION && ageH < ZK_AUTO_MAX_HOURS) return;
  setTimeout(() => { if (!ZK_RUN.running) zkToolsRun(true); }, 1500);
}
async function zkToolsRun(auto) {
  if (!ZKCTX) return;
  const key = document.getElementById('zk-key').value.trim(), sec = document.getElementById('zk-sec').value.trim(), full = document.getElementById('zk-full').checked;
  const keepKey = key, keepSec = sec;                                                           // kept in memory ONLY, for the live feed that follows a manual refresh
  const logEl = document.getElementById('zk-log'), btn = document.getElementById('zk-run'), status = document.getElementById('zk-status');
  logEl.textContent = ''; btn.disabled = true; status.textContent = 'Working…'; { const ch = document.getElementById('zk-changes'); if (ch) { ch.textContent = ''; ch.style.display = 'none'; } }
  document.getElementById('zk-key').value = ''; document.getElementById('zk-sec').value = '';      // credentials leave the page the moment they are read
  ZK_RUN.running = true; ZK_RUN.started = Date.now(); ZK_RUN.last = '';
  document.getElementById('zk-run').textContent = 'Running…';
  const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', beforeUnload);
  ZK_RUN.timer = setInterval(() => zkChipUpdate(false), 1000);
  zkToolsClose();                                                                               // minimise straight away: progress shows in the corner chip
  const log = m => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; if (String(m).trim()) ZK_RUN.last = String(m).trim().slice(0, 70); };
  try {
    const p = ZKPipeline.create({ store: ZKCTX.store, market: ZKCTX.market, call: ZKCTX.call, token: ZKCTX.token, relayUrl: RELAY_URL, log, supportLevels: () => ZKMonitor.fetchSupportLevels(ZKCTX.call, ZKCTX.token) });
    const r = await p.run(key, sec, { full });
    if (r.ok) { try { await ZKCTX.store.put('settings', [{ key: 'last_analysis', at: new Date().toISOString(), version: ZK_ANALYSIS_VERSION }], x => x.key); } catch (e) {} }
    status.textContent = r.ok ? (auto === true ? 'Data re-analysed automatically.' : 'Done — everything refreshed.') : 'Finished with problems: ' + r.results.filter(x => !x.ok).map(x => x.name).join(', ');
    zkShowChanges(r);
    // One button: Refresh now = sync + analyse + go live. A manual refresh with a key keeps the headline numbers updating every 5 minutes (the key stays in memory only).
    if (auto !== true && keepKey && keepSec && typeof zkLiveStart === 'function') { zkLiveStart(keepKey, keepSec); status.textContent += ' Live: on (every 5 min).'; }
  } catch (e) { status.textContent = 'Failed: ' + (e.message || e); }
  ZK_RUN.running = false; clearInterval(ZK_RUN.timer); window.removeEventListener('beforeunload', beforeUnload);
  document.getElementById('zk-key').value = ''; document.getElementById('zk-sec').value = ''; btn.disabled = false; btn.textContent = 'Refresh now';
  if (document.getElementById('zk-tools').style.display !== 'flex') zkChipUpdate(true, '✅ ' + status.textContent); else zkChip().style.display = 'none';
  try { _cache = {}; } catch (e) {}
  const active = document.querySelector('.tab.active'); if (active && typeof loadTab === 'function') loadTab(active.id);
  if (typeof loadTab === 'function') loadTab('alerts');
}

// What this refresh changed (new positions, quantities, orders) plus every problem in plain words, so a missed purchase or a refused key is never silent.
// Text only (textContent), nothing from Trading 212 is put in as HTML.
function zkShowChanges(r) {
  const el = document.getElementById('zk-changes'); if (!el) return;
  const out = [];
  for (const x of (r.results || [])) if (!x.ok) out.push('⚠ ' + x.name + (x.note ? ': ' + x.note : ''));
  for (const w of (r.warnings || [])) out.push('⚠ ' + w);
  if (r.changes && r.changes.lines) out.push(...r.changes.lines.map(l => '• ' + l));
  el.textContent = out.join('\n'); el.style.display = out.length ? 'block' : 'none';
  el.style.borderLeftColor = (r.results || []).some(x => !x.ok) ? '#f87171' : 'var(--accent)';
}

// ── recovery-key check + weekly reminder ──
const ZK_RK_DAYS = 7;
async function zkCheckRecovery() {
  const inp = document.getElementById('zk-rk'), msg = document.getElementById('zk-rk-msg'), btn = document.getElementById('zk-rk-btn');
  if (!ZKCTX) return; const rk = inp.value.trim(); if (!rk) { msg.style.color = '#f87171'; msg.textContent = 'Type your recovery key first'; return; }
  btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'Checking…';
  try {
    const k = await ZKCTX.call('/rest/v1/user_keys?select=*', {}, ZKCTX.token);
    if (!k.ok || !k.d || !k.d.length) throw new Error('Could not read your key record');
    let ok = true; try { await ZK.unlockWithRecovery(rk, k.d[0]); } catch (e) { ok = false; }
    if (!ok) { msg.style.color = '#f87171'; msg.textContent = '❌ That key does not match this account. Find the key you saved right after the setup (the first one), and try again.'; return; }
    await ZKCTX.store.put('settings', [{ key: 'recovery_check', at: new Date().toISOString() }], r => r.key);
    msg.style.color = '#34d399'; msg.textContent = '✅ Correct. Your recovery key works. Next check due in ' + ZK_RK_DAYS + ' days.';
    zkReminderRender(new Date().toISOString());
  } catch (e) { msg.style.color = '#f87171'; msg.textContent = 'Could not check: ' + (e.message || e); }
  finally { inp.value = ''; btn.disabled = false; }
}
function zkReminderRender(at) {
  const last = document.getElementById('zk-rk-last'), days = at ? (Date.now() - new Date(at).getTime()) / 86400000 : Infinity;
  if (last) last.textContent = at ? 'Last checked: ' + new Date(at).toLocaleDateString() + '.' : 'Never checked yet.';
  let b = document.getElementById('zk-rk-banner');
  if (days < ZK_RK_DAYS) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    b = document.createElement('div'); b.id = 'zk-rk-banner';
    b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:45;background:#92400e;color:#fff;font-size:13px;padding:8px 14px;text-align:center;cursor:pointer';
    b.onclick = () => { zkToolsOpen(); }; document.body.appendChild(b);
  }
  b.textContent = (at ? '🔑 Your recovery key has not been checked for ' + Math.floor(days) + ' days' : '🔑 You have not checked your recovery key yet') + ' — tap to check it now (takes 10 seconds)';
  b.style.display = 'block';
}
async function zkReminderInit() {
  try { const r = await ZKCTX.store.get('settings', 'recovery_check'); zkReminderRender(r && r.at); } catch (e) { zkReminderRender(null); }
}

// ── read-only comparison of the encrypted orders with the old plaintext table (cutover verification; removed after the plaintext is dropped)
async function zkCompareOrders() {
  const out = document.getElementById('zk-cmp-out'), btn = document.getElementById('zk-cmp-btn'); if (!ZKCTX) return;
  btn.disabled = true; out.textContent = 'Reading…';
  try {
    const enc = await ZKCTX.store.load('t212_orders'), old = [];
    for (let off = 0; ; off += 1000) {
      const r = await ZKCTX.call('/rest/v1/t212_orders?select=id,order_id,filled_at,quantity,price,status,ticker&order=id&limit=1000&offset=' + off, {}, ZKCTX.token);
      if (!r.ok) throw new Error('old copy: ' + r.status); old.push(...r.d); if (r.d.length < 1000) break;
    }
    const oldIds = new Set(old.map(o => String(o.id))), encIds = new Set(enc.map(o => String(o.id)));
    const extra = enc.filter(o => !oldIds.has(String(o.id))), missing = old.filter(o => !encIds.has(String(o.id)));
    const sig = o => [o.order_id, o.filled_at, +o.quantity, +o.price].join('|'), oldSigs = new Set(old.map(sig));
    const extraSameTrade = extra.filter(o => oldSigs.has(sig(o)));
    const dates = extra.map(o => o.filled_at).filter(Boolean).sort(), by = {};
    extra.forEach(o => { const k = (o.status || '?') + (String(o.id).startsWith('order:') ? ' (no fill id)' : ''); by[k] = (by[k] || 0) + 1; });
    out.textContent = ['Old copy: ' + old.length + ' orders', 'Private copy: ' + enc.length + ' orders',
      'In private only: ' + extra.length + (extra.length ? ' (dates ' + dates[0] + ' to ' + dates[dates.length - 1] + ')' : ''),
      '  of those, same trade as an old row under a different id (likely duplicates): ' + extraSameTrade.length,
      '  by status: ' + JSON.stringify(by), 'In old copy only (missing from private): ' + missing.length].join('\n');
  } catch (e) { out.textContent = 'Failed: ' + (e.message || e); }
  btn.disabled = false;
}

async function zkDedupe(apply) {
  const out = document.getElementById('zk-cmp-out'), b1 = document.getElementById('zk-dd-scan'), b2 = document.getElementById('zk-dd-fix'); if (!ZKCTX) return;
  b1.disabled = b2.disabled = true; out.textContent = apply ? 'Fixing…\n' : 'Scanning…';
  try {
    const d = ZKDedupe.create(ZKCTX);
    if (!apply) { const rep = await d.scan(); out.textContent = rep.map(r => `${r.kind}: ${r.total} rows, ${r.distinct} distinct, ${r.surplus} extra` + (r.bad ? `, ${r.bad} unreadable` : '') + (r.unkeyed ? `, ${r.unkeyed} unkeyed` : '')).join('\n') + '\n\nTotal extra rows: ' + rep.reduce((n, r) => n + r.surplus, 0); }
    else { await d.fix(m => { out.textContent += m + '\n'; }); out.textContent += '\nDone. Run Scan again to confirm 0 extra.'; try { _cache = {}; } catch (e) {} }
  } catch (e) { out.textContent += '\nStopped: ' + (e.message || e); }
  b1.disabled = b2.disabled = false;
}

// ── replace a lost recovery key (needs the unlocked session; the old key keeps working until the new one is activated) ──
var ZK_NRK = null;
async function zkNewRecoveryStart() {
  if (!ZKCTX) return; const msg = document.getElementById('zk-nrk-msg'); msg.textContent = '';
  try {
    const k = await ZKCTX.call('/rest/v1/user_keys?select=*', {}, ZKCTX.token);
    if (!k.ok || !k.d || !k.d.length) throw new Error('Could not read your key record');
    ZK_NRK = await ZK.rewrapRecovery(ZKCTX.dk, k.d[0]);
    document.getElementById('zk-nrk-key').textContent = ZK_NRK.recoveryKey; document.getElementById('zk-nrk-confirm').value = '';
    document.getElementById('zk-nrk-box').style.display = 'block';
  } catch (e) { ZK_NRK = null; msg.style.color = '#f87171'; msg.textContent = 'Could not start: ' + (e.message || e); }
}
async function zkNewRecoveryActivate() {
  const msg = document.getElementById('zk-nrk-msg'), btn = document.getElementById('zk-nrk-go'), inp = document.getElementById('zk-nrk-confirm');
  if (!ZKCTX || !ZK_NRK) return; msg.style.color = '#f87171';
  if (ZK.cleanRecovery(inp.value) !== ZK.cleanRecovery(ZK_NRK.recoveryKey)) { msg.textContent = 'That does not match the key above. Copy it carefully (nothing was changed).'; return; }
  btn.disabled = true; msg.style.color = 'var(--muted)'; msg.textContent = 'Saving…';
  try {
    const r = await ZKCTX.call('/rest/v1/user_keys?user_id=eq.' + ZKCTX.uid, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ rec_salt: ZK_NRK.rec_salt, wrapped_dk_rec: ZK_NRK.wrapped_dk_rec, updated_at: new Date().toISOString() }) }, ZKCTX.token);
    if (!r.ok) throw new Error('server said ' + r.status);
    const k = await ZKCTX.call('/rest/v1/user_keys?select=*', {}, ZKCTX.token);       // prove the saved record opens with the new key
    await ZK.unlockWithRecovery(ZK_NRK.recoveryKey, k.d[0]);
    await ZKCTX.store.put('settings', [{ key: 'recovery_check', at: new Date().toISOString() }], x => x.key);
    ZK_NRK = null; document.getElementById('zk-nrk-key').textContent = ''; inp.value = ''; document.getElementById('zk-nrk-box').style.display = 'none';
    msg.style.color = '#34d399'; msg.textContent = '✅ New recovery key is active and verified. Every older key is now void.'; zkReminderRender(new Date().toISOString());
  } catch (e) { msg.style.color = '#f87171'; msg.textContent = 'Not activated: ' + (e.message || e) + '. Your previous key is unchanged.'; }
  btn.disabled = false;
}
