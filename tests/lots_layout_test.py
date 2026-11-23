"""Run: python3 tests/lots_layout_test.py — the "Purchases outside pies" card fits 320/360/390px (live + demo CSS, real js/lots.js): no sideways scroll even with long names,
many buys and every stock expanded, tap targets >= 40px, stops/sell steps/limit line visible, and all five themes keep it readable (no hard-coded colours)."""
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
            pg.add_script_tag(path=str(ROOT / "docs/js/lots.js"))
            pg.evaluate("""() => { const now = Date.parse('2026-11-23T10:00:00Z'), long = 'Taiwan Semiconductor Manufacturing Company Limited American Depositary Receipt';
              const o = (id, t, side, d, q, px, v) => ({ id, status: 'FILLED', ticker: t, side, filled_at: d, quantity: q, price: px, net_value: v });
              const orders = [o('1', 'NVDA_US_EQ', 'BUY', '2026-08-01T10:00:00Z', 1.123456, 101.1234, -85), o('2', 'NVDA_US_EQ', 'BUY', '2026-09-15T10:00:00Z', 2, 80, -128), o('3', 'NVDA_US_EQ', 'BUY', '2026-11-10T10:00:00Z', 1, 150, -120),
                o('4', 'TSM_US_EQ', 'BUY', '2026-10-01T10:00:00Z', 5, 200, -800)];
              const un = [{ ticker: 'NVDA_US_EQ', display: 'NVIDIA', pie: 'Semiconductor and AI hardware leaders', dq: 6, current_price: 120.5, avg_price: 95 }, { ticker: 'TSM_US_EQ', display: long, dq: 8, current_price: 1234.5678, avg_price: 190 }];
              document.getElementById('x').innerHTML = Lots.html(Lots.rows(orders, un, now), { gbp: v => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 }), quote: v => '$' + v });
              document.querySelectorAll('details').forEach(d => d.open = true); }""")
            r = pg.evaluate("""() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: !!document.getElementById('lots-card'), lots: document.querySelectorAll('.lt-lot').length,
              chips: document.querySelectorAll('.lt-chip').length, orders: document.querySelectorAll('.lt-order').length, warn: document.querySelectorAll('.lt-warn').length,
              small: [...document.querySelectorAll('.lt-stock summary')].filter(e => e.getBoundingClientRect().height < 40).length,
              clipped: [...document.querySelectorAll('#lots-card *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length })""")
            if r["over"] > 0 or not r["card"] or r["lots"] != 4 or r["orders"] < 2 or r["chips"] < 20 or r["small"] or r["clipped"] or r["warn"] != 2:
                bad += 1; print(f"✗ {page_file} @{w}: {r}")
            pg.context.close()
        # readable in every theme: text, muted and chip colours keep contrast on the card background
        pg = b.new_context(viewport={"width": 360, "height": 800}).new_page()
        pg.set_content("<style>" + css + "</style><div id='x' style='padding:0 14px'></div>"); pg.add_script_tag(path=str(ROOT / "docs/js/lots.js")); pg.add_script_tag(path=str(ROOT / "docs/js/appearance.js"))
        pg.evaluate("""() => { const now = Date.parse('2026-11-23T10:00:00Z'); const o = { id: '1', status: 'FILLED', ticker: 'NVDA_US_EQ', side: 'BUY', filled_at: '2026-08-01T10:00:00Z', quantity: 1, price: 100, net_value: -80 };
          document.getElementById('x').innerHTML = Lots.html(Lots.rows([o], [{ ticker: 'NVDA_US_EQ', display: 'NVIDIA', dq: 1, current_price: 90 }], now), {}); document.querySelector('details').open = true; }""")
        for t in ("daylight", "sepia", "contrast", "forest", "amoled"):
            pg.evaluate(f"ClAppearance.set({{theme:'{t}'}}, true)")
            bg = pg.evaluate("""() => { const rgb = s => s.match(/\\d+/g).slice(0, 3).map(Number), f = c => { c = c.map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
              const cr = (a, b) => { const [x, y] = [f(a), f(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); }, lot = document.querySelector('.lt-lot'), bg = rgb(getComputedStyle(lot).backgroundColor);
              return [lot.querySelector('.lt-sub'), lot.querySelector('.lt-top b'), lot.querySelector('.lt-chip.red')].map(e => cr(rgb(getComputedStyle(e).color), bg)); }""")
            if min(bg) < 4.4: bad += 1; print(f"✗ {page_file} theme {t}: contrast {bg}")
        pg.context.close()
    b.close()
print("✓ Purchases outside pies card fits 320/360/390px and stays readable in every theme" if not bad else f"{bad} layout problem(s)"); sys.exit(1 if bad else 0)
