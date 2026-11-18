"""Peter Lynch's six stock buckets: rule-based estimate from public fundamentals (screening aid, not advice).
Mirror of docs/zk/lynch.js (the browser version used by the private dashboard); tests/zk_lynch_parity_test.mjs keeps them identical.
  1 Fast Growers (25%+)  2 Stalwarts (15-25%)  3 Cyclicals  4 Slow Growers (<5%)  5 Turnarounds  6 Asset Plays  0 Fund/ETF
"""
import math
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
    """Same rounding as the browser's (v*100).toFixed(0): halves round away from zero (Python's format rounds them to even)."""
    x = v * 100
    r = int(math.floor(abs(x) + 0.5))
    return f"{'-' if x < 0 else ''}{r}%"


_ETC = re.compile(r"^(SGLN|SSLN|SPLT|SPAL|PHAU|PHAG|PHPT|PHPD|IGLN|IGLD|GBSS|XGLD|XSLV|GLD|SLV|IAU|SGOL|SIVR|PPLT|PALL|CMOD|BCOM)$")


def is_commodity_etc(y):
    """Precious-metal ETCs often have no Yahoo fundamentals at all; they are funds, not 'no data'."""
    return bool(_ETC.match(str(y or "").upper().split(".")[0]))


def _cap1(v):
    return max(-1.0, min(1.0, v))


def classify(d, hint=None):
    d = d or {}
    qtype = str(d.get("quoteType") or "").upper()
    sector, industry = d.get("sector") or "", d.get("industry") or ""
    cap, eg, rg, pm, pb = (_num(d.get(k)) for k in ("marketCap", "earningsGrowth", "revenueGrowth", "profitMargins", "priceToBook"))

    # Yahoo's earningsGrowth is the latest quarter vs a year ago (noisy); revenueGrowth is steadier. With both, use the average (each capped at +-100%).
    both = eg is not None and rg is not None
    g = (_cap1(eg) + _cap1(rg)) / 2 if both else (eg if eg is not None else rg)
    basis = "earnings & revenue" if both else ("earnings" if eg is not None else "revenue")

    def out(bucket, reason, confidence="medium"):
        return {"bucket": bucket, "name": BUCKETS[bucket], "reason": reason, "growth": g,
                "basis": basis if g is not None else None, "confidence": confidence}

    if qtype in ("ETF", "MUTUALFUND", "INDEX"):
        return out(0, "Fund or ETF: not a single business", "high")
    if not sector and cap is None and eg is None and rg is None and pm is None:
        if is_commodity_etc(hint):
            return out(0, "Precious-metal fund (ETC): tracks a commodity, not a business", "high")
        return {"bucket": None, "name": "Unclassified", "reason": "No fundamentals available", "growth": None, "basis": None, "confidence": "low"}
    if pb is not None and 0 < pb < 0.8:
        return out(6, f"Trades at {pb:.2f}x book value (under 0.8x): possible hidden assets")
    if pm is not None and pm < 0:
        if rg is not None and rg >= 0.25:
            return out(1, f"Loss-making but revenue up {_pct(rg)}: speculative fast grower (growth is revenue, not profit)", "low")
        return out(5, f"Loss-making (profit margin {_pct(pm)}): recovery story", "medium" if pm < -0.05 else "low")
    if _CYC_SECTORS.search(sector) or _CYC_INDUSTRY.search(industry):
        return out(3, f"{industry or sector}: earnings move with the economic cycle")
    if g is None:
        return {"bucket": None, "name": "Unclassified", "reason": "No growth data", "growth": None, "basis": None, "confidence": "low"}
    conf = "high" if eg is not None else "medium"
    if g >= 0.25:
        return out(1, f"{basis} growth {_pct(g)} (25%+)", conf)
    if g >= 0.15:
        return out(2, f"{basis} growth {_pct(g)} (15-25%)", conf)
    if g >= 0.05:
        if cap is not None and cap >= 10e9:
            return out(2, f"{basis} growth {_pct(g)} and large ({int(math.floor(cap / 1e9 + 0.5))}bn): dependable")
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
