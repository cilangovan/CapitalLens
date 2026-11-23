"""Run: python tests/watchlist_amount_layout_test.py — the Watchlist "amount to invest" box (no fixed budget) must fit a phone at 320/360/390px (no sideways
scroll, box and Plan button >= 40px) and must turn the typed amount into £ per price point from the engine's relative shares. Offline: docs/js/watchlist.js + the dashboard CSS + stubs."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
ent = [{"label": "Now", "price": 100, "pct_from_now": 0, "share": 0.4}, {"label": "Pullback", "price": 97, "pct_from_now": -3, "share": 0.3}, {"label": "Deeper dip", "price": 92, "pct_from_now": -8, "share": 0.3}]
items = [{"ticker": "AAA", "name": "A Very Long Company Name Holdings International Incorporated Group plc", "category": "stock"}, {"ticker": "BBB", "name": "BBB Corp", "category": "stock"}]
analysis = {"AAA": {"ticker": "AAA", "status": "ok", "verdict": "ENTER", "data": {"price": 100, "ccy": "USD", "entries": ent, "weight": {"share": 0.6667, "basis": "this week"}, "reason": "demo"}},
            "BBB": {"ticker": "BBB", "status": "ok", "verdict": "ACCUMULATE", "data": {"price": 50, "ccy": "USD", "entries": ent, "weight": {"share": 0.3333, "basis": "this week"}, "reason": "demo"}}}
for page in ("docs/index.html", "docs/demo/index.html"):
    html = (ROOT / page).read_text()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b.new_page(viewport={"width": w, "height": 800})
            pg.set_content(f"<style>{css}</style><div class='tab active'><div id='w-cats'></div><div id='w-summary'></div><div id='w-list'></div></div>")
            pg.add_script_tag(path=str(ROOT / "docs/js/watchlist.js"))
            pg.evaluate("([items, analysis]) => { WL.items = items; WL.analysis = analysis; WL.cat = 'stock'; WL.expanded = new Set(items.map(i => i.ticker)); renderWatchlist(); }", [items, analysis])
            none = pg.evaluate("() => document.getElementById('w-list').textContent.includes('£') ? 'has £ before any amount' : 'ok'")
            pg.fill("#w-amount", "300"); pg.click(".w-budget button")
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, t = document.getElementById('w-list').textContent,
              small = [...document.querySelectorAll('#w-amount, .w-budget button')].filter(e => e.getBoundingClientRect().height < 40).length;
              return { sideways: document.documentElement.scrollWidth > W, small, t80: t.includes('£80'), t60: t.includes('£60'), t30: t.includes('£30'), noBudget: !/weekly budget|£300\\/month/.test(document.body.textContent) }; }""")
            # AAA gets 300*0.6667: 80 / 60 / 60 ; BBB 300*0.3333: 40 / 30 / 30
            if none != "ok" or res["sideways"] or res["small"] or not (res["t80"] and res["t60"] and res["t30"] and res["noBudget"]):
                bad += 1
                print(f"✗ {page} {w}px: {none} {res}")
            pg.close()
        b.close()
print("✓ Watchlist amount box fits 320/360/390px, tap targets ≥ 40px, £ come from the typed amount only" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
