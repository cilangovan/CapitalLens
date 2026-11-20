"""Recent purchases card fits 320/360/390px with no sideways scroll (legacy + demo CSS, long names, many rows).
Run: python3 tests/recent_layout_test.py   (real page CSS + real js/recent.js)"""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent; bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for page_file in ["docs/index.html", "docs/demo/index.html"]:
        css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page_file).read_text(), re.S))
        for w in (320, 360, 390):
            pg = b.new_context(viewport={"width": w, "height": 800}).new_page()
            pg.set_content("<style>" + css + "</style><div id='x' style='padding:0 14px'></div>")
            pg.add_script_tag(path=str(ROOT / "docs/js/recent.js"))
            pg.evaluate("""() => { const now = Date.now(), ago = h => new Date(now - h * 3600000).toISOString(), long = 'Taiwan Semiconductor Manufacturing Company Limited ADR';
              const pos = [{ ticker: 'TSM_US_EQ', display: long, pie: 'Semiconductor and AI hardware leaders pie', current_price: 1234.5678 }, { ticker: 'B_US_EQ', display: 'B', current_price: 9 }];
              const o = (t, h, q, px, v) => ({ side: 'BUY', status: 'FILLED', ticker: t, filled_at: ago(h), quantity: q, price: px, net_value: -v });
              document.getElementById('x').innerHTML = RecentBuys.html(RecentBuys.rows([o('TSM_US_EQ', 3, 1, 1200, 1200), o('B_US_EQ', 50, 5, 10, 50), o('GONE_US_EQ', 80, 1, 1, 1)], pos, now),
                { now, gbp: v => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 }), quote: v => '$' + v }); }""")
            over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over > 0 or not pg.query_selector("#recent-buys"): bad += 1; print(f"✗ {page_file} @{w}: overflow {over}px or card missing")
            pg.context.close()
    b.close()
print("✓ Recent purchases card fits 320/360/390px" if not bad else f"{bad} layout problem(s)"); sys.exit(1 if bad else 0)
