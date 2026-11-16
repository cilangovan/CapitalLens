#!/usr/bin/env python3
"""
Global Institutional Flow Service — weekly money-flow intelligence report.

Scores 3 markets (USA/NASDAQ, UK/LSE, Europe/XETRA+AMS) out of 100 across 6 weighted indicators:
  - Institutional accumulation  25pts  (ETF volume + price momentum vs avg)
  - Foreign capital flows        20pts  (foreign-proxy ETF flows, FII for India/Taiwan)
  - Domestic institutional flows 15pts  (domestic ETF/fund accumulation proxy)
  - Sector rotation              15pts  (which sectors attracting vs losing capital)
  - Market sentiment             15pts  (RSI, MA alignment, breadth)
  - Valuation / market risk      10pts  (distance from 52w high, PE where available)

Scores:
  80-100 → Strong accumulation — investigate buying opportunities
  65-79  → Positive — consider gradual investment
  45-64  → Neutral — wait for better entry
  <45    → Weak — protect capital

Run via: python -m services.institutional_flow_service
Triggered by weekly_services.yml workflow (Sunday).
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, date, timezone, timedelta

try:
    import yfinance as yf
    import numpy as np
    HAS_YF = True
except ImportError:
    HAS_YF = False
    print("[inst_flow] ERROR: yfinance / numpy not installed")
    exit(1)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

# ── Market definitions ────────────────────────────────────────────────────────
# Each market: benchmark index + institutional proxy ETFs + foreign-flow proxy
MARKETS = {
    # Covers your Magnificent 7 pie (NASDAQ/NYSE holdings)
    "USA": {
        "region":    "USA",
        "label":     "NASDAQ / S&P 500",
        "exchange":  "NASDAQ/NYSE",
        "benchmark": "^IXIC",          # NASDAQ Composite
        "sp500":     "^GSPC",
        "inst_etfs": ["SPY", "QQQ", "IVV", "VOO"],   # large institutional ETFs
        "foreign":   ["EFA", "ACWX"],                  # foreign-inflow proxy
        "currency":  "$",
    },
    # Covers your UK Gold & Silver pie + Country ETF/LSE holdings
    "UK": {
        "region":    "UK",
        "label":     "FTSE 100 / FTSE 250",
        "exchange":  "LSE",
        "benchmark": "^FTSE",
        "inst_etfs": ["ISF.L", "VMID.L", "VUKE.L"],
        "foreign":   ["EWU"],           # US-listed UK ETF — foreign flow proxy
        "currency":  "£",
    },
    # Covers your Wider ETF pie (XETRA .DE + AMS .AS holdings)
    "Europe": {
        "region":    "Europe",
        "label":     "STOXX 50 / DAX / AEX",
        "exchange":  "XETRA/AMS",
        "benchmark": "^STOXX50E",
        "dax":       "^GDAXI",
        "aex":       "^AEX",
        "inst_etfs": ["EXW1.DE", "VEUR.AS", "VWCE.DE"],
        "foreign":   ["EZU", "VGK"],    # US-listed Europe ETFs — foreign flow proxy
        "currency":  "€",
    },
}

# Sector ETFs for rotation tracking (US-centric, most liquid)
SECTOR_ETFS = {
    "Technology":    "XLK",
    "Healthcare":    "XLV",
    "Financials":    "XLF",
    "Energy":        "XLE",
    "Industrials":   "XLI",
    "Consumer Disc": "XLY",
    "Consumer Stpl": "XLP",
    "Utilities":     "XLU",
    "Materials":     "XLB",
    "Real Estate":   "XLRE",
    "Comm Services": "XLC",
}


# ── Supabase helpers ──────────────────────────────────────────────────────────
def sb_get(table, query=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}{query}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  sb_get {table} error: {e}")
        return []


def sb_upsert(table, row, conflict="report_date"):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}"
    req = urllib.request.Request(
        url,
        data=json.dumps([row]).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            print(f"  ✓ upserted report into {table}")
    except urllib.error.HTTPError as e:
        print(f"  ✗ {table} upsert failed {e.code}: {e.read().decode()[:300]}")


# ── Technical helpers ─────────────────────────────────────────────────────────
def calc_rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50.0
    closes = np.array(closes, dtype=float)
    deltas = np.diff(closes)
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    ag = np.mean(gains[:period])
    al = np.mean(losses[:period])
    for i in range(period, len(deltas)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 1)


def fetch_ticker(symbol, period="3mo"):
    """Fetch OHLCV for a symbol. Returns dict or None."""
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period=period, interval="1d", auto_adjust=True)
        if hist.empty or len(hist) < 10:
            return None
        closes  = hist["Close"].tolist()
        volumes = hist["Volume"].tolist()
        highs   = hist["High"].tolist()
        lows    = hist["Low"].tolist()
        current   = closes[-1]
        high_52w  = max(highs)
        low_52w   = min(lows)
        ma20 = float(np.mean(closes[-20:])) if len(closes) >= 20 else closes[-1]
        ma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else closes[-1]
        rsi  = calc_rsi(closes)
        # Volume trend: avg last 5 days vs avg prior 15 days
        vol_recent = float(np.mean(volumes[-5:])) if len(volumes) >= 5 else volumes[-1]
        vol_prior  = float(np.mean(volumes[-20:-5])) if len(volumes) >= 20 else vol_recent
        vol_ratio  = round(vol_recent / vol_prior, 2) if vol_prior > 0 else 1.0
        # Price momentum: % change over 4 weeks
        mom_4w = round((closes[-1] / closes[-20] - 1) * 100, 1) if len(closes) >= 20 else 0.0
        mom_1w = round((closes[-1] / closes[-5] - 1) * 100, 1) if len(closes) >= 5 else 0.0
        pct_from_high = round((current - high_52w) / high_52w * 100, 1)
        pct_from_low  = round((current - low_52w)  / low_52w  * 100, 1)
        return {
            "current":        round(current, 4),
            "ma20":           round(ma20, 4),
            "ma50":           round(ma50, 4),
            "rsi":            rsi,
            "vol_ratio":      vol_ratio,     # >1 = rising volume
            "mom_4w":         mom_4w,
            "mom_1w":         mom_1w,
            "pct_from_high":  pct_from_high,
            "pct_from_low":   pct_from_low,
            "high_52w":       round(high_52w, 4),
            "low_52w":        round(low_52w, 4),
        }
    except Exception as e:
        print(f"    fetch_ticker {symbol}: {e}")
        return None


# ── Scoring engine ────────────────────────────────────────────────────────────
def score_institutional_accumulation(benchmark, inst_etfs_data):
    """
    25pts: Are large institutional ETFs showing volume + price accumulation?
    Look for rising volume + upward price momentum.
    """
    if not inst_etfs_data:
        return 12, "Insufficient data"

    scores = []
    for d in inst_etfs_data:
        if not d:
            continue
        s = 12  # neutral base
        # Volume rising vs recent avg → accumulation
        if d["vol_ratio"] > 1.3:   s += 4
        elif d["vol_ratio"] > 1.1: s += 2
        elif d["vol_ratio"] < 0.8: s -= 3
        # 4-week momentum
        if d["mom_4w"] > 5:        s += 5
        elif d["mom_4w"] > 2:      s += 3
        elif d["mom_4w"] > 0:      s += 1
        elif d["mom_4w"] < -5:     s -= 4
        elif d["mom_4w"] < -2:     s -= 2
        # Above MA20 and MA50 = accumulation
        if d["current"] > d["ma20"] > d["ma50"]: s += 4
        elif d["current"] > d["ma20"]:            s += 2
        elif d["current"] < d["ma20"] < d["ma50"]: s -= 3
        scores.append(min(25, max(0, s)))

    if not scores:
        return 12, "No ETF data"

    score = round(sum(scores) / len(scores))
    if score >= 20:   note = "Strong institutional accumulation"
    elif score >= 15: note = "Moderate accumulation"
    elif score >= 10: note = "Neutral — no clear signal"
    else:             note = "Distribution / outflows"
    return score, note


def score_foreign_flows(foreign_data):
    """
    20pts: Foreign capital moving into this market?
    Measured by US-listed country/region ETF momentum + volume.
    """
    if not foreign_data:
        return 10, "No foreign flow data"

    scores = []
    for d in foreign_data:
        if not d:
            continue
        s = 10
        if d["vol_ratio"] > 1.2:   s += 3
        elif d["vol_ratio"] > 1.0: s += 1
        elif d["vol_ratio"] < 0.9: s -= 2
        if d["mom_4w"] > 4:        s += 5
        elif d["mom_4w"] > 1:      s += 3
        elif d["mom_4w"] > 0:      s += 1
        elif d["mom_4w"] < -4:     s -= 4
        elif d["mom_4w"] < -1:     s -= 2
        if d["rsi"] < 40:          s -= 2   # oversold → foreign selling
        elif d["rsi"] > 60:        s += 2   # foreign buying
        scores.append(min(20, max(0, s)))

    if not scores:
        return 10, "No data"

    score = round(sum(scores) / len(scores))
    if score >= 16:   note = "Strong foreign inflows"
    elif score >= 12: note = "Modest foreign accumulation"
    elif score >= 8:  note = "Neutral foreign flows"
    else:             note = "Foreign capital exiting"
    return score, note


def score_domestic_flows(benchmark_data, inst_etfs_data):
    """
    15pts: Domestic institutional participation.
    Proxy: benchmark above MA50 (domestic funds buying), low-vol drops vs high-vol rises.
    """
    if not benchmark_data:
        return 7, "No benchmark data"

    d = benchmark_data
    s = 7
    # Benchmark vs MAs
    if d["current"] > d["ma20"] > d["ma50"]: s += 5
    elif d["current"] > d["ma20"]:            s += 3
    elif d["current"] < d["ma50"]:            s -= 3
    # 1-week momentum (domestic reaction)
    if d["mom_1w"] > 1.5:   s += 3
    elif d["mom_1w"] > 0:   s += 1
    elif d["mom_1w"] < -2:  s -= 3
    elif d["mom_1w"] < 0:   s -= 1

    score = min(15, max(0, s))
    if score >= 12:  note = "Domestic institutions buying"
    elif score >= 8: note = "Mixed domestic participation"
    else:            note = "Domestic selling pressure"
    return score, note


def score_sentiment(benchmark_data):
    """
    15pts: Market sentiment — RSI, distance from 52w high, MA alignment.
    """
    if not benchmark_data:
        return 7, "No data"

    d = benchmark_data
    rsi = d["rsi"]
    s   = 7

    # RSI-based sentiment
    if rsi < 30:    s += 5    # deeply oversold → fear → potential reversal
    elif rsi < 45:  s += 3
    elif rsi < 55:  s += 1
    elif rsi < 65:  s -= 1
    elif rsi < 75:  s -= 3
    else:           s -= 5    # overbought → greed → risk of correction

    # Distance from 52w high
    pfh = d["pct_from_high"]
    if pfh < -20:   s += 4    # well off highs → value
    elif pfh < -10: s += 2
    elif pfh < -5:  s += 1
    elif pfh > -3:  s -= 2    # near highs → stretched

    score = min(15, max(0, s))
    if score >= 12:  note = f"Risk-on sentiment (RSI {rsi})"
    elif score >= 8: note = f"Neutral sentiment (RSI {rsi})"
    else:            note = f"Risk-off / overbought (RSI {rsi})"
    return score, note


def score_valuation(benchmark_data):
    """
    10pts: Valuation — position in 52w range.
    Lower in range = better value = higher score.
    """
    if not benchmark_data:
        return 5, "No data"

    d = benchmark_data
    pfl = d["pct_from_low"]   # % above 52w low
    pfh = d["pct_from_high"]  # % below 52w high (negative)

    s = 5
    if pfh < -25:   s += 4    # >25% off highs — meaningful discount
    elif pfh < -15: s += 3
    elif pfh < -8:  s += 1
    elif pfh > -3:  s -= 2    # near highs

    score = min(10, max(0, s))
    if score >= 8:   note = f"Undervalued vs 52w range ({pfh}% from high)"
    elif score >= 5: note = f"Fair value ({pfh}% from high)"
    else:            note = f"Near 52w high — stretched valuation"
    return score, note


def analyse_market(key, cfg):
    """Full scoring pipeline for one market region."""
    print(f"\n  [{key}] Fetching data...")

    benchmark_data = fetch_ticker(cfg["benchmark"])
    time.sleep(0.5)

    inst_data = []
    for sym in cfg["inst_etfs"]:
        d = fetch_ticker(sym)
        if d:
            inst_data.append(d)
        time.sleep(0.5)

    foreign_data = []
    for sym in set(cfg["foreign"]):
        d = fetch_ticker(sym)
        if d:
            foreign_data.append(d)
        time.sleep(0.5)

    # Score each category
    s_inst,   n_inst   = score_institutional_accumulation(benchmark_data, inst_data)
    s_foreign, n_foreign = score_foreign_flows(foreign_data)
    s_dom,    n_dom    = score_domestic_flows(benchmark_data, inst_data)
    s_sent,   n_sent   = score_sentiment(benchmark_data)
    s_val,    n_val    = score_valuation(benchmark_data)
    # Sector rotation handled globally — assign neutral 8/15 per market
    s_sector  = 8
    n_sector  = "See sector rotation report"

    total = s_inst + s_foreign + s_dom + s_sector + s_sent + s_val

    if total >= 80:   signal = "Strong Accumulation"
    elif total >= 65: signal = "Positive"
    elif total >= 45: signal = "Neutral"
    else:             signal = "Weak — Protect Capital"

    if total >= 80:   action = "Investigate buying opportunities"
    elif total >= 65: action = "Consider gradual investment"
    elif total >= 45: action = "Wait for better entry points"
    else:             action = "Protect capital — reduce or avoid"

    bm = benchmark_data or {}
    result = {
        "region":    key,
        "label":     cfg["label"],
        "score":     total,
        "signal":    signal,
        "action":    action,
        "currency":  cfg["currency"],
        "breakdown": {
            "institutional_accumulation": {"score": s_inst,    "max": 25, "note": n_inst},
            "foreign_flows":              {"score": s_foreign, "max": 20, "note": n_foreign},
            "domestic_flows":             {"score": s_dom,     "max": 15, "note": n_dom},
            "sector_rotation":            {"score": s_sector,  "max": 15, "note": n_sector},
            "sentiment":                  {"score": s_sent,    "max": 15, "note": n_sent},
            "valuation":                  {"score": s_val,     "max": 10, "note": n_val},
        },
        "market_data": {
            "rsi":           bm.get("rsi"),
            "mom_4w":        bm.get("mom_4w"),
            "mom_1w":        bm.get("mom_1w"),
            "pct_from_high": bm.get("pct_from_high"),
            "pct_from_low":  bm.get("pct_from_low"),
            "above_ma20":    bm.get("current", 0) > bm.get("ma20", 0) if bm else None,
            "above_ma50":    bm.get("current", 0) > bm.get("ma50", 0) if bm else None,
        },
    }

    print(f"    Score: {total}/100 — {signal}")
    return result


def analyse_sectors():
    """Score each US sector ETF for rotation signal."""
    print("\n  [Sectors] Analysing rotation...")
    results = []
    for sector, sym in SECTOR_ETFS.items():
        d = fetch_ticker(sym)
        if not d:
            continue
        score = round(
            (d["mom_4w"] * 2) +           # 4-week price momentum
            (d["vol_ratio"] - 1) * 20 +   # volume vs avg
            (d["rsi"] - 50) * 0.3          # RSI premium
        , 1)
        results.append({
            "sector":    sector,
            "ticker":    sym,
            "score":     score,
            "mom_4w":    d["mom_4w"],
            "mom_1w":    d["mom_1w"],
            "rsi":       d["rsi"],
            "vol_ratio": d["vol_ratio"],
            "signal":    "Inflow" if score > 5 else "Outflow" if score < -5 else "Neutral",
        })
        time.sleep(0.5)

    results.sort(key=lambda x: x["score"], reverse=True)
    leaders  = results[:3]
    laggards = results[-3:][::-1]
    return {"leaders": leaders, "laggards": laggards, "all": results}


def build_opportunities_and_cautions(markets, sector_rotation, positions):
    """
    Generate top 5 opportunities and top 5 cautions from market scores + sector rotation.
    Also cross-reference with current holdings for portfolio-specific actions.
    """
    opportunities = []
    cautions      = []

    # Markets
    for m in sorted(markets, key=lambda x: x["score"], reverse=True):
        if m["score"] >= 65:
            opportunities.append({
                "type":   "Market",
                "name":   m["label"],
                "reason": m["breakdown"]["institutional_accumulation"]["note"],
                "score":  m["score"],
                "action": m["action"],
            })
        elif m["score"] < 45:
            cautions.append({
                "type":   "Market",
                "name":   m["label"],
                "reason": m["breakdown"]["sentiment"]["note"],
                "score":  m["score"],
                "action": m["action"],
            })

    # Sector leaders
    for s in sector_rotation.get("leaders", []):
        if s["score"] > 5:
            opportunities.append({
                "type":   "Sector",
                "name":   s["sector"],
                "reason": f"4w momentum {s['mom_4w']}%, RSI {s['rsi']}, vol ratio {s['vol_ratio']}x",
                "score":  round(50 + s["score"]),
                "action": "Consider increasing sector exposure",
            })

    # Sector laggards
    for s in sector_rotation.get("laggards", []):
        if s["score"] < -5:
            cautions.append({
                "type":   "Sector",
                "name":   s["sector"],
                "reason": f"4w momentum {s['mom_4w']}%, RSI {s['rsi']}, vol ratio {s['vol_ratio']}x",
                "score":  round(50 + s["score"]),
                "action": "Reduce or avoid exposure",
            })

    return opportunities[:5], cautions[:5]


def build_cash_strategy(markets, sector_rotation):
    """Generate a plain-English recommended cash deployment strategy."""
    top_market = max(markets, key=lambda x: x["score"])
    top_sector = sector_rotation["leaders"][0] if sector_rotation.get("leaders") else None

    lines = []
    if top_market["score"] >= 65:
        lines.append(
            f"Priority market: {top_market['label']} (score {top_market['score']}/100). "
            f"{top_market['action']}."
        )
    else:
        lines.append("No market is in strong accumulation territory this week. Hold cash or deploy very gradually.")

    if top_sector and top_sector["score"] > 5:
        lines.append(
            f"Leading sector: {top_sector['sector']} ({top_sector['ticker']}) — "
            f"4w momentum {top_sector['mom_4w']}%, volume {top_sector['vol_ratio']}x average. "
            f"Consider adding to this sector."
        )

    weak = [m for m in markets if m["score"] < 45]
    if weak:
        lines.append(
            f"Avoid new positions in: {', '.join(m['region'] for m in weak)}."
        )

    lines.append(
        "Suggested split for available cash: "
        + ("60% strongest market, 30% leading sector, 10% hold." if top_market["score"] >= 65
           else "80% hold, 20% gradual accumulation in strongest market only.")
    )

    return " ".join(lines)


def exchange_to_region(exchange):
    """Map a T212 exchange string to a scored market region key."""
    ex = (exchange or "").upper()
    if ex in ("NASDAQ/NYSE", "NYSE", "NASDAQ"):
        return "USA"
    if ex == "LSE":
        return "UK"
    if ex in ("XETRA", "AMS", "EURONEXT"):
        return "Europe"
    return None


def build_portfolio_actions(markets, sector_rotation, positions):
    """
    Dynamically map current positions → exchange → market region → action.
    Groups by pie, then by region within each pie.
    Works for any new stocks/ETFs added in the future.
    """
    # Build pie → set of regions from live positions
    pie_regions = {}
    for ticker, pos in positions.items():
        pie    = pos.get("pie") or "Individual"
        region = exchange_to_region(pos.get("exchange", ""))
        if region:
            pie_regions.setdefault(pie, set()).add(region)

    actions = []
    for pie, regions in sorted(pie_regions.items()):
        for region in sorted(regions):
            market = next((m for m in markets if m["region"] == region), None)
            if not market:
                continue
            score = market["score"]
            if score >= 65:
                act = f"ADD gradually — {region} showing positive institutional flows ({score}/100)"
            elif score >= 45:
                act = f"HOLD — {region} neutral, wait for stronger signal ({score}/100)"
            else:
                act = f"REDUCE or AVOID — {region} weak institutional environment ({score}/100)"
            actions.append({"pie": pie, "region": region, "market_score": score, "action": act})

    return actions


def build_summary(markets, sector_rotation):
    """One-paragraph executive summary."""
    best  = max(markets, key=lambda x: x["score"])
    worst = min(markets, key=lambda x: x["score"])
    top_s = sector_rotation["leaders"][0]["sector"] if sector_rotation.get("leaders") else "N/A"
    lag_s = sector_rotation["laggards"][0]["sector"] if sector_rotation.get("laggards") else "N/A"

    return (
        f"Week of {date.today().strftime('%d %b %Y')} | "
        f"Strongest market: {best['label']} ({best['score']}/100, {best['signal']}). "
        f"Weakest: {worst['label']} ({worst['score']}/100, {worst['signal']}). "
        f"Leading sector: {top_s}. Lagging sector: {lag_s}. "
        f"{'Risk-on conditions — gradual deployment supported.' if best['score'] >= 65 else 'Risk-off or neutral — preserve capital and wait for clearer signals.'}"
    )


def run():
    today = date.today().isoformat()
    print(f"[inst_flow] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Load current positions for portfolio-action cross-reference
    positions_raw = sb_get("positions", "?select=ticker,display,pie,exchange&order=pie,ticker")
    positions = {p["ticker"]: p for p in positions_raw} if positions_raw else {}
    print(f"  Loaded {len(positions)} positions for cross-reference")

    # Identify which market regions are actually needed from live positions
    needed_regions = set()
    for pos in positions.values():
        r = exchange_to_region(pos.get("exchange", ""))
        if r:
            needed_regions.add(r)
        else:
            print(f"    [warn] unknown exchange '{pos.get('exchange')}' for {pos['ticker']} — not scored")

    print(f"  Active regions from portfolio: {sorted(needed_regions)}")

    # Analyse only the markets relevant to current holdings
    markets = []
    for key, cfg in MARKETS.items():
        if key in needed_regions:
            result = analyse_market(key, cfg)
            markets.append(result)
            time.sleep(1)
        else:
            print(f"  [{key}] skipped — no current holdings on {cfg['exchange']}")

    # Sector rotation
    if not markets:
        print("[inst_flow] No markets to score — check positions table has exchange data.")
        return

    sector_rotation = analyse_sectors()

    # Opportunities, cautions, cash strategy
    opportunities, cautions = build_opportunities_and_cautions(markets, sector_rotation, positions)
    cash_strategy    = build_cash_strategy(markets, sector_rotation)
    portfolio_actions = build_portfolio_actions(markets, sector_rotation, positions)
    summary          = build_summary(markets, sector_rotation)

    report = {
        "report_date":        today,
        "markets":            json.dumps(markets),
        "sector_rotation":    json.dumps(sector_rotation),
        "opportunities":      json.dumps(opportunities),
        "cautions":           json.dumps(cautions),
        "cash_strategy":      cash_strategy,
        "portfolio_actions":  json.dumps(portfolio_actions),
        "summary":            summary,
    }

    sb_upsert("institutional_flow_reports", report)

    print(f"\n[inst_flow] Done.")
    print(f"  Summary: {summary}")


if __name__ == "__main__":
    run()
