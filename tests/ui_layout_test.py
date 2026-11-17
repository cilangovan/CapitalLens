#!/usr/bin/env python3
"""
Mobile layout test: nothing on any dashboard may be wider than a phone screen.

Opens the real dashboard (served locally from docs/) at phone widths, with the live data the
dashboard reads (the worker's public read-only table endpoints). Then it walks every tab, every
expandable section, the positions pop-up (whole account, each pie, untagged holdings, single
holdings) and the watchlist drill-down. For each view it checks:
  • the page never scrolls sideways (document wider than the screen), and
  • no visible element sticks out past the screen edge, unless it sits inside a container that is
    meant to scroll sideways (overflow-x: auto/scroll/hidden) and that container itself fits.
It also fails on uncaught JavaScript errors.

Data: the worker only serves signed-in sessions, so the test answers the dashboard's read requests
itself, straight from Supabase with the service key (SUPABASE_URL + SUPABASE_SERVICE_KEY, as in CI),
using exactly the same table + query the page asked for. Every POST (alerts actions, watchlist
add/remove, settings, chart/search) is answered by a local stub — nothing is ever changed. Output is
element selectors and pixel widths only — no portfolio values.

XSS pass (POISON): every text value in every response gets an attack payload appended
(<img onerror=…>, quotes, backticks). The run fails if any payload executes or becomes a real element.

Usage:
  python tests/ui_layout_test.py                 # serves docs/ on a free port
  BASE_URL=http://localhost:8000 python tests/ui_layout_test.py
  WIDTHS=360,390 python tests/ui_layout_test.py
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SUPA_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPA_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY", "")
READABLE = {"alerts", "analyst_ratings", "app_settings", "dividends", "holding_decisions", "institutional_flow_reports",
            "pie_history", "portfolio_snapshots", "portfolio_snapshots_all", "positions", "positions_all", "profit_booking",
            "profit_booking_summary", "realised_pnl", "returns_summary", "strategy_recommendations", "value_buy_scores",
            "watchlist", "watchlist_analysis"}
PAYLOAD = """<img src=x onerror="window.__xss=(window.__xss||0)+1">'"`<script>window.__xss=(window.__xss||0)+1</script>"""
CORS_H = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS"}


def poison(v):
    """Append the attack payload to every text value except dates and number-like strings."""
    import re
    if isinstance(v, str):
        return v if re.fullmatch(r"[\d\-:.TZ+ ]*", v) else v + PAYLOAD
    if isinstance(v, list):
        return [poison(x) for x in v]
    if isinstance(v, dict):
        return {k: poison(x) for k, x in v.items()}
    return v
WIDTHS = [int(w) for w in os.environ.get("WIDTHS", "360,390").split(",")]
TIMEOUT = 25_000

# Finds the outermost elements that stick out past the right/left screen edge and aren't clipped
# by a sideways-scrolling container. Returns [{sel, left, right, width}].
MEASURE_JS = r"""
(rootSel) => {
  const W = document.documentElement.clientWidth;
  const root = document.querySelector(rootSel) || document.body;
  const visible = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const clipped = el => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (/(auto|scroll|hidden|clip)/.test(ox)) {
        const r = p.getBoundingClientRect();
        return r.right <= W + 1 && r.left >= -1;       // a fitting scroller/clipper contains it
      }
    }
    return false;
  };
  const sticksOut = el => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return (r.right > W + 1 || r.left < -1) && !clipped(el);
  };
  const bad = new Set([root, ...root.querySelectorAll('*')].filter(sticksOut));
  const path = el => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 5; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + e.id; parts.unshift(s); break; }
      const cls = [...e.classList].filter(c => !/^(green|red|yellow|active|open|show)$/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const out = [];
  bad.forEach(el => {
    if (el.parentElement && bad.has(el.parentElement)) return;   // report the outermost only
    const r = el.getBoundingClientRect();
    out.push({ sel: path(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  });
  return { screen: W, page: document.documentElement.scrollWidth, items: out.slice(0, 12) };
}
"""

IDLE_JS = r"""
(rootSel) => {
  const root = document.querySelector(rootSel) || document.body;
  return ![...root.querySelectorAll('.loading')].some(el => el.offsetParent !== null && /Loading/i.test(el.textContent));
}
"""


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def supa_get(table, query):
    import urllib.request, urllib.error
    req = urllib.request.Request(f"{SUPA_URL}/rest/v1/{table}" + (f"?{query}" if query else ""),
                                 headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def make_handler(api, poisoned):
    def handler(route):
        try:
            return _handle(route)
        except Exception as e:                      # never let a request fall through to the real worker
            print(f"  ! handler error for {route.request.url.split('?')[0][-50:]}: {e.__class__.__name__}: {str(e)[:120]}")
            return route.fulfill(status=502, headers=CORS_H, content_type="application/json", body='{"error":"test handler"}')

    def _handle(route):
        req = route.request
        if req.method == "OPTIONS":
            return route.fulfill(status=204, headers=CORS_H)
        if req.method == "GET":
            path = req.url.split("workers.dev", 1)[-1]
            table, _, query = path.lstrip("/").partition("?")
            if table not in READABLE:
                return route.fulfill(status=404, headers=CORS_H, content_type="application/json", body='{"error":"Not found"}')
            status, body = supa_get(table, query)
            if poisoned and status == 200:
                body = json.dumps(poison(json.loads(body)))
            return route.fulfill(status=status, headers=CORS_H, content_type="application/json", body=body)
        return stub_post(route, poisoned)
    return handler


def stub_post(route, poisoned=False):
    """Every write / authenticated call is answered locally — the test never changes anything."""
    req = route.request
    path = req.url.split("workers.dev", 1)[-1]
    if path.startswith("/search"):
        body = {"results": []}
    elif path.startswith("/chart"):
        now = int(time.time())
        body = {"meta": {"currency": "USD"}, "points": [{"t": now - (60 - i) * 300, "c": 100 + (i % 7) - 3} for i in range(60)]}
    else:
        body = {"ok": True, "updated": 0}
    route.fulfill(status=200, headers=CORS_H, content_type="application/json", body=json.dumps(poison(body) if poisoned else body))


def scenarios(page):
    """(name, root selector, js to run before measuring). Built from what the live data contains."""
    tabs = ["overview", "heatmap", "positions", "analyst", "strategy", "profit", "returns", "watchlist", "alerts"]
    out = [(f"tab:{t}", f"#{t}", f"showTab('{t}', document.querySelector(\"nav button[onclick*=\\\"'{t}'\\\"]\"))") for t in tabs]
    out += [
        ("positions:all-expanded", "#positions",
         "showTab('positions', document.querySelector(\"nav button[onclick*=\\\"'positions'\\\"]\")); "
         "document.querySelectorAll('#positions .pie-body').forEach(b => b.classList.add('open'))"),
        ("profit:all-expanded", "#profit",
         "showTab('profit', document.querySelector(\"nav button[onclick*=\\\"'profit'\\\"]\")); "
         "document.querySelectorAll('[id^=pb-body-]').forEach(b => b.classList.add('open'))"),
    ]
    for k in ("risk", "trims", "actions", "holdings", "regime"):
        out.append((f"profit:popup:{k}", "#pb-modal",
                    "showTab('profit', document.querySelector(\"nav button[onclick*=\\\"'profit'\\\"]\")); "
                    f"setTimeout(() => {{ pbClose(); pbInfo('{k}'); }}, 50)"))
    out.append(("profit:popup-closed", "#profit", "pbClose()"))
    for cat in ("stock", "commodity", "crypto"):
        out.append((f"watchlist:{cat}:expanded", "#watchlist",
                    f"showTab('watchlist', document.querySelector(\"nav button[onclick*=\\\"'watchlist'\\\"]\")); "
                    f"wlSetCat('{cat}'); WL.items.forEach(i => {{ WL.expanded.add(i.ticker); WL.open.add(i.ticker); }}); renderWatchlist()"))
    for view in ("inbox", "archived", "cleared"):
        out.append((f"alerts:{view}:opened", "#alerts",
                    f"showTab('alerts', document.querySelector(\"nav button[onclick*=\\\"'alerts'\\\"]\")); "
                    f"alertsView('{view}'); ALERTS.items.forEach(a => ALERTS.open.add(a.id)); renderAlerts()"))

    # positions pop-up: whole account, each pie, untagged, and single holdings
    page.evaluate("showTab('positions', document.querySelector(\"nav button[onclick*=\\\"'positions'\\\"]\"))")
    page.wait_for_function(IDLE_JS, arg="#positions", timeout=TIMEOUT)
    info = page.evaluate("""async () => {
      const s = (await api('portfolio_snapshots', '?select=*&order=created_at.desc&limit=1'))[0] || {};
      const pies = (s.raw?.pies || []).filter(p => (p.instruments || []).some(i => +i.qty > 0)).map(p => p.name);
      const first = (s.raw?.pies || []).flatMap(p => (p.instruments || []).filter(i => +i.qty > 0).map(i => [p.name, i.ticker]))[0];
      return { pies, first };
    }""")
    keys = ["__ALL__", "__DIRECT__"] + info["pies"]
    for k in keys:
        for rng in ("1d", "1y"):
            out.append((f"popup:{k}:{rng}", "#pd", f"pdClose && pdClose(); pdOpen({json.dumps(k)}).then(() => {{ PD.range='{rng}'; pdRender(); }})"))
        if not k.startswith("__") or k == "__ALL__":
            out.append((f"popup:{k}:holdings", "#pd", f"pdClose && pdClose(); pdOpen({json.dumps(k)}).then(() => {{ PD.tab='holdings'; pdRender(); }})"))
    if info.get("first"):
        pie, t = info["first"]
        out.append((f"popup:holding", "#pd", f"pdClose && pdClose(); pdOpen({json.dumps(pie)}, {json.dumps(t)})"))
        out.append((f"popup:holding-in-all", "#pd", f"pdClose && pdClose(); pdOpen('__ALL__', {json.dumps(t)})"))
    out.append(("popup:untagged-holding", "#pd",
                "pdClose && pdClose(); pdOpen('__DIRECT__').then(() => { const h = pdLive(PD.snapObj, '__DIRECT__').holdings[0]; if (h) return pdOpen('__DIRECT__', h.ticker); })"))
    # watchlist drill-down (first bookmarked item of each category)
    out.append(("drilldown:watchlist", "#dd",
                "pdClose && pdClose(); showTab('watchlist', document.querySelector(\"nav button[onclick*=\\\"'watchlist'\\\"]\")); "
                "if (WL.items[0]) wlOpenDetail(null, WL.items[0].ticker)"))
    return out


def run_width(browser, base, width, poisoned=False):
    # bypass_csp: the page's Content-Security-Policy (correctly) blocks the test tool's own injected checks.
    # The XSS pass still tests the real defence — defuse() — since the CSP allows inline handlers either way.
    ctx = browser.new_context(viewport={"width": width, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True, bypass_csp=True)
    # a signed-in session (token is never checked for reads; every write is stubbed)
    ctx.add_init_script("try { sessionStorage.setItem('t212_auth','master'); sessionStorage.setItem('t212_token','ui-test'); } catch(e) {}")
    ctx.route(lambda url: "workers.dev" in url, make_handler(ctx.request, poisoned))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:200]))
    page.on("dialog", lambda d: d.dismiss())
    failed, reqs = [], {}
    page.on("request", lambda r: reqs.__setitem__(r.url, "pending") if "workers.dev" in r.url or "cdnjs" in r.url else None)
    page.on("requestfinished", lambda r: reqs.__setitem__(r.url, "done"))
    page.on("requestfailed", lambda r: failed.append(f"{r.method} {r.url.split('?')[0][-80:]} ({r.failure})"))
    page.on("response", lambda r: failed.append(f"{r.request.method} {r.url.split('?')[0][-80:]} → {r.status}") if r.status >= 400 else None)
    page.on("console", lambda m: failed.append(f"console.{m.type}: {m.text[:160]}") if m.type == "error" else None)
    try:
        page.goto(base + "/index.html", wait_until="networkidle", timeout=60_000)
    except Exception:
        print("page never settled. errors:", errors[:5], "\nrequests:", failed[:15], "\npending:",
              [u.split('?')[0][-60:] for u, st in reqs.items() if st == "pending"][:15])
        raise
    try:
        page.wait_for_function(IDLE_JS, arg="#overview", timeout=TIMEOUT)
    except Exception:
        left = page.evaluate("[...document.querySelectorAll('.loading')].filter(e => e.offsetParent).map(e => (e.closest('[id]')||{}).id + ': ' + e.textContent.trim().slice(0,80))")
        print("overview didn't finish loading. Still loading:", left, "\nerrors:", errors, "\nrequests:", failed[:20], "\nworker/cdn:", [(u.split('?')[0][-60:], st) for u, st in reqs.items()][:30])
        raise

    failures, checked = [], 0
    for name, root, js in scenarios(page):
        try:
            page.evaluate(f"(async () => {{ {js} }})()")
            page.wait_for_load_state("networkidle", timeout=TIMEOUT)
            page.wait_for_function(IDLE_JS, arg=root, timeout=TIMEOUT)
            page.wait_for_timeout(250)        # let charts draw
        except Exception as e:
            left = page.evaluate("(r) => [...(document.querySelector(r)||document.body).querySelectorAll('.loading')].filter(e => e.offsetParent).map(e => e.textContent.trim().slice(0,60))", root)
            failures.append((name, f"didn't finish loading: {str(e).splitlines()[0][:120]} · still showing {left[:3]}", []))
            continue
        checked += 1
        if poisoned:
            x = page.evaluate("() => ({ ran: window.__xss || 0, nodes: document.querySelectorAll('img[src=\"x\"], script:not([src])').length })")
            if x["ran"] or x["nodes"]:
                failures.append((name, f"XSS: payload executed {x['ran']}× · {x['nodes']} injected element(s)", []))
            continue
        m = page.evaluate(MEASURE_JS, root)
        if m["items"] or m["page"] > m["screen"] + 1:
            failures.append((name, f"page {m['page']}px wide on a {m['screen']}px screen", m["items"]))
    # close pop-ups before the next width
    page.evaluate("try { pdClose(); ddClose(); } catch (e) {}")
    ctx.close()
    return checked, failures, errors


def main():
    base = os.environ.get("BASE_URL")
    server = None
    if not (SUPA_URL and SUPA_KEY):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (the test reads the dashboard data straight from Supabase).")
    if not base:
        port = free_port()
        server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                                  cwd=ROOT / "docs", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"
        time.sleep(1)
    ok = True
    summary = ["## Mobile layout test", ""]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            runs = [(w, False) for w in WIDTHS] + ([(WIDTHS[-1], True)] if os.environ.get("POISON", "1") != "0" else [])
            for w, poisoned in runs:
                checked, failures, errors = run_width(browser, base, w, poisoned)
                tag = f"{w}px · XSS attack pass" if poisoned else f"{w}px"
                if poisoned:
                    errors = []          # poisoned data legitimately breaks some views — only execution matters here
                print(f"\n[{tag}] {checked} views checked · {len(failures)} problems · {len(set(errors))} JS errors")
                summary.append(f"**{tag}** — {checked} views · {len(failures)} problems · {len(set(errors))} JS errors")
                for name, why, items in failures:
                    ok = False
                    print(f"  ✗ {name}: {why}")
                    summary.append(f"- ✗ `{name}`: {why}")
                    for it in items:
                        print(f"      {it['sel']}  (x {it['left']}→{it['right']}, {it['width']}px)")
                        summary.append(f"  - `{it['sel']}` x {it['left']}→{it['right']} ({it['width']}px)")
                for e in sorted(set(errors)):
                    ok = False
                    print(f"  ✗ JS error: {e}")
                    summary.append(f"- ✗ JS error: `{e}`")
            browser.close()
    finally:
        if server:
            server.terminate()
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text("\n".join(summary) + "\n")
    print("\nPASS — every view fits the screen" if ok else "\nFAIL — see the views above")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
