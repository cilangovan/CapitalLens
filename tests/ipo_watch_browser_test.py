"""Run: python tests/ipo_watch_browser_test.py — real clicks: Watch an IPO, see it under ⭐ Watching, remove it, and a failed save is undone.
Offline: the page uses the dashboard's own CSS and ipo.js; the data calls (PROXY) are answered by a tiny in-page fake."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
rows = json.loads((ROOT / "config/ipo_calendar.json").read_text())["ipos"]
FAKE = """(() => {
  window.PROXY = 'https://fake/rest/v1'; window.__watch = ['UK:AIRTELMONEY']; window.__fail = false; window.__posts = [];
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

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"]); pg = b.new_page(viewport={"width": 390, "height": 900})
    pg.set_content(f"<style>{css}</style><div class='card'><h3>IPO</h3><div id='ipo-content'></div></div>")
    pg.evaluate(FAKE); pg.add_script_tag(path=str(ROOT / "docs/js/ipo.js")); pg.evaluate("loadIpo()")
    pg.wait_for_selector(".ipo-card")
    check("a saved watch shows as 'Watching' with a remove button", pg.locator('[data-ipo-watch="UK:AIRTELMONEY"].on').count() == 1)
    pg.click('[data-ipo-watch="US:ANT"]'); pg.wait_for_selector('[data-ipo-watch="US:ANT"].on')
    check("tapping ☆ Watch saves it (POST watch) and flips the button at once", pg.evaluate("window.__posts.at(-1).join()") == "watch,US:ANT")
    pg.click('[data-ipo-mkt="WATCH"]')
    names = pg.locator(".ipo-card .ipo-name b").all_inner_texts()
    check("⭐ Watching tab lists exactly the watched IPOs", sorted(names) == ["Airtel Money", "Anthropic"])
    pg.click('[data-ipo-watch="UK:AIRTELMONEY"]'); pg.wait_for_function("document.querySelectorAll('.ipo-card').length === 1")
    check("tapping a watched IPO removes it (POST unwatch) and it leaves the Watching tab", pg.evaluate("window.__posts.at(-1).join()") == "unwatch,UK:AIRTELMONEY" and pg.locator(".ipo-card").count() == 1)
    pg.evaluate("window.__fail = true"); pg.click('[data-ipo-watch="US:ANT"]'); pg.wait_for_selector("text=Could not remove")
    check("a failed remove is undone with a message (still watched)", pg.locator('[data-ipo-watch="US:ANT"].on').count() == 1)
    btn = pg.locator('[data-ipo-watch="US:ANT"]').bounding_box()
    check("the button is a comfortable tap target (>= 40px tall, fits the 390px screen)", btn["height"] >= 40 and btn["x"] >= 0 and btn["x"] + btn["width"] <= 390)
    # where watching is not offered (legacy page), no buttons at all
    pg.evaluate("(() => { window.fetch = async (u) => u.includes('ipo_watch') ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => %s }; })()" % json.dumps(rows))
    pg.evaluate("loadIpo()"); pg.wait_for_selector(".ipo-card")
    check("where per-user watching is not available, no Watch buttons or Watching tab appear", pg.locator("[data-ipo-watch]").count() == 0 and pg.locator('[data-ipo-mkt="WATCH"]').count() == 0)
    b.close()
print("IPO watch: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)
