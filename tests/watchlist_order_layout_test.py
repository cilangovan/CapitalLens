"""Run: python tests/watchlist_order_layout_test.py — the watchlist cards (normal and ⇅ Arrange mode) fit a phone at 320/360/390px, the ▲ ▼ buttons are >= 40px,
and tapping them really reorders the cards. Offline: the dashboard's own CSS and docs/js/watchlist.js against a stub page."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
for page in ("docs/index.html", "docs/demo/index.html"):
    css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page).read_text(), re.S))
    html = "<style>" + css + "</style><div class='tab active'><div id='w-cats'></div><div id='w-summary'></div><div id='w-list'></div></div>"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            ctx = b.new_context(viewport={"width": w, "height": 800}, has_touch=True); pg = ctx.new_page(); posts = []
            pg.on("request", lambda r: posts.append(r.url) if "watchlist/order" in r.url else None)
            pg.route("**/watchlist/order", lambda route: route.fulfill(status=200, content_type="application/json", body='{"ok":true}'))
            pg.set_content(html)
            pg.evaluate("window.IS_GUEST=false; window.PROXY='https://w.example'; window.SESSION_TOKEN='T'; window.ddPx=null;")
            pg.add_script_tag(path=str(ROOT / "docs/js/watchlist.js"))
            pg.evaluate("""() => { WL.items = ['ASML.AS','NVDA','AMD','TCS.NS','GOOG','A-VERY-LONG-TICKER.L'].map((t, i) => ({ ticker: t, category: 'stock', name: i === 5 ? 'Granite Shares 2x Long Advanced Micro Devices Daily Leveraged ETF Trust' : t + ' Holding plc', exchange: 'NASDAQ' }));
              WL.analysis = {}; WL.items.forEach((i, k) => { WL.analysis[i.ticker] = { status: 'ok', verdict: ['ENTER','ACCUMULATE','HOLD','AVOID'][k % 4], updated_at: '2026-11-20T08:00:00Z', data: { price: 100 + k, ccy: 'USD', daily_pct: -1.2, entries: [] } }; });
              renderWatchlist(); }""")
            check = """() => { const W = document.documentElement.clientWidth, out = [];
              document.querySelectorAll('#w-summary *, #w-list *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) { let p = e.parentElement, clip = false;
                while (p && p.id !== 'w-list') { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clip = p.getBoundingClientRect().right <= W + 1; break; } p = p.parentElement; } if (!clip) out.push(e.className || e.tagName); } });
              const small = [...document.querySelectorAll('.w-mv button, #w-summary .w-pick')].filter(e => { const r = e.getBoundingClientRect(); return r.height < 39.5 || (e.closest('.w-mv') && r.width < 39.5); }).length;
              return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 5), small }; }"""
            r1 = pg.evaluate(check)
            grips = pg.evaluate("[...document.querySelectorAll('#w-list .w-grip')].map(g => { const r = g.getBoundingClientRect(); return [r.width, r.height]; })")
            grip_ok = len(grips) == 6 and all(wd >= 39.5 and ht >= 39.5 for wd, ht in grips)
            if w == 390:                                                                   # drag with a real mouse: first card dropped between the 3rd and 4th
                names0 = pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t)")
                gb = pg.locator('#w-list .w-card:nth-child(1) .w-grip').bounding_box(); tb = pg.locator('#w-list .w-card:nth-child(4)').bounding_box()
                pg.mouse.move(gb["x"] + 20, gb["y"] + 20); pg.mouse.down()
                tgt = tb["y"] + tb["height"] * 0.8
                for k in range(1, 13): pg.mouse.move(gb["x"] + 20, gb["y"] + 20 + (tgt - gb["y"] - 20) * k / 12); pg.wait_for_timeout(30)
                during = pg.evaluate("({ sorting: document.getElementById('w-list').classList.contains('sorting'), dragging: !!document.querySelector('.w-card.dragging'), folded: [...document.querySelectorAll('#w-list .w-pad')].every(e => getComputedStyle(e).display === 'none') })")
                pg.mouse.up(); pg.wait_for_timeout(700)
                names1 = pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t)")
                drag_ok = names1 != names0 and names1[0] == names0[1] and names1.index(names0[0]) >= 2 and sorted(names1) == sorted(names0) and len(posts) == 1 and during["sorting"] and during["dragging"] and during["folded"] \
                    and not pg.evaluate("document.getElementById('w-list').classList.contains('sorting')") and pg.locator('.w-card.dragging').count() == 0
                saved_order = pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t)") == names1
                if not (drag_ok and saved_order): bad += 1; print(f"✗ {page} drag with mouse: before={names0} after={names1} during={during} posts={len(posts)}")
                posts.clear()
                # and a drag that is cancelled (pointercancel) changes nothing
                gb = pg.locator('#w-list .w-card:nth-child(1) .w-grip').bounding_box(); pg.mouse.move(gb["x"] + 20, gb["y"] + 20); pg.mouse.down(); pg.mouse.move(gb["x"] + 20, gb["y"] + 200, steps=5)
                pg.evaluate("document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: WLD.pid, bubbles: true }))"); pg.wait_for_timeout(300); pg.mouse.up(); pg.wait_for_timeout(500)
                if pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t)") != names1 or posts: bad += 1; print(f"✗ {page} cancelled drag changed the order or saved")
                # touch: handle has touch-action none, so a finger drag reorders instead of scrolling
                cdp = pg.context.new_cdp_session(pg); gb = pg.locator('#w-list .w-card:nth-child(2) .w-grip').bounding_box(); x, y0 = gb["x"] + 20, gb["y"] + 20
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y0}]})
                for k in range(1, 9): cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y0 - 8 * k * 4}]}); pg.wait_for_timeout(30)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []}); pg.wait_for_timeout(700)
                names2 = pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t)")
                if names2[0] != names1[1]: bad += 1; print(f"✗ {page} touch drag did not move the card up: {names1} -> {names2}")
                posts.clear()
            if not grip_ok: bad += 1; print(f"✗ {page} {w}px: drag handles missing or < 40px: {grips}")
            pg.click("text=⇅ Arrange"); r2 = pg.evaluate(check)
            names = lambda: pg.evaluate("[...document.querySelectorAll('.w-card')].map(c => c.dataset.t).join(',')")
            first = names().split(",")
            pg.click(".w-card:nth-child(3) .w-mv [data-dir='-1']")                      # child 1 is the hint line, so child 3 is the second card: move it up
            pg.wait_for_timeout(700)
            after = names().split(",")
            moved = after[0] == first[1] and after[1] == first[0] and len(posts) == 1
            disabled = pg.evaluate("document.querySelector('.w-card:nth-child(2) .w-mv [data-dir=\"-1\"]').disabled && document.querySelector('.w-card:last-child .w-mv [data-dir=\"1\"]').disabled")
            reset = pg.evaluate("!!([...document.querySelectorAll('#w-summary .w-pick')].find(b => /Automatic order/.test(b.textContent)))")
            pg.click("text=✓ Done"); back = pg.evaluate("!document.querySelector('.w-mv') && !!document.querySelector('.w-quick')")
            if r1["sideways"] or r1["out"] or r1["small"] or r2["sideways"] or r2["out"] or r2["small"] or not moved or not disabled or not reset or not back:
                bad += 1; print(f"✗ {page} {w}px: normal={r1} arrange={r2} moved={moved} ends_disabled={disabled} reset_button={reset} done_restores={back}")
            if w == 360 and page == "docs/index.html":
                pg.click("text=⇅ Arrange"); pg.screenshot(path="/tmp/arrange360.png")
            pg.close(); ctx.close()
        b.close()
# Demo: the worker routes answer 501 (no writable store), so the order must be kept in this browser and come back after a reload
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/demo/index.html").read_text(), re.S))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); pg = b.new_page(viewport={"width": 390, "height": 800}); errs = []
    pg.route("**/watchlist/order", lambda route: route.fulfill(status=501, content_type="application/json", body='{"error":"This feature is not available in the demo"}'))
    page_html = "<style>" + css + "</style><div class='tab active'><div id='w-cats'></div><div id='w-summary'></div><div id='w-list'></div><div id='alerts-toast'></div></div>"
    pg.route("https://demo.test/", lambda route: route.fulfill(status=200, content_type="text/html", body=page_html)); pg.goto("https://demo.test/")      # a real origin, so localStorage works like in the demo
    pg.evaluate("window.IS_GUEST=false; window.PROXY='https://w.example'; window.SESSION_TOKEN='T'; window.ddPx=null;"); pg.add_script_tag(path=str(ROOT / "docs/js/watchlist.js"))
    seed = """() => { WL.items = ['AAA','BBB','CCC'].map(t => ({ ticker: t, category: 'stock', name: t + ' Inc' })); WL.analysis = {}; wlApplyLocalOrder(); renderWatchlist(); }"""
    pg.evaluate(seed); names = lambda: pg.evaluate("[...document.querySelectorAll('#w-list .w-card')].map(c => c.dataset.t).join()")
    pg.click("text=⇅ Arrange"); pg.click(".w-card:nth-child(3) .w-mv [data-dir='-1']"); pg.wait_for_timeout(800)       # BBB up
    moved_ok = names() == "BBB,AAA,CCC"
    pg.evaluate(seed)                                                                                                  # a reload: fresh items, order restored from this browser
    restored = names() == "BBB,AAA,CCC" and "Couldn't save" not in pg.inner_text("#alerts-toast")
    if not (moved_ok and restored): bad += 1; print(f"✗ demo: browser-only order moved={moved_ok} restored={restored} now={names()}")
    b.close()
print("✓ Watchlist cards (normal + Arrange) fit 320/360/390px, buttons >= 40px, ▲▼ reorder and save" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
