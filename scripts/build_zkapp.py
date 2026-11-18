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
s = s.replace('<span class="pill" style="background:#f59e0b;color:#111">DEMO</span>', '<span class="pill" style="background:#0f766e;color:#fff">PRIVATE</span>')
s = s.replace('<button id="logout-btn" onclick="logout()">Sign out</button>',
  '<button onclick="zkToolsOpen()" style="background:none;border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;margin-right:8px">🔄 Refresh data</button>\n  <button id="logout-btn" onclick="logout()">Sign out</button>')
s = s.replace('<div style="text-align:center;margin-top:6px">\n        \n      </div>', '<div style="text-align:center;margin-top:10px;font-size:12px"><a href="../zk/" style="color:var(--muted)">Create account · recovery · upgrade an existing account</a></div>')
s = s.replace("onkeydown=\"if(event.key==='Enter')doLogin()\"", 'onkeydown="loginKey(event)"')
panel = """
<style>
#zk-tools input[type=password],#zk-tools input[type=text]{background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px 11px;font-size:13px;outline:none;box-sizing:border-box}
#zk-tools input:focus{border-color:var(--accent)}
#zk-tools button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}
#zk-tools button:disabled{opacity:.5;cursor:default}
#zk-tools button[onclick^=zkToolsClose]{background:var(--bg3);color:var(--muted);border:1px solid var(--border)}
</style>
<div id="zk-tools" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;align-items:center;justify-content:center">
  <div style="background:var(--card,#161b22);border:1px solid var(--border);border-radius:12px;padding:20px;width:min(560px,92vw);max-height:90vh;overflow:auto">
    <h3 style="margin:0 0 6px">🔄 Refresh your data</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 12px">Runs in this browser: Trading 212 sync, snapshot, every analysis, then your alert report. Your Trading 212 key is used once and never saved. Leave both fields empty to just re-analyse stored data.</p>
    <input id="zk-key" type="password" placeholder="Trading 212 API key" autocomplete="off" style="width:100%;margin-bottom:6px">
    <input id="zk-sec" type="password" placeholder="Trading 212 API secret" autocomplete="off" style="width:100%;margin-bottom:6px">
    <label style="font-size:12px"><input id="zk-full" type="checkbox"> Full history re-sync</label>
    <div style="margin:10px 0"><button id="zk-run" onclick="zkToolsRun()">Refresh now</button> <button onclick="zkToolsClose()" style="margin-left:8px">Close</button> <span id="zk-status" style="font-size:12px;margin-left:8px"></span></div>
    <pre id="zk-log" style="font-size:11px;max-height:200px;overflow:auto;background:#0004;padding:8px;border-radius:6px;white-space:pre-wrap"></pre>
    <hr style="border-color:var(--border)">
    <p style="font-size:12px;color:var(--muted);margin:6px 0">Phone alerts (ntfy topic, kept encrypted; treat it like a password):</p>
    <input id="zk-topic" type="password" placeholder="ntfy topic" autocomplete="off" style="width:70%"> <button onclick="zkToolsSaveTopic()">Save</button> <span id="zk-topic-msg" style="font-size:12px"></span>
  </div>
</div>
"""
s = s.replace('<script src="../js/api.js"></script>', panel + '<script src="../js/api.js"></script>', 1)
zk = ["../js/zkcrypto.js"] + [f"../zk/{m}.js" for m in ["store", "t212sync", "market", "alertfmt", "symbols", "returns", "valuebuy", "monitor", "analystratings", "piehistory", "profitbooking", "strategy", "holdingdecision", "handlers", "watchlist", "watchlistops", "alertreport", "flow", "notify", "postgrest", "shim", "pipeline"]]
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
z = z.replace('href="../zkapp/"', 'href="../zkapp-prod/"')
z = re.sub(r'<script src="(?!\.\./|zk\.js)([a-z0-9]+\.js)"', r'<script src="../zk/\1"', z)             # shared modules live in docs/zk/
z = _repin(re.sub(r'(<script src="[^"]+") integrity="[^"]*"', r"\1", z), root / "docs/zk-prod")
assert "btn-signup" not in z and "zk_probe" not in z and "notes-plain" not in z and "purge" not in z.lower() and "ggprfdetivzekjxlpvyq" not in z and PROD_URL in z
(root / "docs/zk-prod/index.html").write_text(z)
print("wrote docs/zkapp-prod, docs/zk-prod")
