#!/usr/bin/env python3
"""
Security checks — run on every change and daily. Fails (exit 1) on any problem.

Code checks (no network):
  • the dashboard loads no third-party JavaScript: every <script src> is local, vendored files match their
    pinned SHA-384 integrity hash, and a Content-Security-Policy limits scripts to this site and data
    connections to the dashboard's own worker
  • no eval / new Function / document.write / string setTimeout in front-end code
  • every worker response passes through the central defuse() sanitiser (js/api.js) — XSS defence
  • the worker: no debug endpoint, no wildcard CORS, reads need a session, the login table and raw
    Trading 212 history are never readable, passwords use salted PBKDF2

Live probes (skipped if the network is unavailable) — acting as an outsider with no session:
  • worker refuses every data table (401), never serves dashboard_auth / t212_* (404), sends no CORS
    permission to other websites, has no /auth/debug
  • Supabase with the public anon key returns no rows from any dashboard table (needs SUPABASE_URL +
    SUPABASE_ANON_KEY)

Usage: python tests/security_check.py
"""

import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER_URL = os.environ.get("WORKER_URL", "https://t212-proxy.itsme-daf.workers.dev")
DASH_TABLES = ["positions", "portfolio_snapshots", "portfolio_snapshots_all", "realised_pnl", "dividends", "alerts",
               "returns_summary", "pie_history", "watchlist", "profit_booking", "strategy_recommendations"]
PRIVATE = ["dashboard_auth", "t212_orders", "t212_transactions", "t212_dividends", "t212_sync_state"]

problems, passes = [], []


def check(ok, what):
    (passes if ok else problems).append(what)
    print(("  ✓ " if ok else "  ✗ ") + what)


def code_checks():
    print("Code")
    html = (ROOT / "docs/index.html").read_text()
    srcs = re.findall(r'<script[^>]*\ssrc="([^"]+)"[^>]*>', html)
    remote = [s for s in srcs if re.match(r"(https?:)?//", s)]
    check(not remote, f"no third-party scripts ({len(srcs)} local)" if not remote else f"third-party scripts loaded: {remote}")
    for m in re.finditer(r'<script[^>]*\ssrc="(vendor/[^"]+)"[^>]*integrity="([^"]+)"', html):
        f = ROOT / "docs" / m.group(1)
        actual = "sha384-" + base64.b64encode(hashlib.sha384(f.read_bytes()).digest()).decode()
        check(actual == m.group(2), f"{m.group(1)} matches its pinned integrity hash")
    vend = [s for s in srcs if s.startswith("vendor/")]
    pinned = re.findall(r'<script[^>]*\ssrc="vendor/[^"]+"[^>]*integrity=', html)
    check(len(vend) == len(pinned), "every vendored script is integrity-pinned")
    csp = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', html)
    check(bool(csp), "Content-Security-Policy present")
    if csp:
        pol = dict((d.split(" ", 1) + [""])[:2] for d in [x.strip() for x in csp.group(1).split(";") if x.strip()])
        check("http" not in pol.get("script-src", "x") and "*" not in pol.get("script-src", "*"), "CSP: scripts only from this site")
        conn = pol.get("connect-src", "*").split()
        check("*" not in conn and all(c in ("'self'",) or c.startswith("https://t212-proxy.") for c in conn),
              "CSP: data can only be sent to this site / the dashboard worker")
        check(pol.get("default-src") == "'none'" and pol.get("object-src") == "'none'" and pol.get("base-uri") == "'none'",
              "CSP: default-src, object-src and base-uri locked to 'none'")
        check("http" not in pol.get("img-src", ""), "CSP: no remote images (blocks image-beacon data theft)")
    js = {p.name: p.read_text() for p in (ROOT / "docs/js").glob("*.js")}
    bad = [f"{n}: {m.group(0)}" for n, t in js.items() for m in re.finditer(r"\beval\s*\(|new\s+Function\s*\(|document\.write|setTimeout\(\s*['\"`]|setInterval\(\s*['\"`]", t)]
    check(not bad, "no eval / new Function / document.write / string timers" if not bad else f"dangerous calls: {bad}")
    api = js.get("api.js", "")
    check("function defuse" in api and "Response.prototype.json" in api, "all worker responses pass through defuse() (XSS defence)")
    check("Authorization" in api and "SESSION_TOKEN" in api, "dashboard sends the session with every worker request")

    print("Worker")
    w = (ROOT / "cloudflare-worker/worker.js").read_text()
    check("/auth/debug" not in w, "no /auth/debug endpoint")
    check(not re.search(r"Allow-Origin['\"]?\s*:\s*['\"]\*", w), "no wildcard CORS")
    m = re.search(r"const READABLE = new Set\(\[(.*?)\]\)", w, re.S)
    readable = set(re.findall(r"'([a-z_]+)'", m.group(1))) if m else set()
    check(bool(readable) and not (readable & set(PRIVATE)), "login table and raw Trading 212 history are never readable")
    check("verifySession(env, bearer(request))" in w, "table reads require a valid session")
    check("PBKDF2" in w and "hashPassword(newPassword)" in w, "passwords stored with salted PBKDF2")
    check("locked_until" in w, "login lockout after repeated failures")
    check("new Headers(request.headers)" not in w, "client headers are never forwarded to the database")


UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 t212-security-check"


def http(url, method="GET", headers=None):
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, dict(r.headers), r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")


def live_checks():
    print("Live (as an outsider)")
    try:
        http(WORKER_URL + "/positions")
    except Exception as e:
        print(f"  • network unavailable — live probes skipped ({e.__class__.__name__})")
        return
    for t in DASH_TABLES:
        st, _, body = http(f"{WORKER_URL}/{t}?select=*&limit=1")
        check(st == 401, f"worker refuses /{t} without a session (got {st})")
    st, _, _ = http(f"{WORKER_URL}/positions?select=*&limit=1", headers={"Authorization": "Bearer not-a-real-session"})
    check(st == 401, f"worker refuses a fake session (got {st})")
    for t in PRIVATE + ["auth/debug", "rpc/archive_portfolio_history"]:
        st, _, _ = http(f"{WORKER_URL}/{t}?select=*&limit=1")
        check(st == 404, f"worker never serves /{t} (got {st})")
    # the dashboard's own site must still be able to sign in (browser pre-check + login call)
    site = "https://cilangovan.github.io"
    st, h, body = http(f"{WORKER_URL}/auth/login", method="OPTIONS", headers={
        "Origin": site, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    hl = {k.lower(): v for k, v in h.items()}
    print(f"    preflight → {st} · allow-origin={hl.get('access-control-allow-origin')!r} · allow-headers={hl.get('access-control-allow-headers')!r} · body={body[:120]!r}")
    check(st in (200, 204) and hl.get("access-control-allow-origin") == site, f"dashboard site passes the browser pre-check for sign-in (got {st})")
    req = urllib.request.Request(f"{WORKER_URL}/auth/login", method="POST", data=json.dumps({"username": "no-such-user-ci", "password": "x"}).encode(),
                                 headers={"User-Agent": UA, "Origin": site, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            st, h, body = r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        st, h, body = e.code, dict(e.headers), e.read().decode()
    hl = {k.lower(): v for k, v in h.items()}
    print(f"    login (unknown user) → {st} · allow-origin={hl.get('access-control-allow-origin')!r} · body={body[:160]!r}")
    check(st == 401 and hl.get("access-control-allow-origin") == site, f"sign-in answers the dashboard site (got {st})")
    st, h, _ = http(f"{WORKER_URL}/positions", headers={"Origin": "https://evil.example"})
    acao = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    check(acao is None, f"no CORS permission for other websites (got {acao!r})")
    st, _, _ = http(f"{WORKER_URL}/positions", method="DELETE")
    check(st in (404, 405), f"worker rejects writes (DELETE → {st})")

    url, anon = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_ANON_KEY", "")
    if url and anon:
        for t in DASH_TABLES + PRIVATE:
            st, _, body = http(f"{url}/rest/v1/{t}?select=*&limit=1", headers={"apikey": anon, "Authorization": f"Bearer {anon}"})
            rows = json.loads(body) if st == 200 and body.strip().startswith("[") else []
            check(not rows, f"database: public anon key reads nothing from {t} (status {st}, {len(rows)} rows)")
    else:
        print("  • SUPABASE_URL / SUPABASE_ANON_KEY not set — direct database probe skipped")


if __name__ == "__main__":
    code_checks()
    if os.environ.get("LIVE", "1") != "0":
        live_checks()
    print(f"\n{len(passes)} passed · {len(problems)} failed")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text("## Security checks\n\n" + "\n".join(
            [f"- ✗ {p}" for p in problems] + [f"- ✓ {p}" for p in passes]) + "\n")
    sys.exit(1 if problems else 0)
