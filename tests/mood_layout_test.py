"""Run: python tests/mood_layout_test.py
Data (regression, 24 Nov): every country tab fetched nothing unless you held that country (it read the Markets-I-hold cache), and Italy had no tab. Now each tab
fetches its own index (stub /chart): Japan and Italy (FTSEMIB.MI) draw a gauge, a failing index shows a clear message, not an endless spinner.
Market Mood on a phone (regression: the chip strip was clipped, so nothing past Germany could be reached at 360px).
At 360px and 390px, after tapping the Markets trigger: every one of the 10 market chips is fully inside the card, is >= 36px tall, and can be tapped;
tapping Taiwan switches the gauge to Taiwan; no sideways scroll. Real browser, offline (the Alternative.me call is stubbed); loads docs/js/overview.js
with the card markup taken from docs/index.html."""
import functools, http.server, json, re, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "docs"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  {extra}" if extra and not cond else "")); bad += 0 if cond else 1

html = (ROOT / "index.html").read_text()
i = html.index('<div class="card" id="mood-section"'); j = html.index('<div id="stats-strip"', i) if html.find('<div id="stats-strip"', i) > 0 else None
card = html[i:html.index("</div>\n  </div>", i) + len("</div>\n  </div>")] if j is None or j - i > 3000 else html[i:j]
page = f"<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>body{{margin:0;font-family:sans-serif;--bg3:#222;--border:#444;--muted:#999;--accent:#36c;--text:#eee}}.card{{padding:16px;margin:0}}</style><div id=app style='padding:0'>{card}</div><script>var PROXY='{BASE}'</script><script src='/js/overview.js'></script><script>function esc(s){{return String(s).replace(/[<>&]/g,'')}};loadMarketMood()</script>"
(ROOT / "_mood_test.html").write_text(page)
REQ = []
def stub(route):
    u = route.request.url
    if u.endswith("/chart"):
        sym = json.loads(route.request.post_data or "{}").get("symbol"); REQ.append(sym); cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*"}
        if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
        if sym == "^IBEX": return route.fulfill(status=502, headers=cors, content_type="application/json", body="{}")
        return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"points": [[1700000000 + 86400 * k, 100 + k * 0.3] for k in range(80)]}))
    if "alternative.me" in u: return route.fulfill(status=200, headers={"access-control-allow-origin": "*"}, content_type="application/json", body=json.dumps({"data": [{"value": str(40 + k), "timestamp": str(1700000000 + 86400 * k)} for k in range(7)]}))
    return route.continue_()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w in (360, 390):
            print(f"{w}px")
            ctx = b.new_context(viewport={"width": w, "height": 740}, has_touch=True); pg = ctx.new_page(); pg.route("**/*", stub); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE + "/_mood_test.html"); pg.wait_for_selector("#mood-trigger"); pg.wait_for_timeout(300)
            pg.click("#mood-trigger"); pg.wait_for_timeout(700)
            r = pg.evaluate("""() => { const card = document.getElementById('mood-section').getBoundingClientRect();
              return { chips: [...document.querySelectorAll('[data-mmt]')].map(c => { const b = c.getBoundingClientRect(); const cs = getComputedStyle(c);
                 return { k: c.dataset.mmt, l: b.left, r: b.right, t: b.top, h: b.height, vis: +cs.opacity > .9 }; }), cl: card.left, cr: card.right, sw: document.documentElement.scrollWidth, iw: innerWidth } }""")
            NTABS = len(re.findall(r"key:\s*'", (ROOT / "js/overview.js").read_text().split("const MM_TABS")[1].split("const MM_ZONES")[0]))
            check(f"all {NTABS} market chips exist (incl. Italy)", len(r["chips"]) == NTABS and any(c["k"] == "IT" for c in r["chips"]), str(len(r["chips"])))
            check("every chip is fully inside the card (none clipped past the edge)", all(c["l"] >= r["cl"] - 1 and c["r"] <= r["cr"] + 1 for c in r["chips"]), str([c["k"] for c in r["chips"] if c["r"] > r["cr"] + 1]))
            check("every chip is visible once opened", all(c["vis"] for c in r["chips"]))
            check("chips are >= 36px tall", all(c["h"] >= 36 for c in r["chips"]))
            check("no sideways scroll when open", r["sw"] <= r["iw"], str(r))
            pg.click("[data-mmt=TW]"); pg.wait_for_timeout(300)
            check("Taiwan (the last chip) can be tapped and is selected", "Taiwan" in pg.inner_text("#mood-trigger-label") or "TW" in pg.inner_text("#mood-trigger-label"), pg.inner_text("#mood-trigger-label"))
            for key, sym in (("JP", "^N225"), ("IT", "FTSEMIB.MI")):
                pg.click("#mood-trigger"); pg.wait_for_timeout(400); pg.click(f"[data-mmt={key}]")
                try: pg.wait_for_selector("#mood-body svg", timeout=4000); okk = True
                except Exception: okk = False
                check(f"{key}: the tab fetches its own index ({sym}) and draws a gauge, even though no holding is in that country", okk and sym in REQ and "Loading" not in pg.inner_text("#mood-body"), pg.inner_text("#mood-body")[:80])
            pg.click("#mood-trigger"); pg.wait_for_timeout(400); pg.click("[data-mmt=ES]"); pg.wait_for_timeout(1200)
            check("a failing index shows a clear message, not an endless spinner", "Could not load" in pg.inner_text("#mood-body") and "Spain" in pg.inner_text("#mood-body"), pg.inner_text("#mood-body")[:100])
            check("strip collapses back after a pick", pg.evaluate("document.getElementById('mood-tabs').style.flexWrap") == "nowrap")
            check("no script errors", not errs, "; ".join(errs[:2])); ctx.close()
        b.close()
finally:
    (ROOT / "_mood_test.html").unlink(missing_ok=True)
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
