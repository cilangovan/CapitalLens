// Accounts tab: connect Trading 212, see sync status, disconnect.
const FN_URL = SUPABASE_URL + '/functions/v1/broker';
let _acctTimer = null;

function _authHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN }, extra || {});
}
function _ago(iso) {
  if (!iso) return 'not yet';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
const _STATUS = {
  pending:     ['Syncing…', 'var(--yellow)'],
  active:      ['Connected', 'var(--green)'],
  error:       ['Problem', 'var(--red)'],
  needs_login: ['Key rejected', 'var(--red)'],
  disabled:    ['Paused', 'var(--muted)'],
};

async function fetchConnections() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/broker_connections?select=id,broker,label,environment,status,last_ok_at,last_error,sync_state,created_at&order=created_at`,
    { headers: _authHeaders() });
  if (!r.ok) throw new Error('Could not load accounts');
  return await r.json();
}

async function loadAccounts(autoOpen) {
  const box = document.getElementById('accounts-list');
  if (!box) return;
  let rows;
  try { rows = await fetchConnections(); }
  catch (e) { box.textContent = e.message; return; }
  box.textContent = '';
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'acct-empty';
    p.textContent = 'No broker connected yet. Connect Trading 212 to see your own portfolio here.';
    box.appendChild(p);
    if (autoOpen) { const b = document.querySelector('nav button[data-tab="accounts"]'); if (b) b.click(); }
  }
  let anyPending = false;
  rows.forEach(c => {
    anyPending = anyPending || c.status === 'pending';
    const [txt, col] = _STATUS[c.status] || [c.status, 'var(--muted)'];
    const st = c.sync_state || {};
    const hist = st.history_done_at ? 'history imported' : (c.status === 'pending' || st.snapshot_at ? 'importing history…' : '');
    const row = document.createElement('div');
    row.className = 'acct-row';
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'acct-title';
    title.textContent = c.label + (c.environment === 'demo' ? ' · practice' : '');
    const dot = document.createElement('span');
    dot.className = 'acct-chip'; dot.style.color = col; dot.style.borderColor = col; dot.textContent = txt;
    title.appendChild(dot);
    const meta = document.createElement('div');
    meta.className = 'acct-meta';
    meta.textContent = `Last sync ${_ago(c.last_ok_at)}` + (st.positions != null ? ` · ${st.positions} positions` : '') + (hist ? ` · ${hist}` : '');
    left.append(title, meta);
    if (c.last_error) { const er = document.createElement('div'); er.className = 'acct-err'; er.textContent = c.last_error; left.appendChild(er); }
    const del = document.createElement('button');
    del.className = 'acct-btn danger'; del.textContent = 'Disconnect';
    del.onclick = () => disconnectAccount(c.id, c.label);
    row.append(left, del);
    box.appendChild(row);
  });
  clearTimeout(_acctTimer);
  if (anyPending) _acctTimer = setTimeout(() => loadAccounts(false), 5000);
}

async function disconnectAccount(id, label) {
  if (!confirm(`Disconnect "${label}"?\n\nYour stored key is deleted and its imported positions and history are removed from CapitalLens.`)) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/broker_connections?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: _authHeaders() });
  if (!r.ok) { alert('Could not disconnect. Try again.'); return; }
  Object.keys(loaded).forEach(k => { if (k !== 'accounts') delete loaded[k]; });   // refresh dashboard data next visit
  loadAccounts(false);
}

function openConnect() {
  document.getElementById('connect-err').textContent = '';
  ['cn-key', 'cn-secret'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('connect-modal').classList.remove('hidden');
}
function closeConnect() { document.getElementById('connect-modal').classList.add('hidden'); }

async function submitConnect() {
  const err = document.getElementById('connect-err'), btn = document.getElementById('connect-btn');
  const key = document.getElementById('cn-key').value.trim(), secret = document.getElementById('cn-secret').value.trim();
  const env = document.querySelector('input[name="cn-env"]:checked').value;
  if (!key || !secret) { err.textContent = 'Enter both the API key and the API secret.'; return; }
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Checking with Trading 212…';
  try {
    const r = await fetch(FN_URL + '/connect', {
      method: 'POST', headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ broker: 'trading212', environment: env, api_key: key, api_secret: secret }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Could not connect. Try again.'; return; }
    document.getElementById('cn-key').value = ''; document.getElementById('cn-secret').value = '';   // never keep the key in the page
    closeConnect();
    Object.keys(loaded).forEach(k => { if (k !== 'accounts') delete loaded[k]; });
    loadAccounts(false);
  } catch (e) {
    err.textContent = 'Network error. Try again.';
  } finally { btn.disabled = false; btn.textContent = 'Connect account'; }
}

loaders.accounts = async () => loadAccounts(false);

// ── phone alerts (ntfy topic) ─────────────────────────────────────────────────
async function loadNotify() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=ntfy_topic,email_alerts`, { headers: _authHeaders() });
    const rows = await r.json();
    document.getElementById('ntfy-topic').value = (rows[0] && rows[0].ntfy_topic) || '';
    document.getElementById('email-alerts').checked = !rows[0] || rows[0].email_alerts !== false;
  } catch (e) { /* leave blank */ }
}
async function saveNotify() {
  const msg = document.getElementById('notify-msg'), box = document.getElementById('ntfy-topic');
  // accept what people paste: a full ntfy link (https://ntfy.sh/name), "ntfy.sh/name", "@name", trailing slashes
  const v = box.value.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?ntfy\.sh\//i, '').replace(/^[@#]/, '').replace(/[\/?#].*$/, '');
  box.value = v;
  if (v) {
    const why = v.length < 6 ? `too short (${v.length} characters — needs at least 6)`
      : v.length > 64 ? `too long (${v.length} characters — max 64)`
      : /\s/.test(v) ? 'it has a space'
      : /[^A-Za-z0-9_-]/.test(v) ? `it has "${v.match(/[^A-Za-z0-9_-]/)[0]}" — only letters, numbers, - and _ are allowed` : '';
    if (why) { msg.style.color = 'var(--red)'; msg.textContent = `Topic not saved: ${why}. Example: hoop-alerts-7k2x`; return; }
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=not.is.null`, {
    method: 'PATCH', headers: _authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ ntfy_topic: v || null, email_alerts: document.getElementById('email-alerts').checked }),
  });
  msg.style.color = r.ok ? 'var(--green)' : 'var(--red)';
  msg.textContent = r.ok ? 'Saved.' : 'Could not save. Try again.';
}
loaders.accounts = async () => { loadAccounts(false); loadNotify(); };
