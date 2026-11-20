"""Run: python tests/support_layout_test.py — the Support Levels section must fit a phone screen (no sideways overflow) at 320/360/390px,
with every status, long names, long tags and a long summary table. Offline: renders stress rows with the dashboard's own CSS."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
for page in ("docs/index.html", "docs/demo/index.html"):
    css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / page).read_text(), re.S))
    L = lambda s, lo, hi, **o: dict({"symbol": s, "name": s + " Incorporated", "level_label": "Support zone", "zone_low": lo, "zone_high": hi, "approx": False, "currency": "USD", "tags": [],
                                     "snap_price": 100, "snap_pct_from_high": -25, "source_name": "KwickScan.com", "as_of": "2026-11-20"}, **o)
    levels = [L("META", 550, 560, tags=[{"t": "Crucial support zone", "tone": "warn"}]), L("CRM", 150, 150, level_label="Wait for", tags=[{"t": "In free fall", "tone": "bad"}, {"t": "Not touching it before $150", "tone": "neutral"}]),
              L("INTC", 51, 52, tags=[{"t": "200-week EMA", "tone": "neutral"}, {"t": "Previous breakout", "tone": "good"}]), L("NVDA", 138, 140), L("QCOM", 150, 160), L("NOW", 80, 83),
              L("LONG", 1234.5, 1299.5, name="A Very Long Company Name Holdings International Incorporated Group", approx=True, currency="HKD",
                tags=[{"t": "A very long tag label that keeps going and going " * 2, "tone": "warn"}], source_name="Very long source name " * 5)]
    levels.append(L("OLD", 10, 11, as_of="2026-01-01"))                       # stale chip + note
    levels.append(L("CMP", 200.12, 200.12, computed=True, source_name="CapitalLens (computed)", note="200-week EMA from 260 weekly closes", tags=[{"t": "200-week EMA (computed)", "tone": "neutral"}]))
    live = {"META": {"price": 596.22, "high52": 796, "avgCost": 500, "sym": "$"}, "CRM": {"price": 183.31, "high52": 360, "sym": "$"}, "INTC": {"price": 48, "sym": "$"},
            "NVDA": {"price": 139, "sym": "$"}, "OLD": {"price": 10.5, "sym": "$"}, "CMP": {"price": 210, "sym": "$"}, "QCOM": {"price": 155.5, "sym": "$"}, "NOW": {"price": 82, "sym": "$"}}
    held = [l["symbol"] for l in levels]
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b.new_page(viewport={"width": w, "height": 800})
            pg.set_content(f"<style>{css}</style><div class='tab active'><div id='support-levels-content'></div></div>")
            pg.add_script_tag(path=str(ROOT / "docs/js/support.js"))
            pg.evaluate("([lv, held, live]) => { document.getElementById('support-levels-content').innerHTML = SupportLevels.html(SupportLevels.build(lv, new Set(held), live), 0, '2026-11-25', { filter: 'ALL', counts: { ALL: 9, stock: 5, etf: 3, commodity: 1 }, failed: 2 }); }", [levels, held, live])
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [];
              document.querySelectorAll('#support-levels-content *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) { let p = e.parentElement, clip = false;
                while (p && p.id !== 'support-levels-content') { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { const q = p.getBoundingClientRect(); clip = q.right <= W + 1; break; } p = p.parentElement; }
                if (!clip) out.push(e.className || e.tagName); } });
              return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 5), cards: document.querySelectorAll('.sl-card').length }; }""")
            if res["sideways"] or res["out"] or res["cards"] != len(levels):
                bad += 1; print(f"✗ {page} {w}px: {res}")
            pg.close()
        b.close()
print("✓ Support Levels fits 320/360/390px on the live and demo dashboards" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
