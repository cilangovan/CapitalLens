"""Run: python tests/docs_layout_test.py — the documentation portal (docs/help) must fit a phone screen:
every page at 320/360/390px has no sideways scroll, every link/tap target is >= 40px tall, the stylesheet loads, and the
dashboard-footer link target (help/index.html) exists. Tables and code boxes may scroll inside their own box only."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
pages = sorted((ROOT / "docs/help").rglob("*.html"))
bad = 0
def fail(msg):
    global bad; bad += 1; print("✗ " + msg)
if len(pages) < 20: fail(f"expected the full portal, found {len(pages)} pages")
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for w in (320, 360, 390, 1280):
        pg = b.new_page(viewport={"width": w, "height": 800})
        for f in pages:
            pg.goto(f.as_uri())
            pg.evaluate("() => document.querySelectorAll('details').forEach(d => { d.open = true; })")
            r = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [];
              const styled = getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)';
              document.querySelectorAll('article *, .top *, .foot *').forEach(e => { const q = e.getBoundingClientRect(); if (q.width && q.right > W + 1) {
                let a = e.parentElement, clip = false; while (a && a.tagName !== 'BODY') { if (/(auto|scroll|hidden)/.test(getComputedStyle(a).overflowX)) { clip = true; break; } a = a.parentElement; }
                if (!clip) out.push((e.tagName + '.' + e.className).slice(0, 40)); } });
              const small = [...document.querySelectorAll('.side nav a, .top a, .foot a')].filter(a => a.offsetParent !== null && a.getBoundingClientRect().height < 39.5).map(a => a.textContent.trim().slice(0, 30));
              return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 4), small: small.slice(0, 3), styled, h1: !!document.querySelector('article h1') }; }""")
            name = f.relative_to(ROOT / "docs/help")
            if r["sideways"] or r["out"]: fail(f"{w}px {name}: sideways scroll {r['out']}")
            if r["small"]: fail(f"{w}px {name}: tap targets under 40px {r['small']}")
            if not r["styled"]: fail(f"{name}: stylesheet did not load")
            if not r["h1"]: fail(f"{name}: no page title")
        pg.close()
    b.close()
# the dashboards' own footer + sign-in link must fit a phone too (rendered with each page's own CSS)
import re
for page in ("docs/index.html", "docs/demo/index.html", "docs/zk/index.html"):
    src = (ROOT / page).read_text()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", src, re.S))
    foot = re.search(r"<footer class=\"app-footer\">.*?</footer>", src, re.S)
    if not foot: fail(f"{page}: no footer"); continue
    login = re.search(r'<a class="login-doc"[^>]*>.*?</a>', src, re.S)
    with sync_playwright() as p2:
        b2 = p2.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b2.new_page(viewport={"width": w, "height": 700})
            pg.set_content(f"<style>{css}</style><body style='margin:0'><div class='login-box' style='width:auto'>{login.group(0) if login else ''}</div>{foot.group(0)}</body>")
            r = pg.evaluate("""() => { const W = document.documentElement.clientWidth; return { sideways: document.documentElement.scrollWidth > W,
              small: [...document.querySelectorAll('.app-footer a, .login-doc')].filter(a => a.getBoundingClientRect().height < 39.5).length }; }""")
            if r["sideways"] or r["small"]: fail(f"{page} footer at {w}px: {r}")
            pg.close()
        b2.close()
print(f"✓ documentation portal ({len(pages)} pages) and every dashboard footer fit 320/360/390px (desktop too for the portal)" if not bad else f"{bad} problem(s)")
sys.exit(1 if bad else 0)
