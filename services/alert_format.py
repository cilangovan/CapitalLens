"""
Alert formatter — one house style for every alert (dashboard, push, email).

Each alert is a list of numbered Sections:

    1. Taiwan (ITWN) — overweight
    Measure                           Weight
    Last reported holding (16 Nov)    38.44%
    Strategic target                  25.00%
    Difference                        +13.44 percentage points
    Source: Trading 212 API pie data, 16 Nov 2026 16:42 UTC.
    Review flag: Keep regular Taiwan additions paused while it remains overweight.

render_text()  → monospaced, column-aligned (dashboard + email)
render_push()  → "label: value" lines (phone push, proportional font)
"""

import re

MINUS = "−"  # typographic minus, as used in the reports

# Friendly names for holdings (falls back to T212 metadata name, then ticker)
NAMES = {
    "ITWN": "Taiwan", "IPOL": "Poland", "IMIB": "Italy", "CS1": "Spain",
    "XDAX": "Germany", "IAEX": "Netherlands",
    "VFEM": "Emerging Markets", "VEVE": "Developed World",
    "SGLN": "Gold", "SSLN": "Silver",
    "VWCE": "FTSE All-World", "VUSA": "S&P 500", "SXRV": "Nasdaq-100", "QDVE": "S&P 500 IT",
    "FB": "Meta", "GOOGL": "Alphabet", "AAPL": "Apple", "MSFT": "Microsoft",
    "AMZN": "Amazon", "NVDA": "Nvidia",
}

CCY_SYMBOL = {"GBP": "£", "USD": "$", "EUR": "€"}


def base_symbol(t212_ticker):
    """ITWNl_EQ → ITWN, AAPL_US_EQ → AAPL, CS1l_EQ → CS1."""
    core = (t212_ticker or "").replace("_EQ", "")
    if core.endswith("_US"):
        return core[:-3]
    m = re.match(r"^([A-Z0-9.]+)[a-z]?$", core)
    return m.group(1) if m else core


def friendly(t212_ticker, meta_name=None):
    sym = base_symbol(t212_ticker)
    name = NAMES.get(sym) or (meta_name or "").strip()
    return f"{name} ({sym})" if name and name != sym else sym


def short_name(t212_ticker, meta_name=None):
    sym = base_symbol(t212_ticker)
    return NAMES.get(sym) or (meta_name or "").strip() or sym


def signed(v, decimals=2):
    s = f"{abs(v):.{decimals}f}"
    if round(v, decimals) == 0:
        return s
    return ("+" if v > 0 else MINUS) + s


def pct(v, decimals=2, sign=True):
    return (signed(v, decimals) if sign else f"{v:.{decimals}f}") + "%"


def pp(v):
    return f"{signed(v)} percentage points"


def money(v, ccy):
    """£31.48 / £31.995 (keeps a 3rd decimal only when it matters)."""
    s = f"{v:,.3f}"
    if s.endswith("0"):
        s = s[:-1]
    sym = CCY_SYMBOL.get(ccy)
    return f"{sym}{s}" if sym else f"{s} {ccy}"


def day_month(dt):
    return f"{dt.day} {dt.strftime('%b')}"


def full_date(dt):
    return f"{dt.day} {dt.strftime('%B %Y')}"


class Section:
    """Ordered blocks: tables and text lines render in the order they were added."""
    def __init__(self, title):
        self.title = title
        self.blocks = []   # ("table", left, right, rows) | ("line", text)

    def table(self, left, right, rows):
        self.blocks.append(("table", left, right, rows)); return self

    def line(self, text):
        self.blocks.append(("line", text)); return self


def _render_table(left, right, rows):
    w = max([len(left)] + [len(r[0]) for r in rows]) + 2
    out = [f"{left.ljust(w)}{right}"]
    out += [f"{lbl.ljust(w)}{val}" for lbl, val in rows]
    return out


def render_text(sections):
    out = []
    for i, s in enumerate(sections, 1):
        out.append(f"{i}. {s.title}")
        for b in s.blocks:
            out += _render_table(*b[1:]) if b[0] == "table" else [b[1]]
        out.append("")
    return "\n".join(out).rstrip()


def render_push(sections, limit=3800):
    out = []
    for i, s in enumerate(sections, 1):
        out.append(f"{i}. {s.title}")
        for b in s.blocks:
            if b[0] == "table":
                out += [f"• {lbl}: {val}" for lbl, val in b[3]]
            elif not b[1].startswith("Source:"):
                out.append(b[1])
        out.append("")
    text = "\n".join(out).rstrip()
    if len(text) > limit:
        text = text[:limit].rsplit("\n", 1)[0] + "\n… full report on the dashboard"
    return text
