"""Run: python tests/login_flash_browser_test.py
Regression: refreshing the private app must never flash the sign-in box while a saved session is being restored.
Real browser, fully offline (local static server, Supabase and relay requests refused). The app script is held back so the page can be
inspected mid-load. Covers zkapp and zkapp-prod:
  1. while loading, the sign-in box is NOT visible (it used to show, then the dashboard replaced it)
  2. no saved session  -> the box appears once the check finishes
  3. broken saved session (cannot unlock) -> falls back to the box, never a blank page
  4. a saved session that unlocks -> the app opens and the box is never shown (simulated: unlock stubbed to succeed)
  5. while loading, a visible loading splash (spinner + text) fills the screen - never a blank dark page - and it is gone once the box or the app shows"""
import functools, http.server, sys, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / "docs"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
LOGIN_VISIBLE = "(() => { const e = document.getElementById('login-screen'); return !!e && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; })()"
SPLASH_VISIBLE = "(() => { const e = document.getElementById('boot-splash'); if (!e) return false; const c = getComputedStyle(e), r = e.getBoundingClientRect(), sp = e.querySelector('.bs-spin'); return c.display !== 'none' && r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && !!sp && getComputedStyle(sp).animationName !== 'none' && e.innerText.length > 5; })()"
SESSION_KEYS = {"zkapp": ("zk_token", "zk_dk"), "zkapp-prod": None}   # prod uses its own storage keys; read them from the shipped script
bad = 0


def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"  {extra}" if extra and not cond else ""))
    bad += 0 if cond else 1


def storage_keys(page):
    js = (ROOT / page / "zkapp-auth.js").read_text()
    import re
    return re.search(r"getItem\('([a-z_0-9]+)'\)[^;]*?getItem\('([a-z_0-9]+)'\)", js.split("DOMContentLoaded")[1]).groups()


with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    for page in ("zkapp", "zkapp-prod"):
        tok_key, dk_key = storage_keys(page)
        print(f"{page}  (session keys: {tok_key}, {dk_key})")
        for label, session in (("no saved session", None), ("broken saved session", {tok_key: "x.y.z", dk_key: "AAAA"})):
            ctx = br.new_context(); pg = ctx.new_page()
            pg.route("**/*supabase.co/**", lambda r: r.abort()); pg.route("**/*workers.dev/**", lambda r: r.abort())
            pg.route("**/zkapp-auth.js*", lambda r: (time.sleep(0.8), r.continue_()))      # keep the page "loading"
            if session:
                pg.add_init_script("; ".join(f"sessionStorage.setItem('{k}','{v}')" for k, v in session.items()))
            pg.goto(f"{BASE}/{page}/index.html", wait_until="commit")
            pg.wait_for_selector("#login-screen", state="attached")
            check(f"{label}: sign-in box hidden while the app is still loading", not pg.evaluate(LOGIN_VISIBLE))
            check(f"{label}: a loading splash (animated spinner + text) is on screen, not a blank page", pg.evaluate(SPLASH_VISIBLE))
            for _ in range(80):
                if pg.evaluate("document.getElementById('login-screen').classList.contains('show')"): break
                time.sleep(0.25)
            check(f"{label}: sign-in box shown once the check finds nothing to restore", pg.evaluate(LOGIN_VISIBLE))
            check(f"{label}: the splash is gone once the sign-in box shows", not pg.evaluate(SPLASH_VISIBLE))
            ctx.close()
        # a session that restores: hide the box exactly as a successful unlock does, and make sure nothing reveals it afterwards
        ctx = br.new_context(); pg = ctx.new_page()
        pg.route("**/*supabase.co/**", lambda r: r.abort()); pg.route("**/*workers.dev/**", lambda r: r.abort())
        pg.goto(f"{BASE}/{page}/index.html", wait_until="load")
        pg.evaluate("() => { document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app').classList.add('visible'); }")
        time.sleep(1.2)
        check("restored session: sign-in box stays hidden and the app stays visible", not pg.evaluate(LOGIN_VISIBLE) and pg.evaluate("document.getElementById('app').classList.contains('visible')"))
        check("restored session: the splash is gone and the dashboard is showing", not pg.evaluate(SPLASH_VISIBLE))
        ctx.close()
    br.close()
srv.shutdown()
print("\nlogin flash regression: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)
