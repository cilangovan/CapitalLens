// Zero-knowledge dashboard shell: signs in with the derived login secret, unlocks the data key in this browser, and answers every
// dashboard data call from the customer's own encrypted rows (docs/zk/shim.js). The server never sees the password or any plaintext.
const SUPABASE_URL = 'https://ggprfdetivzekjxlpvyq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK';   // publishable key: safe in a browser
const PROXY = SUPABASE_URL + '/rest/v1';
const RELAY_URL = 'https://capitallens-relay.itsme-daf.workers.dev';
let IS_GUEST = false;
let SESSION_TOKEN = null;
let ZKCTX = null;                                  // { store, call, token, uid, dk, market } once unlocked

const _rawFetch = window.fetch.bind(window);       // captured BEFORE the shim is installed: key/ciphertext traffic must reach Supabase
async function zkCall(path, opt, token) {
  const r = await _rawFetch(SUPABASE_URL + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || SUPABASE_KEY) }, (opt && opt.headers) || {}) }));
  let d = null; try { d = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, d };
}
const _uidOf = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) { return null; } };

// ── Inactivity auto-logout (45 min) ──
const INACTIVITY_MS = 45 * 60 * 1000; let _inactivityTimer = null;
function resetInactivityTimer() { if (!SESSION_TOKEN) return; clearTimeout(_inactivityTimer); _inactivityTimer = setTimeout(() => { try { sessionStorage.setItem('t212_timeout', '1'); } catch (e) {} logout(); }, INACTIVITY_MS); }
function startInactivityTimer() { ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'click'].forEach(evt => document.addEventListener(evt, resetInactivityTimer, { passive: true })); resetInactivityTimer(); }
function toggleEye(inputId, btn) { const inp = document.getElementById(inputId), show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; btn.textContent = show ? '🙈' : '👁'; }
function setErr(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; } }
function setBtnLoading(id, loading) { const b = document.getElementById(id); if (b) b.disabled = loading; }

async function _rememberSession(token, dk, email) {
  try {                                            // tab-only storage, shared with /zk/ so the same unlock carries across pages in this tab
    sessionStorage.setItem('zk_token', token); sessionStorage.setItem('zk_email', email || '');
    sessionStorage.setItem('zk_dk', ZK.b64(new Uint8Array(await crypto.subtle.exportKey('raw', dk))));
  } catch (e) {}
}
async function doLogin() {
  const email = document.getElementById('login-user').value.trim(), pw = document.getElementById('login-pw').value;
  if (!email || !pw) return setErr('pw-error', 'Enter email and password');
  setErr('pw-error', ''); setBtnLoading('login-btn', true);
  try {
    const p = await zkCall('/rest/v1/rpc/zk_login_params', { method: 'POST', body: JSON.stringify({ p_email: email }) });
    if (!p.ok || !p.d) return setErr('pw-error', 'Could not reach the server');
    const { authSecret } = await ZK.deriveKeys(pw, p.d.pw_salt, p.d.kdf && p.d.kdf.iterations);
    const t = await zkCall('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: authSecret }) });
    if (!t.ok || !t.d.access_token) return setErr('pw-error', 'Invalid email or password');
    const k = await zkCall('/rest/v1/user_keys?select=*', {}, t.d.access_token);
    if (!k.ok || !k.d.length) return setErr('pw-error', 'This account has no encryption keys yet. Create or upgrade it on the private sign-up page first.');
    const u = await ZK.unlockWithPassword(pw, k.d[0]);
    await _rememberSession(t.d.access_token, u.dk, email);
    await _unlocked(t.d.access_token, u.dk);
  } catch (e) { setErr('pw-error', 'Could not unlock: ' + e.message); }
  finally { setBtnLoading('login-btn', false); document.getElementById('login-pw').value = ''; }
}
function loginKey(ev) { if (ev && ev.key === 'Enter') doLogin(); }
ZKHandlers.install(document);                      // strict CSP: inline on* attributes are converted and run through a whitelisted, eval-free interpreter
function loginGuest() { setErr('pw-error', 'Guest mode is retired: every read needs your own sign-in.'); }

async function _unlocked(token, dk) {
  SESSION_TOKEN = token; IS_GUEST = false;
  const uid = _uidOf(token), store = ZKStore.create({ call: zkCall, token, uid, dk });
  const market = ZKMarket.create({ relayUrl: RELAY_URL, shared: ZKMarket.sharedCache(zkCall, token, () => Date.now(), 48) });
  ZKCTX = { store, call: zkCall, token, uid, dk, market };
  const ops = ZKWatchlistOps.create({ store, call: zkCall, token, relayUrl: RELAY_URL, analyse: () => ZKWatchlist.run({ store, market }, new Date()) });
  ZKShim.install(PROXY, ZKShim.create({ store, call: zkCall, token, positions: () => store.load('positions'), defuse, ops }));
  startApp();
  if (typeof zkReminderInit === 'function') zkReminderInit();
  if (typeof zkAutoRefresh === 'function') zkAutoRefresh();
}
function logout() {
  clearTimeout(_inactivityTimer); ZKCTX = null;
  try { const keep = ['t212_timeout', 't212_expired'].filter(k => sessionStorage.getItem(k)); sessionStorage.clear(); keep.forEach(k => sessionStorage.setItem(k, '1')); } catch (e) {}
  location.reload();
}
function startApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  startInactivityTimer();
  loadTab('overview'); loadTab('alerts');          // preload so the 🔔 unread badge shows
}
function showResetForm() { location.href = '../zk/'; }
function showLoginForm() {}
function openChangePw() { location.href = '../zk/'; }
function closeChangePw() {}
function doResetRequest() { location.href = '../zk/'; }          // reset / recovery / password change need the recovery key: handled on the private account page
function doResetConfirm() { location.href = '../zk/'; }
function doChangePassword() { location.href = '../zk/'; }

if (window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) { document.documentElement.style.display = 'none'; } }
window.addEventListener('DOMContentLoaded', async function () {
  try {
    const timedOut = sessionStorage.getItem('t212_timeout'), sub = document.getElementById('login-subtitle');
    if (timedOut) { sessionStorage.removeItem('t212_timeout'); if (sub) { sub.textContent = 'Session expired due to inactivity'; sub.style.color = '#e8a838'; } }
    const tok = sessionStorage.getItem('zk_token'), dkb = sessionStorage.getItem('zk_dk');       // unlocked earlier in this tab (e.g. on /zk/)
    if (tok && dkb) await _unlocked(tok, await crypto.subtle.importKey('raw', ZK.unb64(dkb), 'AES-GCM', true, ['encrypt', 'decrypt']));
  } catch (e) { try { sessionStorage.removeItem('zk_token'); sessionStorage.removeItem('zk_dk'); } catch (x) {} }
  finally { const app = document.getElementById('app'); if (!app || !app.classList.contains('visible')) showLoginScreen(); }       // the sign-in box stays hidden (CSS) while a saved session is being restored; shown only when there is none
});
function showLoginScreen() { const el = document.getElementById('login-screen'); if (el) el.classList.add('show'); }
