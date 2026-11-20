"""5-check review box fits 320/360/390px with no sideways scroll, buttons >= 40px, Copy puts the prompt on the clipboard, Open link carries it.
Run: python3 tests/fivecheck_layout_test.py   (uses the real page CSS and real js/fivecheck.js + js/strategy.js card code path via FiveCheck.html)"""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent; bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for page_file in ["docs/index.html", "docs/demo/index.html"]:
        css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page_file).read_text(), re.S))
        for w in (320, 360, 390):
            ctx = b.new_context(viewport={"width": w, "height": 800}, permissions=["clipboard-read", "clipboard-write"]); pg = ctx.new_page()
            body = "<style>" + css + "</style><div class='card'><div id='x' style='padding:12px 14px'></div></div>"
            pg.route("https://fc.test/", lambda r, _req=None, body=body: r.fulfill(status=200, content_type="text/html", body=body)); pg.goto("https://fc.test/")   # a real (secure) origin so the clipboard exists
            pg.add_script_tag(path=str(ROOT / "docs/js/fivecheck.js"))
            pg.evaluate("document.getElementById('x').innerHTML = FiveCheck.html('Taiwan Semiconductor Manufacturing Company Limited ADR', 'TSM_US_EQ_VERY_LONG_TICKER')")
            over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            small = pg.evaluate("[...document.querySelectorAll('.fc-btn')].filter(e => e.getBoundingClientRect().height < 40).length")
            if over > 0 or small: bad += 1; print(f"✗ {page_file} @{w}: overflow {over}px, {small} button(s) under 40px")
            pg.click("[data-fc-copy]"); pg.wait_for_timeout(200)
            clip = pg.evaluate("navigator.clipboard.readText()")
            hrefs = pg.eval_on_selector_all("[data-fc-ai]", "els => els.map(e => e.getAttribute('href'))")
            starts = ["https://chatgpt.com/?q=Help%20me%20check", "https://claude.ai/new?q=Help%20me%20check", "https://grok.com/?q=Help%20me%20check"]
            if not (clip.startswith("Help me check this stock before I buy it: Taiwan Semiconductor") and "TSM_US_EQ_VERY_LONG_TICKER" in clip and len(hrefs) == 3 and all(h.startswith(x) for h, x in zip(hrefs, starts))):
                bad += 1; print(f"✗ {page_file} @{w}: copy/open did not carry the prompt")
            pg.click(".fc-prev summary"); over2 = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over2 > 0: bad += 1; print(f"✗ {page_file} @{w}: prompt preview overflows {over2}px")
            ctx.close()
    b.close()
print("✓ 5-check box fits 320/360/390px, buttons >= 40px, copy + the ChatGPT / Claude / Grok buttons carry the prompt" if not bad else f"{bad} layout problem(s)"); sys.exit(1 if bad else 0)
