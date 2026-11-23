"""Run: python3 tests/lots_layout_test.py — "Purchases outside pies": the card is ONE short line per stock; tapping it opens a pop-up with the buys as a table (tap a buy for stop-loss and
sell levels, Back, Close, Esc). Real page CSS + real js/lots.js at 320/360/390px (live + demo), long names, many buys: no sideways scroll in the page, card or pop-up, tap targets >= 44px,
and readable in every theme."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent; bad = 0
SETUP = """async () => { const now = Date.parse('2026-11-23T10:00:00Z'), long = 'Taiwan Semiconductor Manufacturing Company Limited American Depositary Receipt';
  const o = (id, t, d, q, px, v) => ({ id, status: 'FILLED', ticker: t, side: 'BUY', filled_at: d, quantity: q, price: px, net_value: v });
  const orders = [o('1', 'NVDA_US_EQ', '2026-08-01T10:00:00Z', 1.123456, 101.1234, -85), o('2', 'NVDA_US_EQ', '2026-09-15T10:00:00Z', 2, 80, -128), o('3', 'NVDA_US_EQ', '2026-11-10T10:00:00Z', 1, 150, -120),
    o('5', 'NVDA_US_EQ', '2026-11-12T10:00:00Z', 1, 99999.1234, -120), o('4', 'TSM_US_EQ', '2026-10-01T10:00:00Z', 5, 200, -800)];
  const un = [{ ticker: 'NVDA_US_EQ', display: 'NVIDIA', pie: 'Semiconductor', dq: 6, current_price: 120.5, avg_price: 95 }, { ticker: 'TSM_US_EQ', display: long, dq: 8, current_price: 1234.5678, avg_price: 190 }];
  const box = document.getElementById('x'); await Lots.show(box, un, { api: async () => orders, now, gbp: v => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2 }), quote: v => '$' + Number(v).toLocaleString('en-US') }); }"""
STATE = """() => { const m = document.getElementById('lt-modal'), body = m && m.querySelector('.lt-m-body'), box = m && m.querySelector('.lt-m-box'), W = document.documentElement.clientWidth;
  return { open: !!m && m.classList.contains('open'), pageOver: document.documentElement.scrollWidth - W, bodyOver: body ? body.scrollWidth - body.clientWidth : 0, boxRight: box ? box.getBoundingClientRect().right - W : 0,
    rowsSmall: [...document.querySelectorAll('.lt-row, .lt-tr, .lt-m-close, .lt-m-x, .lt-m-back')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).length,
    trs: m ? m.querySelectorAll('.lt-tr').length : 0, order: m ? m.querySelectorAll('.lt-order').length : 0, back: m ? !!m.querySelector('[data-lt-back]') : false, title: m ? (m.querySelector('h3') || {}).textContent : '' } }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for page_file in ["docs/index.html", "docs/demo/index.html"]:
        css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page_file).read_text(), re.S))
        for w in (320, 360, 390):
            pg = b.new_context(viewport={"width": w, "height": 800}).new_page()
            pg.set_content("<style>" + css + "</style><div id='x' style='padding:0 14px'></div>"); pg.add_script_tag(path=str(ROOT / "docs/js/lots.js")); pg.evaluate(SETUP)
            card = pg.evaluate("() => ({ rows: document.querySelectorAll('.lt-row').length, lots: document.querySelectorAll('.lt-lot').length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll('.lt-row')].filter(e => e.getBoundingClientRect().height < 44).length })")
            if card["rows"] != 2 or card["lots"] != 0 or card["over"] > 0 or card["small"]: bad += 1; print(f"✗ {page_file} @{w} card: {card}")
            pg.click(".lt-row[data-lt=NVDA_US_EQ]"); s = pg.evaluate(STATE)               # tap NVIDIA -> table of its 4 buys
            if not (s["open"] and s["trs"] == 4 and not s["back"] and s["pageOver"] <= 0 and s["bodyOver"] <= 0 and s["boxRight"] <= 1 and not s["rowsSmall"] and "NVIDIA" in s["title"]): bad += 1; print(f"✗ {page_file} @{w} table: {s}")
            pg.click(".lt-tr >> nth=0"); s = pg.evaluate(STATE)                # tap a buy -> its levels, with Back
            if not (s["open"] and s["back"] and s["order"] == 1 and s["bodyOver"] <= 0 and s["pageOver"] <= 0 and not s["rowsSmall"]): bad += 1; print(f"✗ {page_file} @{w} drill-down: {s}")
            pg.click("[data-lt-back]"); s = pg.evaluate(STATE)
            if not (s["open"] and s["trs"] == 4 and not s["back"]): bad += 1; print(f"✗ {page_file} @{w} back: {s}")
            pg.click(".lt-m-close"); s = pg.evaluate(STATE)
            if s["open"] or s["pageOver"] > 0: bad += 1; print(f"✗ {page_file} @{w} close: {s}")
            pg.click(".lt-row[data-lt=TSM_US_EQ]"); s = pg.evaluate(STATE)               # long name, one buy
            if not (s["open"] and s["trs"] == 1 and s["bodyOver"] <= 0 and s["pageOver"] <= 0): bad += 1; print(f"✗ {page_file} @{w} long name: {s}")
            pg.keyboard.press("Escape")
            if pg.evaluate(STATE)["open"]: bad += 1; print(f"✗ {page_file} @{w} Esc does not close")
            pg.click(".lt-row[data-lt=NVDA_US_EQ]"); pg.locator(".lt-tr").nth(1).focus(); pg.keyboard.press("Enter")   # keyboard drill-down
            if not pg.evaluate(STATE)["back"]: bad += 1; print(f"✗ {page_file} @{w} Enter does not open a buy")
            pg.context.close()
        pg = b.new_context(viewport={"width": 360, "height": 800}).new_page()
        pg.set_content("<style>" + css + "</style><div id='x' style='padding:0 14px'></div>"); pg.add_script_tag(path=str(ROOT / "docs/js/lots.js")); pg.add_script_tag(path=str(ROOT / "docs/js/appearance.js")); pg.evaluate(SETUP)
        pg.click(".lt-row[data-lt=NVDA_US_EQ]"); pg.click(".lt-tr >> nth=0")
        for t in ("midnight", "daylight", "sepia", "contrast", "forest", "amoled"):
            pg.evaluate(f"ClAppearance.set({{theme:'{t}'}}, true)")
            r = pg.evaluate("""() => { const rgb = s => s.match(/\\d+/g).slice(0, 3).map(Number), f = c => { c = c.map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
              const cr = (a, b) => { const [x, y] = [f(a), f(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); }, bg = rgb(getComputedStyle(document.querySelector('.lt-m-box')).backgroundColor), lotbg = rgb(getComputedStyle(document.querySelector('.lt-lot')).backgroundColor);
              return [cr(rgb(getComputedStyle(document.querySelector('.lt-m-body')).color), bg), cr(rgb(getComputedStyle(document.querySelector('.lt-sub')).color), lotbg), cr(rgb(getComputedStyle(document.querySelector('.lt-chip')).color), lotbg)]; }""")
            if min(r) < 4.4: bad += 1; print(f"✗ {page_file} theme {t}: contrast {r}")
        pg.context.close()
    b.close()
print("✓ Purchases outside pies: one line per stock, pop-up table + drill-down fit 320/360/390px, keyboard works, readable in every theme" if not bad else f"{bad} layout problem(s)"); sys.exit(1 if bad else 0)
