"""Run: python tests/dipplan_layout_test.py — the Dip Planner card (Strategy tab) must fit a phone screen at 320/360/390px with no sideways scroll,
with long pie/stock names, many stocks, every pie state open, and tap targets of at least 40px. Offline: loads docs/js/dipplan.js with the dashboard's own CSS and stub data."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0


def row(ticker, pie, score, display=None, **w):
    base = {"action": "ACCUMULATE", "price": 100, "current": 100, "high_52w": 130, "low_52w": 80, "rsi": 36, "mom_4w": -8, "mom_1w": 1.5, "vol_ratio": 1.4, "pe": 18, "fwd_pe": 16, "t212": ticker + "_US_EQ"}
    base.update(w)
    return {"ticker": ticker, "display": display or ticker, "pie": pie, "score": score, "verdict": "Value Buy", "currency_symbol": "$", "this_week": base, "updated_at": "2026-11-23T08:00:00Z"}


LONG = "A Very Long Company Name Holdings International Incorporated Group plc"
rows = [row("AAA", "Semiconductor Equipment and Manufacturing Leaders Worldwide", 82, LONG, rsi=27), row("BBB", "Semiconductor Equipment and Manufacturing Leaders Worldwide", 70, "BBB Corp"),
        row("CCC", "Semiconductor Equipment and Manufacturing Leaders Worldwide", 60, "CCC Corp", rsi=79, action="HOLD / AVOID", current=129)]
rows += [row(f"W{i}", "World", 74 - i, f"World ETF number {i} accumulating UCITS", pe=None, fwd_pe=None) for i in range(6)]
rows += [row("H1", "Hot", 66, "Hot one", rsi=75, action="HOLD / AVOID", current=130), row("H2", "Hot", 64, "Hot two", rsi=72, action="HOLD / AVOID", current=129)]
rows += [row("SOLO", "Individual", 78, "Solo stock with a quite long display name", rsi=31)]
pies = [{"name": "Semiconductor Equipment and Manufacturing Leaders Worldwide", "instruments": [{"ticker": "AAA_US_EQ", "expected": 0.4, "current": 0.4}, {"ticker": "BBB_US_EQ", "expected": 0.3, "current": 0.3}, {"ticker": "CCC_US_EQ", "expected": 0.3, "current": 0.3}]},
        {"name": "World", "instruments": [{"ticker": f"W{i}_US_EQ", "expected": 1 / 6, "current": 1 / 6} for i in range(6)]},
        {"name": "Hot", "instruments": [{"ticker": "H1_US_EQ", "expected": 0.5, "current": 0.5}, {"ticker": "H2_US_EQ", "expected": 0.5, "current": 0.5}]}]
strat = {"market_mood": {"level": 3, "label": "Extreme fear", "vix": 34.2, "spx_drawdown": 11.4}}

for page in ("docs/index.html", "docs/demo/index.html"):
    html = (ROOT / page).read_text()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    assert "dipplan.js" in html, f"{page} does not load dipplan.js"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b.new_page(viewport={"width": w, "height": 800})
            pg.set_content(f"<style>{css}</style><div class='tab active'><div id='dip-planner-content'></div></div>")
            pg.evaluate("""([rows, pies, strat]) => { window.IS_GUEST = false; window.api = async () => [{ raw: { pies } }]; window.__rows = rows; window.__strat = strat; }""", [rows, pies, strat])
            pg.add_script_tag(path=str(ROOT / "docs/js/dipplan.js"))
            pg.evaluate("async () => { await loadDipPlanner(window.__rows, window.__strat); }")
            pg.fill("#dp-amount", "200")
            pg.click(".dp-go")
            pg.evaluate("() => document.querySelectorAll('.dp-body').forEach(b => { b.style.display = 'block'; })")
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [];
              document.querySelectorAll('#dip-planner-content *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) out.push((e.className || e.tagName) + ''); });
              const small = [...document.querySelectorAll('#dp-amount, .dp-go, .dp-chip, .dp-head')].filter(e => e.getBoundingClientRect().height < 40).map(e => e.className);
              return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 6), small: small.slice(0, 4), pies: document.querySelectorAll('.dp-pie').length, stocks: document.querySelectorAll('.dp-st').length,
                       hasPlan: /Market dip: deploy/.test(document.getElementById('dp-result').textContent) }; }""")
            if res["sideways"] or res["out"] or res["small"] or res["pies"] != 4 or res["stocks"] != len(rows) or not res["hasPlan"]:
                bad += 1
                print(f"✗ {page} {w}px: {res}")
            pg.close()
        b.close()
print("✓ Dip Planner fits 320/360/390px on the live and demo dashboards (no sideways scroll, tap targets ≥ 40px)" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
