"""Run: python tests/help_layout_test.py - the ❓ Help button and chat sheet must fit a phone at 320/360/390px with no sideways scroll, tap targets >= 40px,
long answers/links wrap, the button never covers the footer links, and every dashboard loads helpbot.js. Offline: loads docs/js/helpbot.js with the dashboard's own CSS."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
def check(name, cond):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name)
    if not cond: bad += 1

LONG = "Open the Settings panel, paste the Trading 212 API key and the secret, then press Refresh now. " * 6 + "https://example.invalid/averyveryveryveryverylongunbrokenlinkthatmustwrapinsidethebubble" * 2
for page in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"):
    html = (ROOT / page).read_text()
    check(f"{page} loads helpbot.js", "helpbot.js" in html)
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for w in (320, 360, 390):
        pg = b.new_page(viewport={"width": w, "height": 740})
        pg.set_content(f"<style>{css}</style><body><main><p>Dashboard</p></main><footer><a href='help/'>📘 Documentation</a></footer></body>")
        pg.evaluate("() => { window.SESSION_TOKEN = 'a.b.c'; }")
        pg.add_script_tag(path=str(ROOT / "docs/js/helpbot.js"))
        pg.wait_for_selector("#hb-btn", state="attached"); pg.wait_for_function("document.getElementById('hb-btn').style.display === 'flex'")
        box = pg.locator("#hb-btn").bounding_box()
        check(f"{w}px: button is >= 40px and fully on screen", box["width"] >= 40 and box["height"] >= 40 and box["x"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= 740)
        pg.click("#hb-btn")
        check(f"{w}px: chat sheet opens, no sideways scroll", pg.evaluate("() => document.getElementById('hb-sheet').classList.contains('open') && document.documentElement.scrollWidth <= window.innerWidth"))
        pg.evaluate("""(long) => { HB.msgs.push({role:'user', text:'How do I turn on the live feed?'}); HB.msgs.push({role:'assistant', text: long, sources:[{title:'⚙ Settings & account › Turning the live feed on and keeping it running across a very long heading title', url:'menus/settings-and-account.html#live'},{title:'Strategy', url:'menus/strategy.html'}]}); HB.msgs.push({role:'assistant', text:'The help assistant is unavailable right now.', err:true}); HB.busy = true; hbRender(); }""", LONG)
        check(f"{w}px: long answer, long links and the loading state fit (no sideways scroll)", pg.evaluate("() => { const s = document.getElementById('hb-sheet'), l = document.getElementById('hb-log'); return s.getBoundingClientRect().right <= window.innerWidth && l.scrollWidth <= l.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }"))
        small = pg.evaluate("() => [...document.querySelectorAll('#hb-sheet button, #hb-in, #hb-send')].filter(e => { const r = e.getBoundingClientRect(); return r.width < 40 || r.height < 40; }).map(e => e.id || e.textContent)")
        check(f"{w}px: every control in the sheet is >= 40px (small: {small})", not small)
        check(f"{w}px: sources render as links with a safe rel", pg.evaluate("() => { const a = [...document.querySelectorAll('.hb-src a')]; return a.length === 2 && a.every(x => x.rel === 'noopener' && x.target === '_blank'); }"))
        pg.evaluate("() => { window.SESSION_TOKEN = null; }"); pg.wait_for_function("document.getElementById('hb-btn').style.display === 'none'", timeout=5000)
        check(f"{w}px: signing out hides the button, closes the sheet and wipes the chat", pg.evaluate("() => !document.getElementById('hb-sheet').classList.contains('open') && HB.msgs.length === 0"))
        pg.close()
    b.close()
print("\nPASS" if not bad else "\nFAIL"); sys.exit(1 if bad else 0)
