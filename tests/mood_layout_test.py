"""Run: python tests/mood_layout_test.py
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
page = f"<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><style>body{{margin:0;font-family:sans-serif;--bg3:#222;--border:#444;--muted:#999;--accent:#36c;--text:#eee}}.card{{padding:16px;margin:0}}</style><div id=app style='padding:0'>{card}</div><script src='/js/overview.js'></script><script>function esc(s){{return String(s).replace(/[<>&]/g,'')}};loadMarketMood()</script>"
(ROOT / "_mood_test.html").write_text(page)
def stub(route):
    u = route.request.url
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
            check("all 10 market chips exist", len(r["chips"]) == 10, str(len(r["chips"])))
            check("every chip is fully inside the card (none clipped past the edge)", all(c["l"] >= r["cl"] - 1 and c["r"] <= r["cr"] + 1 for c in r["chips"]), str([c["k"] for c in r["chips"] if c["r"] > r["cr"] + 1]))
            check("every chip is visible once opened", all(c["vis"] for c in r["chips"]))
            check("chips are >= 36px tall", all(c["h"] >= 36 for c in r["chips"]))
            check("no sideways scroll when open", r["sw"] <= r["iw"], str(r))
            pg.click("[data-mmt=TW]"); pg.wait_for_timeout(300)
            check("Taiwan (the last chip) can be tapped and is selected", "Taiwan" in pg.inner_text("#mood-trigger-label") or "TW" in pg.inner_text("#mood-trigger-label"), pg.inner_text("#mood-trigger-label"))
            check("strip collapses back after a pick", pg.evaluate("document.getElementById('mood-tabs').style.flexWrap") == "nowrap")
            check("no script errors", not errs, "; ".join(errs[:2])); ctx.close()
        b.close()
finally:
    (ROOT / "_mood_test.html").unlink(missing_ok=True)
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
