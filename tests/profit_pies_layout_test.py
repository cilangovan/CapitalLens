"""Run: python tests/profit_pies_layout_test.py — Profit tab (owner: "my semiconductor is up, why is profit booking £0?"):
the separate ⑥ Pie profit check card shows a rising pie with its £ and % gain and what the rules say, the Profit to book pop-up explains a £0 total
(closest stocks to +20%, holdings flagged by score with no £, funds are never auto-trimmed), and both fit 320/360/390px with no sideways scroll."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
api = (ROOT / "docs/js/api.js").read_text()
helpers = "\n".join(re.search(pat, api, re.S).group(0) for pat in (r"function fmt\(v.*?\n", r"function fmtGbp\(v\).*?\n\}", r"function fmtGbpPlain\(v\).*?\n\}", r"function clr\(v\).*?\n"))
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
tp = lambda hit=False: [{"gain": 20, "label": "Trim 10–15%", "price": 1, "unit": "$", "hit": hit, "sell_pct": 10, "sell_qty": 1, "sell_gbp": 4}]
rows = [
  {"ticker": "SEMIa_EQ", "display": "SEMI", "pie": "Semiconductor", "kind": "etf", "value_gbp": 22.1, "weight_pct": 0.5, "gain_pct": 4.1, "score": 58, "action": "Consider partial profit booking / reduce exposure", "action_level": "trim", "trim_plan": [], "breakdown": {}, "signals": {}, "notes": []},
  {"ticker": "ASML", "display": "ASML", "pie": "Semiconductor", "kind": "stock", "value_gbp": 19.3, "weight_pct": 0.4, "gain_pct": 12.5, "score": 71, "action": "Hold & monitor", "action_level": "hold", "trim_plan": tp(), "breakdown": {}, "signals": {}, "notes": []},
  {"ticker": "NVDA", "display": "NVIDIA with a rather long company name", "pie": "", "kind": "stock", "value_gbp": 90, "weight_pct": 2, "gain_pct": 7.0, "score": 66, "action": "Hold & monitor", "action_level": "hold", "trim_plan": tp(), "breakdown": {}, "signals": {}, "notes": []},
]
summ = {"updated_at": "2026-11-23T08:00:00Z", "regime": {"mode": "Neutral", "points": 3}, "sectors": [], "notes": [], "limits": {"risk_per_trade_gbp": 40, "risk_per_trade_pct": 1, "atr_mult": 3},
        "totals": {"holdings_gbp": 4109.43, "invested_gbp": 3900, "suggested_trims_gbp": 0, "counts": {"trim": 2, "reassess": 28, "rebalance": 3, "run": 0, "hold": 0}},
        "pies": [{"pie": "Semiconductor", "gbp": 41.43, "pct": 1.0, "gain_pct": 3.73, "gain_gbp": 1.49, "invested_gbp": 39.94, "avg_score": 64, "flags": ["SEMI"]},
                 {"pie": "Defence", "gbp": 300, "pct": 7.3, "gain_pct": -2.1, "avg_score": 55, "flags": []},
                 {"pie": "Old data pie", "gbp": 100, "pct": 2.4, "gain_pct": 10.0, "avg_score": 60, "flags": []}]}
doc = f"<style>{css}</style><div id='profit-content'></div><script>{helpers}</script>"
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for w in (320, 360, 390):
        pg = b.new_page(viewport={"width": w, "height": 800}); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.set_content(doc); pg.evaluate("window.IS_GUEST = false")
        pg.add_script_tag(path=str(ROOT / "docs/js/profit.js"))
        pg.evaluate("([s, rows]) => { window.api = async (t) => t === 'profit_booking_summary' ? [s] : rows; }", [summ, rows])
        pg.evaluate("() => loadProfit()"); pg.wait_for_selector(".pb-pie")
        r = pg.evaluate("""() => { const t = document.getElementById('profit-content').textContent, W = document.documentElement.clientWidth;
          return { sideways: document.documentElement.scrollWidth > W, card: [...document.querySelectorAll('.card h3')].some(h => h.textContent.includes('Pie profit check')), semi: t.includes('+3.73%') && t.includes('+£1.49'),
            first: document.querySelector('.pb-pie b').textContent, approx: t.includes('≈ +£9.09'), loss: t.includes('In a loss'), early: t.includes('Too early to book'), review: t.includes('Review: +10–20%'),
            sub: t.includes('ladder: none due · 2 flagged by score'), tileTxt: document.querySelectorAll('.pb-tap').length }; }""")
        pg.evaluate("() => pbInfo('trims')")
        m = pg.evaluate("""() => { const t = document.querySelector('.pb-m-body').textContent, box = document.querySelector('.pb-m-box').getBoundingClientRect(), W = document.documentElement.clientWidth;
          return { none: t.includes('No stock has reached a ladder step'), closest: t.includes('Closest to the first step') && t.includes('ASML') && t.includes('7.5 points to +20%'), flagged: t.includes('1 flagged “Book profit” by score') && t.includes('SEMI') && t.includes('fund'),
            funds: t.includes('Funds (ETFs) are hold-and-rebalance'), over: box.right > W + 1 || box.left < -1 }; }""")
        if not (r["card"] and r["semi"] and r["approx"] and r["loss"] and r["early"] and r["review"] and r["sub"] and not r["sideways"] and all(v for k, v in m.items() if k != "over") and not m["over"] and not errs):
            bad += 1; print(f"✗ {w}px: {r} {m} {errs}")
        pg.close()
    b.close()
print("✓ Pie profit check card and the Profit to book explanation fit 320/360/390px and say why £0" if not bad else f"{bad} problem(s)")
sys.exit(1 if bad else 0)
