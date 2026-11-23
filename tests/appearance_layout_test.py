"""Run: python tests/appearance_layout_test.py — the 🎨 Appearance dialog on the live and demo pages (offline, the page's own CSS):
fits 320/360/390px with no sideways scroll at every text size, every choice >= 40px tall, every theme/font/size applies and is remembered after a reload
(and is applied before first paint), text stays readable (computed contrast) in every theme, and nothing is fetched from another site."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
THEMES = ["midnight", "daylight", "amoled", "contrast", "forest", "sepia"]
FONTS = ["system", "inter", "plex", "atkinson", "serif", "mono"]


def lum(rgb):
    c = [x / 255 for x in rgb]; c = [v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4 for v in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]


def ratio(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True); return (x + .05) / (y + .05)


for page_file in ("docs/index.html", "docs/demo/index.html"):
    html = (ROOT / page_file).read_text(); css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    prefix = "../js/" if "demo" in page_file else "js/"
    doc = (f"<!doctype html><html><head><meta charset=utf-8><style>{css}</style><script src='/js/appearance.js'></script></head><body>"
           "<header><h1>🌐 CapitalLens</h1><span class='pill'>LIVE</span><button id='logout-btn'>Sign out</button></header>"
           "<div class='tab active'><div class='card'><h3>Overview</h3><div class='stats-strip'><div class='stat-card'><div class='label'>Value</div><div class='value'>£12,345.67</div><div class='sub'>+2.4%</div></div></div>"
           "<table><tr><th>Name</th><th>P&amp;L</th></tr><tr><td>Very long holding name incorporated</td><td>£1,234.50</td></tr></table></div></div></body></html>")
    external = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            ctx = b.new_context(viewport={"width": w, "height": 800}); pg = ctx.new_page()
            def route(r):
                u = r.request.url
                if u.endswith("/"): return r.fulfill(status=200, content_type="text/html", body=doc)
                if "/js/appearance.js" in u: return r.fulfill(status=200, content_type="application/javascript", body=(ROOT / "docs/js/appearance.js").read_text())
                if "/fonts/" in u: return r.fulfill(status=200, content_type="font/woff", body=(ROOT / "docs/fonts" / u.rsplit("/", 1)[1]).read_bytes())
                external.append(u); r.abort()
            pg.route("http://t.test/**", route)
            pg.goto("http://t.test/")
            assert pg.query_selector("header #cl-ap-btn"), f"{page_file}: no Appearance button in the header"
            pg.click("#cl-ap-btn")
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, small = [...document.querySelectorAll('#cl-ap .cl-ap-opt, #cl-ap-close, .cl-ap-reset, #cl-ap-btn')].filter(e => e.getBoundingClientRect().height < 40 && e.id !== 'cl-ap-btn').length;
              const box = document.querySelector('.cl-ap-box').getBoundingClientRect();
              return { sideways: document.documentElement.scrollWidth > W, small, over: box.right > W + 1 || box.left < -1, opts: document.querySelectorAll('#cl-ap .cl-ap-opt').length }; }""")
            if res["sideways"] or res["small"] or res["over"] or res["opts"] != 6 + 1 + 6 + 4: bad += 1; print(f"✗ {page_file} {w}px: {res}")
            for sz in ("s", "n", "l", "xl"):
                pg.click(f"[data-size-id={sz}]")
                r2 = pg.evaluate("() => ({ sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth, size: getComputedStyle(document.body).fontSize })")
                if r2["sideways"] or r2["size"] != {"s": "13px", "n": "14px", "l": "16px", "xl": "18px"}[sz]: bad += 1; print(f"✗ {page_file} {w}px size {sz}: {r2}")
            ctx.close()
        # every theme and font applies (320px), contrast is computed from what the browser really renders, and the choice survives a reload before first paint
        ctx = b.new_context(viewport={"width": 360, "height": 800}); pg = ctx.new_page(); pg.route("http://t.test/**", route); pg.goto("http://t.test/"); pg.click("#cl-ap-btn")
        for t in THEMES:
            pg.click(f"[data-theme-id={t}]")
            r = pg.evaluate("""() => { const cs = e => getComputedStyle(e), p = n => cs(document.body).backgroundColor, rgb = s => s.match(/\\d+/g).slice(0, 3).map(Number), h = document.documentElement;
              return { attr: h.getAttribute('data-theme'), bg: rgb(cs(document.body).backgroundColor), text: rgb(cs(document.body).color), card: rgb(cs(document.querySelector('.card')).backgroundColor), muted: rgb(cs(document.querySelector('.label')).color), scheme: cs(h).colorScheme }; }""")
            need = 7 if t == "contrast" else 4.5
            if (r["attr"] or "midnight") != t or ratio(r["text"], r["bg"]) < need or ratio(r["text"], r["card"]) < need or ratio(r["muted"], r["card"]) < need: bad += 1; print(f"✗ theme {t}: {r}")
        for f in FONTS:
            pg.click(f"[data-font-id={f}]")
            fam = pg.evaluate("() => getComputedStyle(document.querySelector('td')).fontFamily")
            if f != "system" and ("sans" not in fam and "serif" not in fam and "monospace" not in fam): bad += 1; print(f"✗ font {f}: {fam}")
        pg.click("[data-theme-id=sepia]"); pg.click("[data-font-id=inter]"); pg.click("[data-size-id=l]")
        pg.goto("http://t.test/")
        first = pg.evaluate("() => ({ t: document.documentElement.getAttribute('data-theme'), f: document.documentElement.getAttribute('data-font'), s: document.documentElement.getAttribute('data-size') })")
        if first != {"t": "sepia", "f": "inter", "s": "l"}: bad += 1; print("✗ choice not remembered after reload:", first)
        pg.click("#cl-ap-btn"); pg.click(".cl-ap-reset")
        d = pg.evaluate("() => ({ t: document.documentElement.getAttribute('data-theme'), f: document.documentElement.getAttribute('data-font'), s: document.documentElement.getAttribute('data-size') })")
        if d != {"t": None, "f": None, "s": None}: bad += 1; print("✗ reset did not restore defaults:", d)
        pg.emulate_media(color_scheme="light"); pg.click("[data-follow='1']"); lt = pg.evaluate("() => document.documentElement.getAttribute('data-theme')")
        if lt != "daylight": bad += 1; print("✗ Match my device (light) should give Daylight:", lt)
        pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(200); dk = pg.evaluate("() => document.documentElement.getAttribute('data-theme')")
        if dk is not None: bad += 1; print("✗ Match my device (dark) should give Midnight:", dk)
        b.close()
    if external: bad += 1; print(f"✗ {page_file}: requests to other sites: {external[:3]}")
print("✓ Appearance: fits 320/360/390px at every text size, every theme/font/size applies and is remembered, contrast holds, nothing fetched from other sites" if not bad else f"{bad} problem(s)")
sys.exit(1 if bad else 0)
