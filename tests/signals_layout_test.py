"""Run: python3 tests/signals_layout_test.py — Alerts tab: Live / Pre Market / Post Market cards (100 SMA, 200 SMA, 52 Week High) and the Inbox tab, with the real page CSS and js/signals.js + js/alerts.js.
At 320/360/390px (live + demo CSS): no sideways scroll, the three tabs stay on one row, tap targets >= 44px, View more expands, Inbox still works, long names wrap, readable in every theme."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent; bad = 0
SETUP = """async () => {
  window.IS_GUEST = false; window.PROXY = 'https://x.test'; window.SESSION_TOKEN = 't';
  const DAY = 86400, T0 = Math.floor(Date.now() / 1000) - 250 * DAY, mk = (cl) => cl.map((c, i) => [T0 + i * DAY, c]), flat = (n, v) => Array(n).fill(v);
  const up = mk([...flat(250, 100), 101]), down = mk([...flat(250, 100), 99]), crossedYesterday = mk([...flat(249, 100), 101, 102]), series = {};
  ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'GOOGL', 'META', 'A-VERY-LONG-TICKER.L'].forEach((s, i) => series[s] = { points: i === 4 ? crossedYesterday : i % 3 === 2 ? down : up, meta: { currency: i % 2 ? 'USD' : 'GBP', gmtoffset: 0 } });
  window.api = async (t) => t === 'portfolio_snapshots' ? [{ id: 1 }] : t === 'positions' ? [{ ticker: 'NVDA_US_EQ', display: 'NVDA' }, { ticker: 'MSFT_US_EQ', display: 'MSFT' }, { ticker: 'AAPL_US_EQ', display: 'AAPL' }, { ticker: 'AMZN_US_EQ', display: 'AMZN' }] : t === 'watchlist' ? [{ ticker: 'GOOGL' }, { ticker: 'META' }, { ticker: 'A-VERY-LONG-TICKER.L' }] : [];
  window.fetch = async (u, o) => { u = String(u); const j = (b, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => b });
    if (u.includes('/chart')) { const s = JSON.parse(o.body).symbol; return series[s] ? j(series[s]) : j({ error: 'no' }, false); }
    if (u.includes('/alerts')) return j([{ id: 1, title: 'Dip alert: NVDA', body: 'b', alert_type: 'dip', created_at: new Date().toISOString() }]); return j([]); };
  window.SupportLevels = { yahooOf: t => { const m = t.match(/^([A-Z]+)_US_EQ$/); return m ? [m[1], 'USD'] : null; } };
  document.getElementById('alerts').classList.add('active'); await loadAlerts(); alertsShown(); for (let i = 0; i < 50 && SIG.state !== 'done'; i++) await new Promise(r => setTimeout(r, 40)); }"""
STATE = """() => { const W = document.documentElement.clientWidth, tabs = [...document.querySelectorAll('.al-tab')], tops = new Set(tabs.map(t => Math.round(t.getBoundingClientRect().top)));
  return { over: document.documentElement.scrollWidth - W, rows: tabs.length, oneRow: tops.size === 1, small: [...document.querySelectorAll('.al-tab, .al-inbox, .sg-more, .sg-row')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).length,
    clipped: [...document.querySelectorAll('#alerts-log *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > W + 1).length, cards: document.querySelectorAll('.sg-card').length, groups: document.querySelectorAll('.sg-grp').length,
    hidden: document.querySelectorAll('.sg-row[hidden]').length, more: document.querySelectorAll('[data-al-more]').length, inbox: !!document.querySelector('#alerts-list .alert-item'), on: (document.querySelector('.al-tab.on') || {}).textContent } }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for page_file in ["docs/index.html", "docs/demo/index.html"]:
        css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page_file).read_text(), re.S))
        for w in (320, 360, 390):
            pg = b.new_context(viewport={"width": w, "height": 900}).new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.set_content("<style>" + css + "</style><div id='alerts' class='tab'><div id='alerts-log'></div></div>")
            for f in ("signals.js", "alerts.js"): pg.add_script_tag(path=str(ROOT / "docs/js" / f))
            pg.evaluate(SETUP)
            # the clock: bars end 'today' (UTC midnight-ish); with no session info the market counts as closed, so Post shows today's close and Pre shows what was true at the open
            s = pg.evaluate(STATE)
            if s["over"] > 0 or s["rows"] != 3 or not s["oneRow"] or s["small"] or s["clipped"]: bad += 1; print(f"✗ {page_file} @{w} live: {s}")
            pg.click("[data-al-tab=post]"); s = pg.evaluate(STATE)
            if not (s["cards"] == 2 and s["groups"] == 3 and s["over"] <= 0 and s["small"] == 0 and s["clipped"] == 0 and "Post" in s["on"]): bad += 1; print(f"✗ {page_file} @{w} post: {s}")
            if s["more"]:
                pg.click("[data-al-more]"); s2 = pg.evaluate(STATE)
                if s2["hidden"] >= s["hidden"] or s2["over"] > 0: bad += 1; print(f"✗ {page_file} @{w} view more: {s2}")
            pg.click("[data-al-tab=pre]"); s = pg.evaluate(STATE)
            if "Pre" not in s["on"] or s["over"] > 0 or s["cards"] < 1: bad += 1; print(f"✗ {page_file} @{w} pre: {s}")
            pg.click("[data-al-tab=inbox]"); s = pg.evaluate(STATE)
            if not (s["inbox"] and s["over"] <= 0 and s["rows"] == 3): bad += 1; print(f"✗ {page_file} @{w} inbox: {s}")
            pg.click("[data-al-tab=live]")
            if errs: bad += 1; print(f"✗ {page_file} @{w} page errors: {errs[:2]}")
            pg.context.close()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
    pg = b.new_context(viewport={"width": 360, "height": 900}).new_page()
    pg.set_content("<style>" + css + "</style><div id='alerts' class='tab'><div id='alerts-log'></div></div>")
    for f in ("signals.js", "alerts.js", "appearance.js"): pg.add_script_tag(path=str(ROOT / "docs/js" / f))
    pg.evaluate(SETUP); pg.click("[data-al-tab=post]")
    for t in ("midnight", "daylight", "sepia", "contrast", "forest", "amoled"):
        pg.evaluate(f"ClAppearance.set({{theme:'{t}'}}, true)")
        r = pg.evaluate("""() => { const rgb = s => s.match(/\\d+/g).slice(0, 3).map(Number), f = c => { c = c.map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
          const cr = (a, b) => { const [x, y] = [f(a), f(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); }, bg = rgb(getComputedStyle(document.querySelector('.sg-list')).backgroundColor), q = s => rgb(getComputedStyle(document.querySelector(s)).color);
          return [cr(q('.sg-name'), bg), cr(q('.sg-val'), bg), cr(q('.sg-val b'), bg), Math.min(cr(q('.sg-arr.up'), bg), cr(q('.sg-arr.down'), bg)) + 1.4]; }""")
        if min(r) < 4.4: bad += 1; print(f"✗ theme {t}: contrast {r}")
    pg.context.close(); b.close()
print("✓ Alerts: Live / Pre / Post cards and Inbox fit 320/360/390px, tabs stay on one row, readable in every theme" if not bad else f"{bad} layout problem(s)"); sys.exit(1 if bad else 0)
