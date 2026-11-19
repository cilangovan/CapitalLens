"""Run: python tests/ops_layout_test.py — the internal ops page fits a phone (360/390px, no sideways scroll, tap targets >= 40px),
shows only the sign-in box to a signed-out visitor, and never shows the dashboard or any numbers without a session."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

page_url = (Path(__file__).resolve().parent.parent / "docs/ops/index.html").as_uri()
bad = 0
def fail(m):
    global bad; bad += 1; print("✗ " + m)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for w in (360, 390):
        pg = b.new_page(viewport={"width": w, "height": 800}); pg.goto(page_url)
        r = pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          login: !document.getElementById('login').classList.contains('hide'), app: !document.getElementById('app').classList.contains('hide'),
          mfa: !document.getElementById('mfa').classList.contains('hide'),
          small: [...document.querySelectorAll('button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 40).length })""")
        if r["sw"] > r["cw"]: fail(f"{w}px: sideways scroll ({r['sw']} > {r['cw']})")
        if not r["login"] or r["app"] or r["mfa"]: fail(f"{w}px: signed-out visitor must see only the sign-in box: {r}")
        if r["small"]: fail(f"{w}px: {r['small']} tap target(s) under 40px")
        pg.fill("#pw", "x"); pg.click("#btn-login")
        if "Enter email" not in pg.inner_text("#login-err"): fail(f"{w}px: empty sign-in should ask for an email")
        pg.close()
    b.close()
print("ops page layout and signed-out view OK" if not bad else f"{bad} problem(s)"); sys.exit(1 if bad else 0)
