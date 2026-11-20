#!/usr/bin/env python3
"""Generates the private pages from the shared sources:
  docs/zkapp/index.html       dashboards (demo project)      <- docs/demo/index.html with the zero-knowledge shell
  docs/zkapp-prod/*           same dashboards, PRODUCTION project (own sign-in storage keys)
  docs/zk-prod/*              account page (sign-up / upgrade / recovery / sync), PRODUCTION project, no demo probe, no plaintext-delete box
The demo pages stay for testing. Every local script is pinned by an SRI hash; CI fails if the generated files are stale."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
s = (root / "docs/demo/index.html").read_text()
s = s.replace("<title>CapitalLens Demo</title>", "<title>CapitalLens (private)</title>")
s = s.replace("script-src 'self' 'unsafe-inline';", "script-src 'self';")      # no inline script: handlers run through docs/zk/handlers.js (no eval)
assert "script-src 'self';" in s
s = s.replace("connect-src 'self' https://ggprfdetivzekjxlpvyq.supabase.co;", "connect-src 'self' https://ggprfdetivzekjxlpvyq.supabase.co https://capitallens-relay.itsme-daf.workers.dev https://ntfy.sh;")
s = s.replace("<h2>🌐 CapitalLens Demo</h2>", "<h2>🔒 CapitalLens</h2>").replace("Demo portfolio — synthetic data", "Private portfolio dashboard — end-to-end encrypted")
s = s.replace('value="demo@capitallens.test" ', "")
# The temporary demo login (epic #32) exists only on the demo page: strip every piece of it from the private app.
s = re.sub(r"\s*<!-- Temporary demo login \(epic #32\) -->.*?<!-- Main login form -->", "\n\n    <!-- Main login form -->", s, flags=re.S)
s = re.sub(r'\s*<span id="demo-badge".*?</span>', "", s, flags=re.S)
s = re.sub(r'\s*<div id="demo-banner".*?</div>', "", s, flags=re.S)
s = re.sub(r'\s*<div id="demo-warn".*?</div>', "", s, flags=re.S)
s = re.sub(r"\s*/\* Temporary demo login \(epic #32\) \*/.*?(?=\s*/\* ── MAIN APP ── \*/)", "", s, flags=re.S)
s = s.replace('<script src="demo-session.js"></script>', "")
assert "demo-session" not in s and "demo-try-btn" not in s and "demo-banner" not in s
s = s.replace('<span class="pill" style="background:#f59e0b;color:#111">DEMO</span>', '<span class="pill" style="background:#0f766e;color:#fff">PRIVATE</span>')
s = s.replace('<button id="logout-btn" onclick="logout()">Sign out</button>',
  '<button onclick="zkToolsOpen()" style="background:none;border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;margin-right:8px">⚙ Settings</button>\n  <button id="logout-btn" onclick="logout()">Sign out</button>')
s = s.replace('<div style="text-align:center;margin-top:6px">\n        \n      </div>', '<div style="text-align:center;margin-top:10px;font-size:12px"><a href="../zk/" style="color:var(--muted)">Create account · recovery · upgrade an existing account</a></div>')
s = s.replace("onkeydown=\"if(event.key==='Enter')doLogin()\"", 'onkeydown="loginKey(event)"')
panel = """
<style>
#zk-tools input[type=password],#zk-tools input[type=text]{background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px 11px;font-size:13px;outline:none;box-sizing:border-box}
#zk-tools input:focus{border-color:var(--accent)}
#zk-tools .zk-dots{display:flex;gap:8px}
#zk-tools .zk-dot{width:14px;height:14px;border-radius:50%;border:0;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1}
#zk-tools .zk-dot span{font-size:9px;font-weight:700;color:#0008;opacity:0}
#zk-tools .zk-dots:hover .zk-dot span,#zk-tools .zk-dot:focus-visible span{opacity:1}
#zk-tools .zk-red{background:#ff5f57}#zk-tools .zk-yel{background:#febc2e}
#zk-tools .zk-help-btn{width:24px;height:24px;border-radius:50%;background:var(--bg3);color:var(--text);border:1px solid var(--border);font-size:13px;font-weight:700;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center}
#zk-tools button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}
#zk-tools button:disabled{opacity:.5;cursor:default}
</style>
<div id="zk-tools" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;align-items:center;justify-content:center">
  <div style="background:var(--card,#161b22);border:1px solid var(--border);border-radius:12px;padding:20px;width:min(560px,92vw);max-height:90vh;overflow:auto">
    <div style="display:flex;align-items:center;gap:12px;margin:0 0 10px">
      <div class="zk-dots"><button class="zk-dot zk-red" onclick="zkToolsClose()" title="Close" aria-label="Close"><span>✕</span></button><button class="zk-dot zk-yel" onclick="zkToolsMinimize()" title="Minimise (keeps anything running)" aria-label="Minimise"><span>–</span></button></div>
      <h3 style="margin:0;flex:1">⚙ Settings</h3>
      <button class="zk-help-btn" onclick="zkToolsHelp()" title="Help" aria-label="Help">?</button>
    </div>
    <div id="zk-help" style="display:none;font-size:12px;line-height:1.5;color:var(--muted);background:#0003;border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:0 0 12px">
      <b style="color:var(--text)">What is on this page</b><br>
      <b>🔑 Recovery key:</b> the only way back in if you forget your password. Press <i>Check my key</i> about once a week to confirm yours still works. Lost it? <i>Create a new recovery key</i> while you are signed in.<br>
      <b>🧪 Compare / duplicates:</b> health checks for your stored data. <i>Scan</i> only reads. Use <i>Fix</i> only if Scan reports extra rows.<br>
      <b>🔄 Refresh your data:</b> pulls your latest Trading 212 data and updates every dashboard. Paste your <u>read-only</u> Trading 212 key (Settings &gt; API in Trading 212). It is used once and never saved. Leave the fields empty to just re-analyse what is already stored. When you press <i>Refresh now</i> this window shrinks to a small progress chip; keep the tab open until it shows ✅.<br>
      <b>Buttons:</b> <i>Minimise</i> hides this window but keeps anything running; <i>Close</i> hides it too. Neither stops a refresh in progress.<br>
      <b>Automatic:</b> when you log in, your stored data is re-analysed by itself if it is more than 6 hours old or the app was updated, so new features appear without you pressing anything. Only the Trading 212 sync needs your key.<br>
      <b>Phone alerts:</b> save your ntfy topic at the bottom to get alerts on your phone.
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin:0 0 14px">
      <b style="font-size:13px">🔑 Check your recovery key</b>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 8px">Your recovery key is the only way back in if you forget your password, and nobody can recreate it. Type it here to confirm it still works. It is checked in this browser only: it is not sent anywhere or saved. <span id="zk-rk-last"></span></p>
      <input id="zk-rk" type="password" placeholder="Recovery key (XXXX-XXXX-…)" autocomplete="off" style="width:100%;margin-bottom:6px">
      <button id="zk-rk-btn" onclick="zkCheckRecovery()">Check my key</button> <span id="zk-rk-msg" style="font-size:12px"></span>
      <hr style="border-color:var(--border);margin:12px 0">
      <b style="font-size:13px">Lost your recovery key?</b>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 8px">While you are signed in you can replace it. Nothing changes until you confirm you saved the new one; then the old key stops working.</p>
      <button id="zk-nrk-btn" onclick="zkNewRecoveryStart()">Create a new recovery key</button>
      <div id="zk-nrk-box" style="display:none;margin-top:8px">
        <div id="zk-nrk-key" style="font-family:ui-monospace,Menlo,monospace;font-size:15px;background:#0004;border:1px dashed #f59e0b;color:#fcd34d;border-radius:6px;padding:10px;word-break:break-all;user-select:all"></div>
        <p style="font-size:12px;color:var(--muted);margin:8px 0 6px">1) Save it in your password manager AND on paper. 2) Type or paste it below to prove you saved it correctly. 3) Press Activate.</p>
        <input id="zk-nrk-confirm" type="password" placeholder="Type the new key again" autocomplete="off" style="width:100%;margin-bottom:6px">
        <button id="zk-nrk-go" onclick="zkNewRecoveryActivate()">Activate new key</button> <span id="zk-nrk-msg" style="font-size:12px"></span>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin:0 0 14px">
      <b style="font-size:13px">🧪 Compare orders with the old copy</b>
      <p style="font-size:12px;color:var(--muted);margin:6px 0 8px">Reads both copies of your orders in this browser and reports any differences (read-only, changes nothing).</p>
      <button id="zk-cmp-btn" onclick="zkCompareOrders()">Compare</button>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 6px">Duplicate repair: scan first (read-only), then fix. The fix saves the clean copy first and only then removes extras.</p>
      <button id="zk-dd-scan" onclick="zkDedupe(false)">Scan for duplicates</button> <button id="zk-dd-fix" onclick="zkDedupe(true)">Fix duplicates</button>
      <pre id="zk-cmp-out" style="font-size:11px;max-height:200px;overflow:auto;background:#0004;padding:8px;border-radius:6px;white-space:pre-wrap"></pre>
    </div>
    <h3 style="margin:0 0 6px;font-size:15px">🔄 Refresh your data</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px">Runs in this browser: Trading 212 sync, snapshot, every analysis, then your alert report. Your Trading 212 key is used once and never saved. Leave both fields empty to just re-analyse stored data.</p>
    <input id="zk-key" type="password" placeholder="Trading 212 API key" autocomplete="off" style="width:100%;margin-bottom:6px">
    <input id="zk-sec" type="password" placeholder="Trading 212 API secret" autocomplete="off" style="width:100%;margin-bottom:6px">
    <label style="font-size:12px"><input id="zk-full" type="checkbox"> Full history re-sync</label>
    <div style="margin:10px 0"><button id="zk-run" onclick="zkToolsRun()">Refresh now</button> <span id="zk-status" style="font-size:12px;margin-left:8px"></span></div>
    <pre id="zk-log" style="font-size:11px;max-height:200px;overflow:auto;background:#0004;padding:8px;border-radius:6px;white-space:pre-wrap"></pre>
    <hr style="border-color:var(--border)">
    <p style="font-size:12px;color:var(--muted);margin:6px 0">Phone alerts (ntfy topic, kept encrypted; treat it like a password):</p>
    <input id="zk-topic" type="password" placeholder="ntfy topic" autocomplete="off" style="width:70%"> <button onclick="zkToolsSaveTopic()">Save</button> <span id="zk-topic-msg" style="font-size:12px"></span>
  </div>
</div>
"""
s = s.replace('<script src="../js/api.js"></script>', panel + '<script src="../js/api.js"></script>', 1)
zk = ["../js/zkcrypto.js"] + [f"../zk/{m}.js" for m in ["store", "dedupe", "t212sync", "market", "alertfmt", "symbols", "returns", "valuebuy", "monitor", "lynch", "analystratings", "piehistory", "profitbooking", "strategy", "holdingdecision", "handlers", "watchlist", "watchlistops", "alertreport", "flow", "notify", "postgrest", "shim", "pipeline"]]
# Allowlist of handler functions: only the app's own top-level functions that its markup actually names in an on*= attribute.
import re as _re, json as _json
_srcs = [(root / "docs/js").glob("*.js"), [root / "docs/zkapp/zkapp-auth.js", root / "docs/zkapp/zkapp-tools.js"]]
_declared = set()
for grp in _srcs:
    for f in grp:
        _t = f.read_text()
        _declared |= set(_re.findall(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", _t, _re.M))
        _declared |= set(_re.findall(r"^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function", _t, _re.M))
_attr_text = s + "\n".join(f.read_text() for f in (root / "docs/js").glob("*.js"))
_used = set()
for m in _re.finditer(r"\bon(?:click|change|input|keydown)=(?=(.{0,400}))", _attr_text):
    _used |= set(_re.findall(r"([A-Za-z_$][\w$]*)\(", m.group(1).split(">")[0]))
_names = sorted(_used & _declared)
(root / "docs/zkapp/handler-names.js").write_text("// GENERATED by scripts/build_zkapp.py - the only functions an on* attribute may call (no eval, no built-ins)\nwindow.ZK_HANDLER_NAMES = " + _json.dumps(_names) + ";\n")
import base64, hashlib
def sri(rel):
    return "sha384-" + base64.b64encode(hashlib.sha384((root / "docs/zkapp" / rel).resolve().read_bytes()).digest()).decode()
tags = "\n".join(f'<script src="{p}" integrity="{sri(p)}"></script>' for p in zk)
s = s.replace('<script src="demo-shim.js"></script>\n<script src="demo-auth.js"></script>', tags + f'\n<script src="handler-names.js"></script>\n<script src="zkapp-auth.js" integrity="{sri("zkapp-auth.js")}"></script>\n<script src="zkapp-tools.js" integrity="{sri("zkapp-tools.js")}"></script>')
assert "demo-auth" not in s and "zkapp-auth.js" in s
# No sign-in flash on refresh: the box stays hidden until zkapp-auth.js has checked for a saved session in this tab, and only then is shown.
_LOGIN_CSS = "  #login-screen.hidden { display: none; }\n"
assert _LOGIN_CSS in s
s = s.replace(_LOGIN_CSS, _LOGIN_CSS + "  #login-screen:not(.show) { visibility: hidden; }\n", 1)
# Boot splash: while the saved-session check runs there must be something on screen (never a blank page), CSS only (strict CSP).
_SPLASH_CSS = """  #boot-splash { position:fixed; inset:0; z-index:998; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; background:var(--bg); color:var(--muted); font-size:13px; text-align:center; padding:24px; }
  #boot-splash .bs-logo { font-size:20px; font-weight:600; color:var(--text); }
  #boot-splash .bs-spin { width:36px; height:36px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:cl-rot .8s linear infinite; }
  #boot-splash .bs-slow { opacity:0; animation:bs-slow 0s 12s forwards; }
  @keyframes bs-slow { to { opacity:1; } }
  @keyframes cl-rot { to { transform:rotate(360deg); } }
  #login-screen.show ~ #boot-splash, #app.visible ~ #boot-splash { display:none; }
  @media (prefers-reduced-motion: reduce) { #boot-splash .bs-spin { animation-duration:2.4s; } }
"""
s = s.replace("  #login-screen:not(.show) { visibility: hidden; }\n", "  #login-screen:not(.show) { visibility: hidden; }\n" + _SPLASH_CSS, 1)
_SPLASH = '<div id="boot-splash" role="status" aria-live="polite"><div class="bs-logo">🔒 CapitalLens</div><div class="bs-spin"></div><div>Unlocking your private dashboard…</div><div class="bs-slow">Taking longer than usual. Check your connection, then reload.</div></div>\n'
assert "</div><!-- /#app -->" in s
s = s.replace("</div><!-- /#app -->", "</div><!-- /#app -->\n" + _SPLASH, 1)
import re
def _add_sri(m):
    src = m.group(1)
    if src.startswith("http") or "integrity=" in m.group(0): return m.group(0)
    return f'<script src="{src}" integrity="{sri(src)}"></script>'
s = re.sub(r'<script src="([^"]+)"[^>]*></script>', _add_sri, s)      # every local script is pinned by hash (tamper-evident; rebuilt on each change)
(root / "docs/zkapp/index.html").write_text(s)
print("wrote docs/zkapp/index.html", len(s))


# ───────────────────────── production variant ─────────────────────────
DEMO_URL, DEMO_KEY = "https://ggprfdetivzekjxlpvyq.supabase.co", "sb_publishable_hghWk6EbuQPe2nYDgvmU2w_XPgajsHK"
PROD_URL, PROD_KEY = "https://kloqkcxchstfoljpqcbq.supabase.co", "sb_publishable_XXLlyHUZpaiCZkAb6u5NWQ_bePWcmGf"      # publishable keys are meant for browsers
def _prod_text(t):
    t = t.replace(DEMO_URL, PROD_URL).replace(DEMO_KEY, PROD_KEY)
    return re.sub(r"\bzk_(token|email|dk)\b", r"zkp_\1", t)       # separate sign-in storage: a demo unlock can never be picked up by production
def _sri_in(base, rel):
    return "sha384-" + base64.b64encode(hashlib.sha384((base / rel).resolve().read_bytes()).digest()).decode()
def _repin(html, base):
    return re.sub(r'<script src="([^"]+)"[^>]*></script>', lambda m: m.group(0) if m.group(1).startswith("http") else f'<script src="{m.group(1)}" integrity="{_sri_in(base, m.group(1))}"></script>', html)

# 1) dashboards
out = root / "docs/zkapp-prod"; out.mkdir(exist_ok=True)
auth = _prod_text((root / "docs/zkapp/zkapp-auth.js").read_text()).replace("../zk/", "../zk-prod/")
assert PROD_URL in auth and DEMO_URL not in auth and "zk_token" not in auth
(out / "zkapp-auth.js").write_text("// GENERATED by scripts/build_zkapp.py from docs/zkapp/zkapp-auth.js (production project + own storage keys). Edit the source, not this file.\n" + auth)
d = _prod_text(s).replace('href="../zk/"', 'href="../zk-prod/"')
d = d.replace('src="zkapp-tools.js"', 'src="../zkapp/zkapp-tools.js"').replace('src="handler-names.js"', 'src="../zkapp/handler-names.js"')
d = re.sub(r'<script src="([^"]+)" integrity="[^"]*"></script>', r'<script src="\1"></script>', d)
d = d.replace("<title>CapitalLens (private)</title>", "<title>CapitalLens</title>")
d = _repin(d, out)
assert DEMO_URL not in d and "ggprfdetivzekjxlpvyq" not in d
(out / "index.html").write_text(d)

# 2) account page
z = (root / "docs/zk/index.html").read_text()
zjs = _prod_text((root / "docs/zk/zk.js").read_text())
assert PROD_URL in zjs and DEMO_URL not in zjs
(root / "docs/zk-prod").mkdir(exist_ok=True)
(root / "docs/zk-prod/zk.js").write_text("// GENERATED by scripts/build_zkapp.py from docs/zk/zk.js (production project + own storage keys). Edit the source, not this file.\n" + zjs)
z = _prod_text(z).replace("Prototype (demo project). ", "").replace("CapitalLens · private sign-in (prototype)", "CapitalLens · private sign-in")
z = re.sub(r'\s*<h2>Private notes.*?<pre id="notes-raw"></pre>', "", z, flags=re.S)                      # demo-only probe
z = re.sub(r'\s*<div id="purge-box" class="hide">.*?</div>\s*(?=<h2>Trading 212 sync)', "\n    ", z, flags=re.S)     # plaintext deletion is a gated cutover step, not a button
z = re.sub(r'\s*<h2>Create account</h2>.*?<div id="su-err" class="err"></div>', '', z, flags=re.S)   # single-owner for now: no sign-up box (it could only confuse; public sign-up is a later step)
z = z.replace('<h2>Already have an account?</h2>', '<h2>First time on the private version?</h2>').replace('Upgrade it to a private account', 'Set up my private account')
z = z.replace('href="../zkapp/"', 'href="../zkapp-prod/"')
z = re.sub(r'<script src="(?!\.\./|zk\.js)([a-z0-9]+\.js)"', r'<script src="../zk/\1"', z)             # shared modules live in docs/zk/
z = _repin(re.sub(r'(<script src="[^"]+") integrity="[^"]*"', r"\1", z), root / "docs/zk-prod")
assert "btn-signup" not in z and "zk_probe" not in z and "notes-plain" not in z and "purge" not in z.lower() and "ggprfdetivzekjxlpvyq" not in z and PROD_URL in z
(root / "docs/zk-prod/index.html").write_text(z)
print("wrote docs/zkapp-prod, docs/zk-prod")

# ───────────────────────── versioned script URLs ─────────────────────────
# GitHub Pages caches every file separately for ~10 minutes, so right after a deploy a browser can get new HTML with an old script
# (or the reverse) and the integrity hash then blocks that script. Putting the content hash in the URL means a page can only ever
# fetch the exact version it was built with: a different version is a different URL.
def _version_scripts(path):
    h = path.read_text()
    h2 = re.sub(r'<script src="([^"?]+)" integrity="sha384-([^"]+)"></script>',
                lambda m: m.group(0) if m.group(1).startswith("http") else f'<script src="{m.group(1)}?v={hashlib.sha256(m.group(2).encode()).hexdigest()[:12]}" integrity="sha384-{m.group(2)}"></script>', h)
    path.write_text(h2)
    return h2.count("?v=")
for _p in ("docs/zkapp/index.html", "docs/zkapp-prod/index.html", "docs/zk-prod/index.html"):
    print("versioned", _p, _version_scripts(root / _p), "script URLs")
