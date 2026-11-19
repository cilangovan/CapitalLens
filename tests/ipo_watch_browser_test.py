"""Run: python tests/ipo_watch_browser_test.py — IPO Watch works like the stock watchlist: nothing preloaded; search (typing, country, exchange), ☆ Bookmark, it appears under My IPO list, ✕ removes, a failed save is undone.
Offline: the page uses the dashboard's own CSS and ipo.js; the data calls (PROXY) are answered by a tiny in-page fake."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
rows = json.loads((ROOT / "config/ipo_calendar.json").read_text())["ipos"]
FAKE = """(() => {
  window.PROXY = 'https://fake/rest/v1'; window.__watch = []; window.__fail = false; window.__posts = [];
  window.fetch = async (u, o) => {
    const ok = b => ({ ok: true, status: 200, json: async () => b });
    if (u.endsWith('/ipo_calendar?select=*&limit=500')) return ok(%s);
    if (u.endsWith('/ipo_watch?select=id')) return ok(window.__watch.map(id => ({ id })));
    if (/\\/ipo\\/(un)?watch$/.test(u)) { const b = JSON.parse(o.body); window.__posts.push([u.split('/').pop(), b.id]); if (window.__fail) return { ok: false, status: 500, json: async () => ({}) };
      window.__watch = u.endsWith('/unwatch') ? window.__watch.filter(x => x !== b.id) : [...new Set([...window.__watch, b.id])]; return ok({ ok: true }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
})()
""" % json.dumps(rows)
bad = 0
def check(name, cond):
    global bad; print(("  ✓ " if cond else "  ✗ ") + name); bad += 0 if cond else 1
def mylist(pg): return pg.locator('#ipo-body .ipo-sec:first-child ~ .ipo-card').count()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); pg = b.new_page(viewport={"width": 390, "height": 900})
    pg.set_content(f"<style>{css}</style><div class='card'><h3>IPO</h3><div id='ipo-content'></div></div>")
    pg.evaluate(FAKE); pg.add_script_tag(path=str(ROOT / "docs/js/ipo.js")); pg.evaluate("loadIpo()")
    pg.wait_for_selector("[data-ipo-q]")
    check("NOTHING is preloaded: no IPO cards at all until you search", pg.locator(".ipo-card").count() == 0 and "Nothing here yet" in pg.inner_text("#ipo-body"))
    pg.type("[data-ipo-q]", "anthro")
    pg.wait_for_selector(".ipo-card")
    check("typing searches the calendar (results appear while the search box keeps focus and its text)", pg.locator(".ipo-card").count() == 1 and pg.evaluate("document.activeElement.hasAttribute('data-ipo-q')") and pg.input_value("[data-ipo-q]") == "anthro")
    check("a result has a ☆ Bookmark button and no ✕ yet", pg.locator('button.ipo-watch[data-ipo-watch="US:ANT"]').count() == 1 and pg.locator(".ipo-x").count() == 0)
    pg.click('button.ipo-watch[data-ipo-watch="US:ANT"]'); pg.wait_for_selector('.w-x.ipo-x[data-ipo-watch="US:ANT"]')
    check("bookmarking saves (POST watch) and it appears under My IPO list with a ✕", pg.evaluate("window.__posts.at(-1).join()") == "watch,US:ANT" and "my ipo list" in pg.inner_text("#ipo-body").lower() and pg.locator(".ipo-x").count() == 1)
    check("the result now reads ★ In my list", "In my list" in pg.inner_text("#ipo-body"))
    xb = pg.locator(".w-x.ipo-x").first.bounding_box()
    check("the ✕ is a 40px tap target", xb["width"] >= 39.5 and xb["height"] >= 39.5)
    # clear the text, then filter by country and by exchange
    pg.fill("[data-ipo-q]", "")
    check("clearing the search hides the results but keeps My IPO list", pg.locator(".ipo-card").count() == 1 and "search results" not in pg.inner_text("#ipo-body").lower())
    pg.click('[data-ipo-co="UK"]'); pg.wait_for_selector("text=Airtel Money")
    check("country chip filters the calendar (UK → Airtel Money only)", pg.locator("#ipo-body .ipo-card .ipo-name b").all_inner_texts().count("Airtel Money") == 1 and "Doncasters" not in pg.inner_text("#ipo-body") and pg.locator('.w-cat.active[data-ipo-co="UK"]').count() == 1)
    pg.click('[data-ipo-co="ALL"]'); pg.select_option("[data-ipo-ex]", "NYSE"); pg.wait_for_selector("text=Doncasters")
    check("exchange filter works (NYSE → Doncasters Group only)", "Airtel" not in pg.inner_text("#ipo-body") and "Doncasters Group" in pg.inner_text("#ipo-body"))
    pg.select_option("[data-ipo-ex]", "ALL"); pg.fill("[data-ipo-q]", "india"); pg.wait_for_selector("text=Vedant")
    check("search by country name finds Indian IPOs", pg.locator("#ipo-body .ipo-sec").count() == 2 and "Vedant Poly Fabs" in pg.inner_text("#ipo-body"))
    pg.fill("[data-ipo-q]", "")
    pg.click('.w-x.ipo-x[data-ipo-watch="US:ANT"]'); pg.wait_for_function("document.querySelectorAll('.ipo-card').length === 0")
    check("✕ removes it (POST unwatch) and My IPO list is empty again", pg.evaluate("window.__posts.at(-1).join()") == "unwatch,US:ANT" and "Nothing here yet" in pg.inner_text("#ipo-body"))
    pg.fill("[data-ipo-q]", "anthro"); pg.wait_for_selector('button.ipo-watch[data-ipo-watch="US:ANT"]')
    pg.evaluate("window.__fail = true"); pg.click('button.ipo-watch[data-ipo-watch="US:ANT"]'); pg.wait_for_selector("text=Could not save")
    check("a failed save is undone with a message (not in My IPO list)", pg.locator(".ipo-x").count() == 0 and pg.locator('button.ipo-watch[data-ipo-watch="US:ANT"]:not(.on)').count() == 1)
    btn = pg.locator('button.ipo-watch[data-ipo-watch="US:ANT"]').bounding_box()
    check("the Bookmark button is a comfortable tap target (>= 40px tall, fits the 390px screen)", btn["height"] >= 40 and btn["x"] >= 0 and btn["x"] + btn["width"] <= 390)
    sel = pg.locator("[data-ipo-ex]").bounding_box()
    check("the exchange filter is a 40px tap target inside the screen", sel["height"] >= 39.5 and sel["x"] + sel["width"] <= 390)
    # where bookmarking is not offered (legacy page): search still works, but nothing to bookmark into and no list
    pg.evaluate("(() => { window.fetch = async (u) => u.includes('ipo_watch') ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => %s }; })()" % json.dumps(rows))
    pg.evaluate("loadIpo()"); pg.wait_for_selector("[data-ipo-q]"); pg.fill("[data-ipo-q]", "anthro"); pg.wait_for_selector(".ipo-card")
    check("where bookmarking is not available, search works but there are no buttons and no My IPO list", pg.locator("[data-ipo-watch]").count() == 0 and "my ipo list" not in pg.inner_text("#ipo-body").lower())
    b.close()
print("IPO watch: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)
