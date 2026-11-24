"""Run: python tests/paper_layout_test.py — the Paper trading card (Swing tab) must fit a phone at 320/360/390px with no sideways scroll and tap targets >= 40px,
in three states: not started (asks for the weekly amount, no default), running with positions / queued orders / closed trades / a chart, and the reset confirmation.
Offline: loads docs/js/swing.js + paper.js with the dashboard's own CSS and a stored state."""
import re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bad = 0
LONG = "A Very Long Company Name Holdings International Incorporated Group plc"
STATE = """() => {
  const day = 86400, t0 = 1767225600, eq = Array.from({ length: 30 }, (_, i) => ({ d: '2026-02-' + String(i % 28 + 1).padStart(2, '0'), trend: 30 + i * 4.1 + (i % 5), etf: 30 + i * 3.7, dep: 30 + Math.floor(i / 7) * 30 }));
  return { v: 1, weekly: 30, start: Date.now() - 40 * 86400000, weeks: ['a', 'b', 'c', 'd'], dep: 120, seen: [], equity: eq,
    trend: { cash: 10.5, pos: [{ sym: 'AAA', name: '@@LONG@@', entry: 123.45, qty: 0.24, entryT: t0, signalT: t0 - day, checkedT: t0, exitPending: 'closed below its 50-day average' }, { sym: 'BBB', name: 'Beta', entry: 9.87, qty: 3, entryT: t0, signalT: t0 - day, checkedT: t0, exitPending: null }],
      pending: [{ sym: 'CCC', name: 'Gamma Group', signalT: t0, ceiling: 10, stop: 8, close: 9 }],
      closed: Array.from({ length: 10 }, (_, i) => ({ sym: 'S' + i, name: i === 0 ? '@@LONG@@' : 'Stock ' + i, entry: 10, exit: i % 2 ? 9 : 11, entryT: t0, exitT: t0 + 20 * day, pnl: i % 2 ? -3 : 3, ret: i % 2 ? -0.1 : 0.1, why: 'closed below its 50-day average' })) },
    etf: { units: 1.2, buys: [] }, run: Date.now() };
}""".replace("@@LONG@@", LONG)


def run(page, state):
    global bad
    html = (ROOT / page).read_text()
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    assert "paper.js" in html and 'id="paper-content"' in html, f"{page} is missing the paper card"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        for w in (320, 360, 390):
            pg = b.new_page(viewport={"width": w, "height": 800})
            pg.set_content(f"<style>{css}</style><div class='tab active' id='swing'><div id='swing-content'></div><div id='paper-content'></div></div>")
            pg.evaluate("() => { window.IS_GUEST = false; window.api = async () => []; window.PROXY = 'https://x.test'; }")
            pg.add_script_tag(path=str(ROOT / "docs/js/swing.js"))
            pg.add_script_tag(path=str(ROOT / "docs/js/paper.js"))
            if state == "start":
                pg.evaluate("() => { _pp.loaded = true; _pp.state = null; renderPaper(); }")
            else:
                pg.evaluate("(s) => { _pp.loaded = true; _pp.state = s; _pp.events = [{ text: 'Bought Beta at 9.87' }]; _pp.confirm = " + ("true" if state == "confirm" else "false") + "; renderPaper(); }", pg.evaluate(STATE))
            res = pg.evaluate("""() => { const W = document.documentElement.clientWidth, out = [], root = document.getElementById('paper-content');
              root.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1) && e.tagName !== 'polyline') out.push((e.className && e.className.baseVal === undefined ? e.className : e.tagName) + ''); });
              const small = [...root.querySelectorAll('input, button')].filter(e => e.getBoundingClientRect().height < 40).map(e => e.textContent || e.id);
              const t = root.textContent; return { sideways: document.documentElement.scrollWidth > W, out: out.slice(0, 6), small: small.slice(0, 4), askAmount: !!document.getElementById('pp-weekly'), defaultAmount: (document.getElementById('pp-weekly') || {}).value || '',
                hasChart: !!root.querySelector('svg'), hasPos: /Beta/.test(t) && /Queued for the next open/.test(t), hasConfirm: /Yes, delete this paper account/.test(t), fake: /fake money/i.test(t) }; }""")
            want = {"start": res["askAmount"] and res["defaultAmount"] == "" and res["fake"], "run": (not res["askAmount"]) and res["hasChart"] and res["hasPos"] and not res["hasConfirm"], "confirm": res["hasConfirm"]}[state]
            if res["sideways"] or res["out"] or res["small"] or not want:
                bad += 1
                print(f"✗ {page} {state} {w}px: {res}")
            pg.close()
        b.close()


for page in ("docs/index.html", "docs/demo/index.html"):
    for state in ("start", "run", "confirm"):
        run(page, state)
print("✓ Paper trading card fits 320/360/390px (start, running, reset confirmation); the start screen has no default amount" if not bad else f"{bad} layout problem(s)")
sys.exit(1 if bad else 0)
