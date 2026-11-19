"""Run: python tests/ipo_layout_test.py — the IPO card must fit a phone screen (no sideways overflow) with every country filter, My list and search results.
Offline: renders the shipped seed rows plus a stress row (very long names) with the dashboard's own CSS."""
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
css = "\n".join(re.findall(r"<style>(.*?)</style>", (ROOT / "docs/index.html").read_text(), re.S))
rows = json.loads((ROOT / "config/ipo_calendar.json").read_text())["ipos"]
rows.append({"id": "US:LONG", "market": "US", "exchange": "Nasdaq Global Select Market (dual class listing)", "name": "A Very Long Company Name Holdings International Incorporated",
             "ticker": "VERYLONGTICKER", "sector": "Diversified industrial and technology conglomerate", "status": "open", "start_date": "2026-11-18", "end_date": "2026-11-25",
             "listing_date": "2027-01-05", "currency": "HKD", "price_low": 1234.5, "price_high": 1299.5, "deal_size_usd": 61.05e9, "rating": "Subscribe",
             "rating_source": "Some Broker Research Desk", "note": "x" * 300 + " " + "y" * 120, "source_name": "Long source name " * 5, "source_url": "https://example.com/" + "a" * 200, "as_of": "2026-11-19"})
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    for w in (320, 360, 390):
        pg = b.new_page(viewport={"width": w, "height": 800})
        pg.set_content(f"<style>{css}</style><div class='tab active'><div class='card'><h3>IPO</h3><div id='ipo-content'></div></div></div>")
        pg.add_script_tag(path=str(ROOT / "docs/js/ipo.js"))
        for mk in ("ALL", "US", "UK", "IN", "HK", "OTHER"):
            pg.evaluate("([rows, mk]) => { document.getElementById('ipo-content').innerHTML = IPO.html(rows, { q: '', country: mk, exchange: mk === 'ALL' ? rows[0].exchange : 'ALL' }, '2026-11-19', new Set(rows.slice(0, 3).map(r => r.id))); }", [rows, mk])
            over = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [];
              document.querySelectorAll('#ipo-content *').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) { let p = e.parentElement, clip = false;
                while (p && p.id !== 'ipo-content') { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { const q = p.getBoundingClientRect(); clip = q.right <= W + 1; break; } p = p.parentElement; }
                if (!clip) out.push(e.className || e.tagName); } });
              return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 5) }; }""")
            if over["sideways"] or over["out"]:
                bad += 1; print(f"✗ {w}px {mk}: {over}")
        pg.close()
    b.close()
print("✓ IPO card fits 320/360/390px with every country filter, My list and search results" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
