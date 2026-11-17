// ── AUTH ──────────────────────────────────────────────────────
// Demo build: sign in with Supabase Auth and read tables directly. Row-level security scopes every query to the signed-in user.
const SUPABASE_URL = 'https://ggprfdetivzekjxlpvyq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK';   // publishable key: safe in a browser
const PROXY = SUPABASE_URL + '/rest/v1';
let IS_GUEST = false;
let SESSION_TOKEN = null;

// ── Inactivity auto-logout (45 min, master session only) ──────
const INACTIVITY_MS = 45 * 60 * 1000;
let _inactivityTimer = null;

function resetInactivityTimer() {
  if (IS_GUEST || !SESSION_TOKEN) return;
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    try { sessionStorage.setItem('t212_timeout', '1'); } catch(e){}
    logout();
  }, INACTIVITY_MS);
}

function startInactivityTimer() {
  ['mousemove','keydown','mousedown','touchstart','scroll','click'].forEach(evt =>
    document.addEventListener(evt, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}

function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}
function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (btn) btn.disabled = loading;
}

async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pw').value;
  if (!email || !password) { setErr('pw-error', 'Enter email and password'); return; }
  setErr('pw-error', '');
  setBtnLoading('login-btn', true);
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok || !d.access_token) { setErr('pw-error', 'Invalid email or password'); return; }
    SESSION_TOKEN = d.access_token;
    try { sessionStorage.setItem('t212_token', d.access_token); sessionStorage.setItem('t212_auth', 'master'); } catch (e) {}
    IS_GUEST = false;
    startApp();
  } catch (e) {
    setErr('pw-error', 'Error: ' + e.message);
  } finally { setBtnLoading('login-btn', false); }
}

function loginGuest() {
  IS_GUEST = true;
  SESSION_TOKEN = null;
  try { sessionStorage.setItem('t212_auth','guest'); } catch(e){}
  startApp();
}

function logout() {
  clearTimeout(_inactivityTimer);
  ['mousemove','keydown','mousedown','touchstart','scroll','click'].forEach(evt =>
    document.removeEventListener(evt, resetInactivityTimer)
  );
  try {
    const keep = ['t212_timeout', 't212_expired'].filter(k => sessionStorage.getItem(k));   // sign-in screen messages
    sessionStorage.clear();
    keep.forEach(k => sessionStorage.setItem(k, '1'));
  } catch(e){}
  location.reload();
}

function startApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  if (IS_GUEST) {
    document.getElementById('guest-badge').style.display = 'inline-flex';
  } else {
    // password change is not available in the demo
  }
  if (!IS_GUEST) {
    try {
      const firstLogin = sessionStorage.getItem('t212_first_login');
      if (firstLogin === '1') { sessionStorage.removeItem('t212_first_login'); openChangePw(true); }
    } catch(e){}
  }
  if (!IS_GUEST) startInactivityTimer();
  loadTab('overview');
  if (!IS_GUEST) loadTab('alerts');   // preload so the 🔔 unread badge shows
}

// ── Reset password flow ───────────────────────────────────────
function showResetForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
  document.getElementById('login-subtitle').textContent = 'Reset Password';
}
function showLoginForm() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('reset-form').style.display = 'none';
  document.getElementById('login-subtitle').textContent = 'Portfolio dashboard';
}

async function doResetRequest() {
  const username = document.getElementById('reset-user').value.trim();
  setErr('reset-error', '');
  try {
    await fetch(`${PROXY}/auth/reset-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
  } catch(e) {}
  document.getElementById('reset-sent').style.display = 'block';
}

async function doResetConfirm() {
  const pw1 = document.getElementById('new-pw1').value;
  const pw2 = document.getElementById('new-pw2').value;
  const params = new URLSearchParams(location.search);
  const token = params.get('reset');
  if (pw1 !== pw2) { setErr('reset-confirm-error', 'Passwords do not match'); return; }
  if (pw1.length < 8) { setErr('reset-confirm-error', 'Min 8 characters'); return; }
  setErr('reset-confirm-error', '');
  try {
    const r = await fetch(`${PROXY}/auth/reset-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetToken: token, newPassword: pw1 }),
    });
    const d = await r.json();
    if (!r.ok) { setErr('reset-confirm-error', d.error || 'Failed'); return; }
    document.getElementById('reset-confirm-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('login-subtitle').textContent = '✓ Password updated — sign in';
    history.replaceState({}, '', '/');
  } catch(e) { setErr('reset-confirm-error', 'Network error'); }
}

// ── Change password (while logged in) ────────────────────────
function openChangePw(isFirst) {
  document.getElementById('change-pw-modal').classList.remove('hidden');
  if (isFirst) {
    document.getElementById('cpw-error').textContent = 'First login — please change your password';
    document.getElementById('cpw-error').style.display = 'block';
    document.getElementById('cpw-error').style.color = 'var(--yellow)';
  }
}
function closeChangePw() {
  document.getElementById('change-pw-modal').classList.add('hidden');
  setErr('cpw-error', '');
  document.getElementById('cpw-new1').value = '';
  document.getElementById('cpw-new2').value = '';
}

async function doChangePassword() {
  const pw1 = document.getElementById('cpw-new1').value;
  const pw2 = document.getElementById('cpw-new2').value;
  if (pw1 !== pw2) { setErr('cpw-error', 'Passwords do not match'); document.getElementById('cpw-error').style.color='var(--red)'; return; }
  if (pw1.length < 8) { setErr('cpw-error', 'Min 8 characters'); document.getElementById('cpw-error').style.color='var(--red)'; return; }
  if (!SESSION_TOKEN) { setErr('cpw-error', 'No active session'); document.getElementById('cpw-error').style.color='var(--red)'; return; }
  try {
    const r = await fetch(`${PROXY}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SESSION_TOKEN, newPassword: pw1 }),
    });
    const d = await r.json();
    if (!r.ok) { setErr('cpw-error', d.error || 'Failed'); document.getElementById('cpw-error').style.color='var(--red)'; return; }
    closeChangePw();
    alert('✓ Password changed successfully');
  } catch(e) { setErr('cpw-error', 'Network error'); }
}

// ── Refuse to run inside someone else's frame (clickjacking) ─────
if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.documentElement.style.display = 'none'; } }

// ── Check session on load ─────────────────────────────────────
// Runs after every script has loaded (startApp needs loadTab from router.js, loaded last).
window.addEventListener('DOMContentLoaded', function() {
  const params = new URLSearchParams(location.search);
  if (params.get('reset')) {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('reset-confirm-form').style.display = 'block';
    document.getElementById('login-subtitle').textContent = 'Set New Password';
    return;
  }
  try {
    if (sessionStorage.getItem('t212_expired')) {
      sessionStorage.removeItem('t212_expired');
      const sub = document.getElementById('login-subtitle');
      if (sub) { sub.textContent = 'Session expired — please sign in again'; sub.style.color = '#e8a838'; }
    }
    const timedOut = sessionStorage.getItem('t212_timeout');
    if (timedOut) {
      sessionStorage.removeItem('t212_timeout');
      const sub = document.getElementById('login-subtitle');
      if (sub) {
        sub.textContent = 'Session expired due to inactivity';
        sub.style.color = '#e8a838';
      }
    }
    const auth = sessionStorage.getItem('t212_auth');
    const tok  = sessionStorage.getItem('t212_token');
    if (auth === 'master' && tok) { SESSION_TOKEN = tok; IS_GUEST = false; startApp(); }
    // guest mode retired: every read now needs a signed-in session
  } catch(e) {}
});
