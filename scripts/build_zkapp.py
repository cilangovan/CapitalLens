#!/usr/bin/env python3
"""Generates docs/zkapp/index.html from docs/demo/index.html: same dashboards, zero-knowledge shell instead of the demo shell."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
s = (root / "docs/demo/index.html").read_text()
s = s.replace("<title>CapitalLens Demo</title>", "<title>CapitalLens (private)</title>")
s = s.replace("connect-src 'self' https://ggprfdetivzekjxlpvyq.supabase.co;", "connect-src 'self' https://ggprfdetivzekjxlpvyq.supabase.co https://capitallens-relay.itsme-daf.workers.dev https://ntfy.sh;")
s = s.replace("<h2>🌐 CapitalLens Demo</h2>", "<h2>🔒 CapitalLens</h2>").replace("Demo portfolio — synthetic data", "Private portfolio dashboard — end-to-end encrypted")
s = s.replace('value="demo@capitallens.test" ', "")
s = s.replace('<span class="pill" style="background:#f59e0b;color:#111">DEMO</span>', '<span class="pill" style="background:#0f766e;color:#fff">PRIVATE</span>')
s = s.replace('<button id="logout-btn" onclick="logout()">Sign out</button>',
  '<button onclick="zkToolsOpen()" style="background:none;border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px 10px;border-radius:6px;cursor:pointer;margin-right:8px">🔄 Refresh data</button>\n  <button id="logout-btn" onclick="logout()">Sign out</button>')
s = s.replace('<div style="text-align:center;margin-top:6px">\n        \n      </div>', '<div style="text-align:center;margin-top:10px;font-size:12px"><a href="../zk/" style="color:var(--muted)">Create account · recovery · upgrade an existing account</a></div>')
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
zk = ["../js/zkcrypto.js"] + [f"../zk/{m}.js" for m in ["store", "t212sync", "market", "alertfmt", "symbols", "returns", "valuebuy", "monitor", "analystratings", "piehistory", "profitbooking", "strategy", "holdingdecision", "watchlist", "watchlistops", "alertreport", "flow", "notify", "postgrest", "shim", "pipeline"]]
tags = "\n".join(f'<script src="{p}"></script>' for p in zk)
s = s.replace('<script src="demo-shim.js"></script>\n<script src="demo-auth.js"></script>', tags + '\n<script src="zkapp-auth.js"></script>\n<script src="zkapp-tools.js"></script>')
assert "demo-auth" not in s and "zkapp-auth.js" in s
(root / "docs/zkapp/index.html").write_text(s)
print("wrote docs/zkapp/index.html", len(s))
