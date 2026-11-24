"""Run: python tests/swing_layout_test.py — the Swing tab must fit a phone at 320/360/390px (no sideways scroll, tap targets >= 40px) in all three states:
gate closed (no passing back-test: NO entries shown), gate open with entries, gate open with no entry. Also proves the honesty rules in the page itself:
with no passing back-test no entry is ever drawn, and with no entry the card says so. Offline: loads docs/js/swing.js with the dashboard's own CSS and stub data."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0

GOOD = {"generated": "2026-11-24T03:00:00Z", "symbols": 88, "years": 5, "cost": 0.004, "caveat": "Survivorship bias.",
        "all": {"trades": 420, "winRate": 47.1, "expectancy": 0.62, "profitFactor": 1.41, "avgR": 0.3, "maxDrawdown10pct": 6.2},
        "out_of_sample": {"trades": 150, "winRate": 45.0, "expectancy": 0.41, "profitFactor": 1.3},
        "baseline": {"trades": 900, "winRate": 53.0, "expectancy": 0.22, "profitFactor": 1.1}}
BAD = dict(GOOD, out_of_sample={"trades": 150, "winRate": 40.0, "expectancy": -0.2, "profitFactor": 0.9})

# builds the same synthetic pullback-bounce series the unit test uses, in the page
GEN = """() => {
  const mk = (kind) => { const c = []; let p = 100;
    if (kind === 'down') { for (let i = 0; i < 100; i++) c.push(200 - i); }
    else { for (let i = 0; i < 90; i++) { p *= 1 + 0.004 + (i % 3 === 0 ? 0.006 : -0.002); c.push(p); } for (let i = 0; i < 6; i++) { p *= 0.988; c.push(p); } p *= 1.012; c.push(p); }
    return c.map((x, i) => { const o = (kind !== 'down' && i === c.length - 1) ? c[i - 1] * 0.998 : (i ? c[i - 1] : x), rg = 0.012 * x; return [86400 * (i + 1), o, Math.max(o, x) + rg / 2, Math.min(o, x) - rg / 2, x, (kind !== 'down' && i === c.length - 1) ? 3.2e6 : 2e6]; }); };
  window.__c = { up: mk('up'), down: mk('down') };
}"""
LONG = "A Very Long Company Name Holdings International Incorporated Group plc"
VB = [{"ticker": "UPP", "display": LONG, "pie": "Individual", "score": 82, "verdict": "Value Buy", "currency_symbol": "$"},
      {"ticker": "DWN", "display": "Falling Corp", "pie": "", "score": 75, "verdict": "Accumulate", "currency_symbol": "$"},
      {"ticker": "INPIE", "display": "Inside a pie", "pie": "Chips", "score": 90, "verdict": "Value Buy", "currency_symbol": "$"},
      {"ticker": "WEAK", "display": "Low quality", "pie": "Individual", "score": 40, "verdict": "Hold", "currency_symbol": "$"}]


def run(page, state):
    global bad
    html = (ROOT / page).read_text()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    assert "swing.js" in html and 'id="swing-content"' in html and "showTab('swing'" in html, f"{page} is missing the Swing tab"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b.new_page(viewport={"width": w, "height": 800})
            pg.set_content(f"<style>{css}</style><div class='tab active' id='swing'><div id='swing-content'></div></div>")
            pg.evaluate(GEN)
            report = {"gate_closed": None, "bad_report": BAD, "entry": GOOD, "none": GOOD}[state]
            pg.evaluate("""([vb, report, state]) => { window.IS_GUEST = false; window.PROXY = 'https://x.test'; window.SESSION_TOKEN = 't';
              window.api = async (t) => t === 'value_buy_scores' ? vb : [];
              window.fetch = async (url, opts) => {
                const ok = (j) => ({ ok: true, status: 200, json: async () => j });
                if (/swing_backtest/.test(url)) return report ? ok(report) : { ok: false, status: 404, json: async () => ({}) };
                const sym = JSON.parse(opts.body).symbol, c = (state === 'none' || sym === 'DWN') ? window.__c.down : window.__c.up;
                return ok({ symbol: sym, candles: c, points: c.map(x => [x[0], x[4]]), meta: { price: c[c.length - 1][4], session: null } }); }; }""", [VB, report, state])
            pg.add_script_tag(path=str(ROOT / "docs/js/swing.js"))
            pg.evaluate("async () => { await loadSwing(); while (_sw.busy || !_sw.rows.length) { await new Promise(r => setTimeout(r, 30)); if (!_sw.busy && !_sw.rows.length && swValidated(_sw.report).ok === false) break; } }")
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [], root = document.getElementById('swing-content');
              root.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) out.push((e.className || e.tagName) + ''); });
              const small = [...root.querySelectorAll('input, button')].filter(e => e.getBoundingClientRect().height < 40).map(e => e.tagName);
              const t = root.textContent; return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 6), small: small.slice(0, 4),
                entries: (t.match(/ENTRY ·/g) || []).length, noEntry: /No entry today/.test(t), blocked: /No entries are shown until|⛔/.test(t), inPie: /Inside a pie/.test(t), weak: /Low quality/.test(t) }; }""")
            want = {"gate_closed": dict(entries=0, blocked=True), "bad_report": dict(entries=0, blocked=True), "entry": dict(entries=1, blocked=False), "none": dict(entries=0, blocked=False, noEntry=True)}[state]
            wrong = [k for k, v in want.items() if res[k] != v]
            if res["sideways"] or res["out"] or res["small"] or wrong or res["inPie"]:
                bad += 1
                print(f"✗ {page} {state} {w}px: {res} wrong={wrong}")
            pg.close()
        b.close()


for page in ("docs/index.html", "docs/demo/index.html"):
    for state in ("gate_closed", "bad_report", "entry", "none"):
        run(page, state)
print("✓ Swing tab fits 320/360/390px, shows no entry without a passing back-test, shows one entry when valid and says 'No entry today' otherwise" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
