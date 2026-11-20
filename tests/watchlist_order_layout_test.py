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
            pg = b.new_page(viewport={"width": w, "height": 800}); posts = []
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
            pg.close()
        b.close()
print("✓ Watchlist cards (normal + Arrange) fit 320/360/390px, buttons >= 40px, ▲▼ reorder and save" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
