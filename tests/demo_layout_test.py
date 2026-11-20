"""Run: python tests/demo_layout_test.py
Epic #32, demo sign-in on a phone: at 360px and 390px the "Try the demo" button, the temporary-credentials card (long password, Copy buttons)
and the in-app countdown badge / banner / 5-minute warning must fit with no sideways scroll, with tap targets >= 40px.
Real browser, fully offline: the demo-access function and Supabase are stubbed with route handlers."""
import functools, http.server, json, threading
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
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  {extra}" if extra and not cond else ""))
    bad += 0 if cond else 1

CREDS = {"email": "demo-gvk32599sy@demo.invalid", "password": "DDXQ-cxxz-6295-utds", "expires_at": "2099-01-01T00:00:00Z", "ttl_minutes": 60, "idle_minutes": 45}
def stub(route):
    u = route.request.url
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*"}
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
    if "/functions/v1/demo-access" in u: return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps(CREDS))
    if "/auth/v1/token" in u: return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"access_token": "t", "user": {"id": "u"}}))
    if "/rpc/demo_touch" in u: return route.fulfill(status=200, headers=cors, content_type="application/json", body=json.dumps({"demo": True, "active": True, "seconds_left": 240}))
    if "supabase.co" in u: return route.fulfill(status=200, headers=cors, content_type="application/json", body="[]")
    return route.continue_()

with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (360, 390):
        print(f"{w}px")
        ctx = b.new_context(viewport={"width": w, "height": 740}, has_touch=True)
        pg = ctx.new_page(); pg.route("**/*", stub); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "/demo/index.html"); pg.wait_for_selector("#demo-try-btn")
        check("no stored owner email is pre-filled in the sign-in box", pg.input_value("#login-user") == "")
        check("Try the demo button is a >= 40px tap target", pg.eval_on_selector("#demo-try-btn", "e => e.getBoundingClientRect().height") >= 40)
        check("sign-in screen has no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        pg.click("#demo-try-btn"); pg.wait_for_selector("#demo-creds", state="visible")
        check("credentials card shows the temporary login", CREDS["password"] in pg.inner_text("#demo-creds") and CREDS["email"] in pg.inner_text("#demo-creds"))
        check("credentials card fits with no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('#demo-creds').scrollWidth <= document.querySelector('.login-box').clientWidth + 1"))
        check("Copy buttons are >= 40px tap targets", all(h >= 40 for h in pg.eval_on_selector_all(".demo-copy", "els => els.map(e => e.getBoundingClientRect().height)")))
        check("normal sign-in form is hidden while the card shows", not pg.is_visible("#login-form"))
        pg.click("text=Open the demo"); pg.wait_for_selector("#app.visible"); pg.wait_for_selector("#demo-badge", state="visible")
        pg.wait_for_timeout(1500)
        check("countdown badge shows mm:ss", pg.inner_text("#demo-badge").startswith("⏱ 03:") or pg.inner_text("#demo-badge").startswith("⏱ 04:"), pg.inner_text("#demo-badge"))
        check("demo banner + 5-minute warning visible (240s left)", pg.is_visible("#demo-banner") and pg.is_visible("#demo-warn"))
        check("app header/banner has no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        check("Show login button is >= 40px", pg.eval_on_selector(".demo-banner button", "e => e.getBoundingClientRect().height") >= 40)
        check("no script errors", not errs, "; ".join(errs[:2]))
        ctx.close()
    b.close()
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
