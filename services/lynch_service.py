"""Peter Lynch's six stock buckets: rule-based estimate from public fundamentals (screening aid, not advice).
Mirror of docs/zk/lynch.js (the browser version used by the private dashboard); tests/zk_lynch_parity_test.mjs keeps them identical.
  1 Fast Growers (25%+)  2 Stalwarts (15-25%)  3 Cyclicals  4 Slow Growers (<5%)  5 Turnarounds  6 Asset Plays  0 Fund/ETF
"""
import re

BUCKETS = {0: "Fund / ETF", 1: "Fast Grower", 2: "Stalwart", 3: "Cyclical", 4: "Slow Grower", 5: "Turnaround", 6: "Asset Play"}
_CYC_SECTORS = re.compile(r"^(energy|basic materials)$", re.I)
_CYC_INDUSTRY = re.compile(r"airline|aerospace|defen[cs]e|semiconductor|auto|steel|chemical|mining|oil|gas|metals|shipping|marine|homebuild|construction|building|paper|packaging|trucking|railroad|farm|heavy|machinery", re.I)


def _num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def _pct(v):
    return f"{v * 100:.0f}%"


def classify(d):
    d = d or {}
    qtype = str(d.get("quoteType") or "").upper()
    sector, industry = d.get("sector") or "", d.get("industry") or ""
    cap, eg, rg, pm, pb = (_num(d.get(k)) for k in ("marketCap", "earningsGrowth", "revenueGrowth", "profitMargins", "priceToBook"))

    def out(bucket, reason, confidence="medium"):
        return {"bucket": bucket, "name": BUCKETS[bucket], "reason": reason, "growth": eg if eg is not None else rg,
                "basis": "earnings" if eg is not None else ("revenue" if rg is not None else None), "confidence": confidence}

    if qtype in ("ETF", "MUTUALFUND", "INDEX"):
        return out(0, "Fund or ETF: not a single business", "high")
    if not sector and cap is None and eg is None and rg is None and pm is None:
        return {"bucket": None, "name": "Unclassified", "reason": "No fundamentals available", "growth": None, "basis": None, "confidence": "low"}
    if pb is not None and 0 < pb < 0.8:
        return out(6, f"Trades at {pb:.2f}x book value (under 0.8x): possible hidden assets")
    if pm is not None and pm < 0:
        if rg is not None and rg >= 0.25:
            return out(1, f"Loss-making but revenue up {_pct(rg)}: speculative fast grower (growth is revenue, not profit)", "low")
        return out(5, f"Loss-making (profit margin {_pct(pm)}): recovery story", "medium" if pm < -0.05 else "low")
    if _CYC_SECTORS.search(sector) or _CYC_INDUSTRY.search(industry):
        return out(3, f"{industry or sector}: earnings move with the economic cycle")
    g = eg if eg is not None else rg
    basis = "earnings" if eg is not None else "revenue"
    if g is None:
        return {"bucket": None, "name": "Unclassified", "reason": "No growth data", "growth": None, "basis": None, "confidence": "low"}
    conf = "high" if eg is not None else "medium"
    if g >= 0.25:
        return out(1, f"{basis} growth {_pct(g)} (25%+)", conf)
    if g >= 0.15:
        return out(2, f"{basis} growth {_pct(g)} (15-25%)", conf)
    if g >= 0.05:
        if cap is not None and cap >= 10e9:
            return out(2, f"{basis} growth {_pct(g)} and large ({cap / 1e9:.0f}bn): dependable")
        return out(4, f"{basis} growth {_pct(g)}, mid/small size")
    return out(4, f"{basis} growth {_pct(g)} (under 5%)", conf)


def fetch_fundamentals(yahoo_ticker):
    """Fundamentals for classify() from yfinance; {} on any failure (a rating must never fail because of this)."""
    try:
        import yfinance as yf
        info = yf.Ticker(yahoo_ticker).info or {}
        return {k: info.get(k) for k in ("quoteType", "sector", "industry", "marketCap", "earningsGrowth", "revenueGrowth", "profitMargins", "priceToBook")}
    except Exception as e:
        print(f"  lynch fundamentals failed for {yahoo_ticker}: {e}")
        return {}
