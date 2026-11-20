// ── TEMPORARY DEMO ACCESS (epic #32; requirements: documentation/demo-requirements.md) ──
// "Try the demo" asks the demo-access function for a one-hour login, shows it on screen, then signs in with it.
// While signed in: countdown badge, 5-minute warning, heartbeat (idle limit), end on close. Expiry itself is enforced in Postgres (RLS), not here.
const DEMO_FN = SUPABASE_URL + '/functions/v1/demo-access';
const DEMO_REFUSALS = {
  disabled: 'The demo is switched off for the moment. Please try again later.',
  busy: 'The demo is busy right now. Please try again in a few minutes.',
  rate: 'You have already started several demo sessions. Please try again in an hour.',
  failed: 'Could not create a demo login. Please try again.',
};
const DEMO_ENDED = {
  time: 'Your one-hour demo has ended. Start a new one any time.',
  idle: 'Your demo ended after 45 minutes of inactivity. Start a new one any time.',
  closed: 'Your demo was closed. Start a new one any time.',
  owner: 'The demo was reset. Start a new one any time.',
};
let _demo = { creds: null, endsAt: 0, tick: null, lastBeat: 0, warned: false, on: false };

function demoFmt(sec) { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
function demoRpc(fn, body, keepalive) {
  return fetch(`${PROXY}/rpc/${fn}`, {
    method: 'POST', keepalive: !!keepalive,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SESSION_TOKEN },
    body: JSON.stringify(body || {}),
  });
}

async function demoStart() {
  const btn = document.getElementById('demo-try-btn'), msg = document.getElementById('demo-try-msg');
  if (btn) btn.disabled = true;
  if (msg) { msg.textContent = 'Creating your temporary login…'; msg.className = 'demo-msg'; }
  try {
    const r = await fetch(DEMO_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: '{}' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.password) { if (msg) { msg.textContent = DEMO_REFUSALS[d.error] || DEMO_REFUSALS.failed; msg.className = 'demo-msg err'; } if (btn) btn.disabled = false; return; }
    _demo.creds = d;
    document.getElementById('demo-cred-email').textContent = d.email;
    document.getElementById('demo-cred-pw').textContent = d.password;
    document.getElementById('demo-cred-mins').textContent = d.ttl_minutes;
    document.getElementById('demo-cred-idle').textContent = d.idle_minutes;
    document.getElementById('demo-start').style.display = 'none';
    document.getElementById('demo-creds').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    if (msg) msg.textContent = '';
  } catch (e) {
    if (msg) { msg.textContent = DEMO_REFUSALS.failed; msg.className = 'demo-msg err'; }
    if (btn) btn.disabled = false;
  }
}

function demoCopy(which, btn) {
  const text = which === 'email' ? _demo.creds.email : _demo.creds.password;
  const done = () => { const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old; }, 1500); };
  try { navigator.clipboard.writeText(text).then(done, () => {}); } catch (e) {}
}

async function demoOpen() {
  if (!_demo.creds) return;
  document.getElementById('login-user').value = _demo.creds.email;
  document.getElementById('login-pw').value = _demo.creds.password;
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('demo-creds').style.display = 'none';
  await doLogin();
}

function demoShowLogin() {
  const c = _demo.creds;
  const el = document.getElementById('demo-banner-login');
  if (!el) return;
  if (!c) { el.textContent = 'Your login is only shown once, on the screen where it was created.'; }
  else { el.textContent = c.email + '  ·  ' + c.password; }
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function demoEnded(reason) {
  clearInterval(_demo.tick); _demo.on = false;
  try { sessionStorage.setItem('demo_msg', DEMO_ENDED[reason] || DEMO_ENDED.time); } catch (e) {}
  logout(true);
}

async function demoBeat(force) {
  const now = Date.now();
  if (!force && now - _demo.lastBeat < 60000) return;     // at most one heartbeat a minute
  _demo.lastBeat = now;
  try {
    const r = await demoRpc('demo_touch');
    if (r.status === 401) return demoEnded('time');
    const d = await r.json();
    if (!d || d.demo === false) return;
    if (d.active === false) return demoEnded(d.reason);
    _demo.endsAt = Date.now() + d.seconds_left * 1000;
  } catch (e) { /* offline: the server still enforces the limits */ }
}

async function demoInit() {
  let d = null;
  try { const r = await demoRpc('demo_touch'); d = r.ok ? await r.json() : null; } catch (e) {}
  if (!d || !d.demo) return;                             // the owner's master login: no timer, no banner
  if (d.active === false) return demoEnded(d.reason);
  _demo.on = true; _demo.endsAt = Date.now() + d.seconds_left * 1000; _demo.lastBeat = Date.now();
  document.getElementById('demo-badge').style.display = 'inline-flex';
  document.getElementById('demo-banner').style.display = 'flex';
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'click'].forEach(e => document.addEventListener(e, () => demoBeat(false), { passive: true }));
  window.addEventListener('pagehide', () => { if (_demo.on) { try { demoRpc('demo_end', { p_grace: true }, true); } catch (e) {} } });
  _demo.tick = setInterval(() => {
    const left = (_demo.endsAt - Date.now()) / 1000;
    if (left <= 0) return demoEnded('time');
    const b = document.getElementById('demo-badge');
    b.textContent = '⏱ ' + demoFmt(left);
    b.classList.toggle('warn', left <= 300);
    const w = document.getElementById('demo-warn');
    if (left <= 300) { w.style.display = 'block'; document.getElementById('demo-warn-min').textContent = Math.max(1, Math.ceil(left / 60)); }
  }, 1000);
}

// Sign out ends the demo for good (server side) before the page reloads.
const _logoutBase = logout;
logout = function (skipEnd) {
  if (_demo.on && skipEnd !== true) { _demo.on = false; demoRpc('demo_end', { p_grace: false }, true).catch(() => {}).finally(() => _logoutBase()); }
  else _logoutBase();
};

window.addEventListener('DOMContentLoaded', function () {
  try {
    const m = sessionStorage.getItem('demo_msg');
    if (m) { sessionStorage.removeItem('demo_msg'); const sub = document.getElementById('login-subtitle'); if (sub) { sub.textContent = m; sub.style.color = '#e8a838'; } }
  } catch (e) {}
});
