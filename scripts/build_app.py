#!/usr/bin/env python3
"""Generate docs/app/ (multi-user CapitalLens) from the dashboard sources in docs/.
Only login, signup and the Accounts tab are new; every dashboard script is reused from docs/js/."""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SUPABASE_URL = "https://ggprfdetivzekjxlpvyq.supabase.co"
SUPABASE_KEY = "sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK"   # publishable key: designed to be public

def sub(s, a, b):
    assert a in s, f"anchor missing: {a[:60]}"
    return s.replace(a, b, 1)

# ── index.html ────────────────────────────────────────────────────────────────
s = (DOCS / "index.html").read_text(encoding="utf-8")
s = s.replace('src="js/', 'src="../js/').replace('src="vendor/', 'src="../vendor/')
s = sub(s, '<script src="../js/auth.js"></script>', '<script src="app-auth.js"></script>')
s = sub(s, '<script src="../js/api.js"></script>', '<script src="../js/api.js"></script>\n<script src="app-shim.js"></script>')
s = sub(s, '<script src="../js/router.js"></script>', '<script src="../js/router.js"></script>\n<script src="accounts.js"></script>')
s = sub(s, "https://capitallens-proxy.itsme-daf.workers.dev", SUPABASE_URL)
s = sub(s, '<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex,nofollow">')
s = sub(s, '<span class="pill">LIVE</span>', '<span class="pill" style="background:#6366f1">BETA</span>')
s = re.sub(r'\s*<button id="change-pw-btn".*?</button>', '', s, count=1, flags=re.S)

# login box: sign in / create account
s = sub(s, '<p id="login-subtitle">Portfolio dashboard</p>', '<p id="login-subtitle">Your portfolio, one place</p>')
s = sub(s, '<input type="text" id="login-user" placeholder="Username" value="admin" autocomplete="username">',
        '<div class="auth-tabs"><button id="tab-signin" class="active" onclick="setAuthMode(\'signin\')">Sign in</button>'
        '<button id="tab-signup" onclick="setAuthMode(\'signup\')">Create account</button></div>\n'
        '        <input type="email" id="login-user" placeholder="Email" autocomplete="username">')
s = sub(s, 'id="login-btn" onclick="doLogin()">🔐 Sign In</button>', 'id="login-btn" onclick="doLogin()">🔐 Sign In</button>\n      <div class="auth-note" id="auth-note"></div>')
s = sub(s, '<button class="login-link" onclick="showResetForm()">Forgot password?</button>',
        '<span class="auth-note">CapitalLens only reads your portfolio. It cannot place trades.</span>')

nav_btn = '  <button data-tab="accounts" onclick="showTab(\'accounts\',this)">🔗 Accounts</button>\n</nav>'
s = sub(s, '</nav>', nav_btn)
tab = '''<div id="accounts" class="tab">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
      <h3 style="margin:0">Connected accounts</h3>
      <button class="acct-btn primary" onclick="openConnect()">＋ Connect Trading 212</button>
    </div>
    <div id="accounts-list"><div class="loading">Loading…</div></div>
  </div>
  <div class="card">
    <h3>How to get your Trading 212 API key</h3>
    <ol class="acct-steps">
      <li>In Trading 212, open <b>Settings → API (Beta)</b> and generate a new key.</li>
      <li>Give it <b>read-only</b> permissions: account data, portfolio, history of orders, dividends and transactions. Do not enable trading.</li>
      <li>Copy the <b>API key</b> and the <b>secret</b> (the secret is shown once) and paste them in the connect form.</li>
    </ol>
    <p class="acct-meta">Your key is stored encrypted and is never shown again. You can disconnect at any time, which deletes it.
    Trading 212 limits how fast we can read history, so a large account can take several minutes to import fully.</p>
  </div>
</div>

'''
s = sub(s, '<div id="overview" class="tab active">', tab + '<div id="overview" class="tab active">')

modal = '''<div class="modal-overlay hidden" id="connect-modal">
  <div class="modal-box" style="width:min(420px,92vw)">
    <h3>Connect Trading 212</h3>
    <div class="acct-env">
      <label><input type="radio" name="cn-env" value="live" checked> Live account</label>
      <label><input type="radio" name="cn-env" value="demo"> Practice account</label>
    </div>
    <div class="login-field"><input type="password" id="cn-key" placeholder="API key" autocomplete="off" spellcheck="false"></div>
    <div class="login-field"><input type="password" id="cn-secret" placeholder="API secret" autocomplete="off" spellcheck="false"></div>
    <div class="pw-error" id="connect-err"></div>
    <button class="login-btn btn-master" id="connect-btn" onclick="submitConnect()" style="margin-top:4px">Connect account</button>
    <button class="login-btn btn-guest" onclick="closeConnect()" style="margin-top:4px">Cancel</button>
  </div>
</div>

<div id="app">'''
s = sub(s, '<div id="app">', modal)

css = '''
  .auth-tabs { display:flex; gap:6px; margin-bottom:12px; }
  .auth-tabs button { flex:1; padding:8px; background:var(--bg3); color:var(--muted); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-size:13px; }
  .auth-tabs button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .auth-note { font-size:12px; color:var(--muted); margin-top:10px; line-height:1.4; }
  .acct-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 0; border-top:1px solid var(--border); }
  .acct-row:first-child { border-top:none; }
  .acct-title { font-weight:600; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .acct-chip { font-size:10px; font-weight:600; padding:2px 8px; border-radius:999px; border:1px solid; }
  .acct-meta { font-size:12px; color:var(--muted); margin-top:3px; }
  .acct-err { font-size:12px; color:var(--red); margin-top:4px; }
  .acct-empty { color:var(--muted); font-size:13px; }
  .acct-steps { margin:0 0 10px 18px; font-size:13px; line-height:1.6; }
  .acct-btn { padding:7px 14px; border-radius:8px; border:1px solid var(--border); background:var(--bg3); color:var(--text); cursor:pointer; font-size:12px; }
  .acct-btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .acct-btn.danger { color:var(--red); }
  .acct-env { display:flex; gap:16px; margin-bottom:12px; font-size:13px; }
'''
s = sub(s, '</style>', css + '</style>')
s = sub(s, '<title>CapitalLens</title>', '<title>CapitalLens</title>')
(DOCS / "app").mkdir(exist_ok=True)
(DOCS / "app" / "index.html").write_text(s, encoding="utf-8")

# ── app-auth.js ───────────────────────────────────────────────────────────────
a = (DOCS / "js" / "auth.js").read_text(encoding="utf-8")
a = sub(a, "const PROXY = 'https://capitallens-proxy.itsme-daf.workers.dev';",
f"""// Multi-user build: Supabase Auth for sign-in and sign-up; row-level security scopes every query to the signed-in user.
const SUPABASE_URL = '{SUPABASE_URL}';
const SUPABASE_KEY = '{SUPABASE_KEY}';   // publishable key: safe in a browser
const PROXY = SUPABASE_URL + '/rest/v1';
let AUTH_MODE = 'signin';""")
i = a.index('async function doLogin() {'); j = a.index('function loginGuest()')
a = a[:i] + """function setAuthMode(mode) {
  AUTH_MODE = mode;
  document.getElementById('tab-signin').classList.toggle('active', mode === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('login-btn').textContent = mode === 'signin' ? '🔐 Sign In' : '✨ Create account';
  document.getElementById('login-pw').setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
  document.getElementById('login-pw').placeholder = mode === 'signin' ? 'Password' : 'Password (min 10 characters)';
  setErr('pw-error', ''); document.getElementById('auth-note').textContent = '';
}

function _enter(d) {
  SESSION_TOKEN = d.access_token;
  try { sessionStorage.setItem('t212_token', d.access_token); sessionStorage.setItem('t212_auth', 'master'); } catch (e) {}
  IS_GUEST = false;
  startApp();
}

async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pw').value;
  if (!email || !password) { setErr('pw-error', 'Enter email and password'); return; }
  if (AUTH_MODE === 'signup' && password.length < 10) { setErr('pw-error', 'Use at least 10 characters'); return; }
  setErr('pw-error', ''); document.getElementById('auth-note').textContent = '';
  setBtnLoading('login-btn', true);
  try {
    const signup = AUTH_MODE === 'signup';
    const r = await fetch(signup ? `${SUPABASE_URL}/auth/v1/signup` : `${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (d.access_token) { _enter(d); return; }
    if (signup && r.ok) {   // account created but email confirmation is required
      document.getElementById('auth-note').textContent = 'Account created. Check your email for a confirmation link, then sign in.';
      setAuthMode('signin'); document.getElementById('auth-note').textContent = 'Account created. Check your email for a confirmation link, then sign in.';
      return;
    }
    const m = (d.msg || d.error_description || d.message || '').toLowerCase();
    if (signup) setErr('pw-error', m.includes('already') ? 'That email already has an account. Sign in instead.' : (d.msg || d.message || 'Could not create the account'));
    else setErr('pw-error', m.includes('not confirmed') ? 'Confirm your email first (check your inbox).' : 'Invalid email or password');
  } catch (e) {
    setErr('pw-error', 'Network error. Try again.');
  } finally { setBtnLoading('login-btn', false); }
}

""" + a[j:]
a = sub(a, "document.getElementById('change-pw-btn').style.display = 'inline-block';", "// password change comes later")
a = sub(a, "if (!IS_GUEST) loadTab('alerts');", "if (!IS_GUEST) { loadTab('alerts'); loadAccounts(true); }")
(DOCS / "app" / "app-auth.js").write_text(a, encoding="utf-8")
print("built docs/app")
