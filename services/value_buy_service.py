#!/usr/bin/env python3
"""
Value Buy Service — live analysis engine for all portfolio holdings.

Drives entirely from the positions table — no hardcoded tickers.
For each distinct holding in the latest snapshot:
  1. Derives Yahoo Finance symbol from T212 ticker + exchange
  2. Fetches current price, 52w range, RSI, MA20/MA50 from Yahoo Finance
  3. Pulls avg cost + quantity from the positions row
  4. Calculates 5-band entry zones (based on 52w range + avg cost)
  5. Generates this-week buy price target (RSI dip + MA support)
  6. Scores: business quality, momentum, valuation, risk → 0-100
  7. Upserts to value_buy_scores, deletes rows for tickers no longer held

Run via: python -m services.value_buy_service
Or triggered by daily_services.yml workflow.
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    import yfinance as yf
    import numpy as np
    HAS_YF = True
except ImportError:
    HAS_YF = False
    print("[value_buy_service] ERROR: yfinance / numpy not installed")
    exit(1)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]


# ── T212 ticker → Yahoo Finance symbol ───────────────────────────────────────
def t212_to_yahoo(t212_ticker, exchange):
    """
    Convert a T212 ticker + exchange into a Yahoo Finance symbol.

    T212 ticker format examples:
      AAPL_US_EQ   → AAPL        (NASDAQ/NYSE)
      FB_US_EQ     → META        (renamed)
      SGLNl_EQ     → SGLN.L      (LSE, ticker ends in 'l' for pence-priced)
      SSLNl_EQ     → SSLN.L
      VWCEd_EQ     → VWCE.DE     (XETRA)
      SXRVd_EQ     → SXRV.DE
      QDVEd_EQ     → QDVE.DE
      VUSAa_EQ     → VUSA.AS     (Euronext Amsterdam)
      CS1l_EQ      → CS1.L
      IAEXl_EQ     → IAEX.L
      IMIBl_EQ     → IMIB.L
      IPOLl_EQ     → IPOL.L
      ITWNl_EQ     → ITWN.L
      XDAXl_EQ     → XDAX.L
      SPCX_US_EQ   → SPCX
    """
    # Known renames (T212 uses old ticker)
    RENAMES = {
        "FB_US_EQ": "META",
    }
    if t212_ticker in RENAMES:
        base = RENAMES[t212_ticker]
        return base, "$"

    # Strip _EQ suffix
    core = t212_ticker.replace("_EQ", "")

    exchange_upper = (exchange or "").upper()

    if exchange_upper in ("NASDAQ/NYSE", "NYSE", "NASDAQ"):
        # e.g. AAPL_US → AAPL, SPCX_US → SPCX
        sym = core.replace("_US", "")
        return sym, "$"

    if exchange_upper == "LSE":
        # T212 uses lowercase 'l' suffix for LSE tickers
        # e.g. SGLNl → SGLN.L, CS1l → CS1.L
        sym = core.rstrip("l") + ".L"
        return sym, "£"

    if exchange_upper == "XETRA":
        # e.g. VWCEd → VWCE.DE, SXRVd → SXRV.DE
        sym = core.rstrip("d") + ".DE"
        return sym, "€"

    if exchange_upper == "AMS":
        # e.g. VUSAa → VUSA.AS
        sym = core.rstrip("a") + ".AS"
        return sym, "€"

    # Fallback: strip trailing exchange letter suffixes and return as-is
    sym = core.split("_")[0]
    return sym, "$"


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


def sb_upsert(table, rows, conflict="ticker"):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}"
    req = urllib.request.Request(
        url,
        data=json.dumps(rows).encode(),
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
            print(f"  ✓ upserted {len(rows)} rows into {table}")
    except urllib.error.HTTPError as e:
        print(f"  ✗ {table} upsert failed {e.code}: {e.read().decode()[:300]}")


# ── Technical analysis helpers ────────────────────────────────────────────────
def calc_rsi(closes, period=14):
    """Calculate RSI from list of closing prices."""
    if len(closes) < period + 1:
        return None
    closes = np.array(closes, dtype=float)
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 1)


def fetch_yahoo_data(yahoo_ticker):
    """Fetch price history + fundamentals from Yahoo Finance."""
    try:
        t = yf.Ticker(yahoo_ticker)
        hist = t.history(period="1y", interval="1d", auto_adjust=True)
        if hist.empty or len(hist) < 20:
            print(f"    insufficient history for {yahoo_ticker}")
            return None

        closes = hist["Close"].tolist()
        highs  = hist["High"].tolist()
        lows   = hist["Low"].tolist()

        current   = round(closes[-1], 4)
        week_high = round(max(highs[-5:]), 4)   # 5-day high
        week_low  = round(min(lows[-5:]),  4)   # 5-day low
        high_52w  = round(max(highs), 4)
        low_52w   = round(min(lows),  4)

        ma20 = round(float(np.mean(closes[-20:])), 4) if len(closes) >= 20 else None
        ma50 = round(float(np.mean(closes[-50:])), 4) if len(closes) >= 50 else None
        rsi  = calc_rsi(closes)

        # Volatility: std dev of daily % returns (annualised)
        returns = np.diff(closes) / closes[:-1]
        vol_daily = float(np.std(returns))
        vol_annual = round(vol_daily * (252 ** 0.5) * 100, 1)  # %

        # Basic fundamentals
        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        return {
            "current":        current,
            "week_high":      week_high,
            "week_low":       week_low,
            "high_52w":       high_52w,
            "low_52w":        low_52w,
            "ma20":           ma20,
            "ma50":           ma50,
            "rsi":            rsi,
            "vol_annual_pct": vol_annual,
            "pe_ratio":       info.get("trailingPE"),
            "forward_pe":     info.get("forwardPE"),
            "target_mean":    info.get("targetMeanPrice"),
            "recommendation": (info.get("recommendationKey") or "none").lower(),
            "analyst_count":  info.get("numberOfAnalystOpinions") or 0,
            "market_cap":     info.get("marketCap"),
            "sector":         info.get("sector", ""),
            "short_name":     info.get("shortName") or info.get("longName") or yahoo_ticker,
        }
    except Exception as e:
        print(f"    Yahoo error for {yahoo_ticker}: {e}")
        return None


# ── Core scoring engine ───────────────────────────────────────────────────────
def build_entry_zones(current, low_52w, high_52w, avg_cost, currency):
    """
    Build 5 entry zones using 52w range + avg cost.
    Zones span from deep value (bottom of range) to overvalued (near 52w high).
    """
    spread = high_52w - low_52w
    if spread <= 0:
        spread = current * 0.3  # fallback: 30% range

    # Zone boundaries (quintiles of 52w range)
    z1 = round(low_52w + spread * 0.00, 2)
    z2 = round(low_52w + spread * 0.20, 2)
    z3 = round(low_52w + spread * 0.40, 2)
    z4 = round(low_52w + spread * 0.60, 2)
    z5 = round(low_52w + spread * 0.80, 2)
    top = round(high_52w, 2)

    sym = currency

    def rating(low_b, high_b):
        # If avg_cost is known, weight rating vs avg cost too
        if avg_cost and avg_cost > 0:
            mid = (low_b + high_b) / 2 if high_b else low_b * 1.1
            if mid < avg_cost * 0.95:
                return "high"   # below your avg cost — strong buy
            elif mid < avg_cost * 1.05:
                return "medium" # near your avg — accumulate
            else:
                return "low"    # above your avg — cautious
        # Fallback: position in 52w range
        mid = (low_b + high_b) / 2 if high_b else low_b * 1.1
        pct_in_range = (mid - low_52w) / spread if spread > 0 else 0.5
        if pct_in_range < 0.3:
            return "high"
        elif pct_in_range < 0.6:
            return "medium"
        else:
            return "low"

    zones = [
        {"label": f"Below {sym}{z2}",           "low": None, "high": z2,  "rating": "high",           "note": "Deep value — strong accumulate"},
        {"label": f"{sym}{z2} – {sym}{z3}",      "low": z2,   "high": z3,  "rating": rating(z2, z3),   "note": "Good entry zone"},
        {"label": f"{sym}{z3} – {sym}{z4}",      "low": z3,   "high": z4,  "rating": rating(z3, z4),   "note": "Fair value"},
        {"label": f"{sym}{z4} – {sym}{z5}",      "low": z4,   "high": z5,  "rating": rating(z4, z5),   "note": "Above fair value — wait for dip"},
        {"label": f"Above {sym}{z5}",            "low": z5,   "high": None,"rating": "low",            "note": "Near 52w high — avoid / trim"},
    ]
    return zones


def build_this_week_target(current, ma20, ma50, rsi, low_52w, high_52w, avg_cost):
    """
    Calculate this week's recommended buy price based on:
    - RSI: oversold (<40) → buy now; neutral → target MA20 support; overbought (>70) → wait
    - MA: price below MA20 → support confirmed; above both MAs → momentum extended
    - Avg cost: buying below avg = adding to position, above = new entry premium
    Returns: {price, action, rationale}
    """
    spread = high_52w - low_52w if high_52w and low_52w else current * 0.3
    action = "HOLD"
    rationale = []
    target = current

    # RSI signal
    if rsi is not None:
        if rsi < 35:
            action = "BUY NOW"
            rationale.append(f"RSI {rsi} — oversold, momentum reversal likely")
            target = current  # buy at market
        elif rsi < 50:
            action = "ACCUMULATE"
            rationale.append(f"RSI {rsi} — weakening momentum, good gradual entry")
            target = round(min(current, ma20 or current) * 0.99, 2)
        elif rsi < 65:
            action = "WAIT FOR DIP"
            rationale.append(f"RSI {rsi} — neutral, target a small pullback")
            target = round((ma20 or current) * 0.97, 2)
        else:
            action = "HOLD / AVOID"
            rationale.append(f"RSI {rsi} — overbought, high entry risk this week")
            target = round((ma20 or current) * 0.93, 2)

    # MA support check
    if ma20 and ma50:
        if current < ma20:
            rationale.append(f"Price below MA20 ({ma20}) — support broken, cautious")
            if action == "ACCUMULATE":
                target = round(current * 0.98, 2)  # give a little more margin
        elif current < ma50:
            rationale.append(f"Price below MA50 ({ma50}) — potential recovery play")
        elif current > ma20 and current > ma50:
            rationale.append(f"Above both MAs — momentum extended, prefer pullback entry")
            if action not in ("BUY NOW", "ACCUMULATE"):
                target = round(ma20 * 0.99, 2)

    # Avg cost context
    if avg_cost and avg_cost > 0:
        diff_pct = round((current - avg_cost) / avg_cost * 100, 1)
        if diff_pct < -10:
            rationale.append(f"Currently {abs(diff_pct)}% below your avg cost — DCA opportunity")
            if action not in ("BUY NOW",):
                action = "DCA — ADD"
        elif diff_pct < 0:
            rationale.append(f"Slightly below avg cost ({diff_pct}%) — good add opportunity")
        elif diff_pct < 10:
            rationale.append(f"Near your avg cost (+{diff_pct}%) — neutral position")
        else:
            rationale.append(f"{diff_pct}% above avg cost — only add on significant pullback")

    return {
        "action":    action,
        "price":     target,
        "rationale": rationale,
    }


def build_scorecard(d, avg_cost):
    """
    Score 0-20 across 5 categories → total /100
    Categories: Business quality, Financial strength, Momentum, Valuation, Risk
    """
    rsi = d.get("rsi") or 50
    ma20 = d.get("ma20") or d["current"]
    ma50 = d.get("ma50") or d["current"]
    current = d["current"]
    low_52w = d["low_52w"]
    high_52w = d["high_52w"]
    vol = d.get("vol_annual_pct") or 30
    recommendation = d.get("recommendation", "none")
    analyst_count = d.get("analyst_count") or 0
    pe = d.get("pe_ratio")
    spread = high_52w - low_52w if high_52w and low_52w else current * 0.3

    # 1. Business quality (analyst consensus + sector)
    bq_map = {"strong_buy": 20, "buy": 17, "hold": 12, "underperform": 7, "sell": 3, "none": 10}
    bq = bq_map.get(recommendation, 10)
    if analyst_count > 20: bq = min(bq + 2, 20)
    elif analyst_count == 0: bq = max(bq - 3, 5)

    # 2. Financial strength (PE ratio vs sector norm)
    fs = 14  # default
    if pe:
        if pe < 15:   fs = 19
        elif pe < 25: fs = 17
        elif pe < 35: fs = 14
        elif pe < 50: fs = 10
        else:         fs = 6
    elif pe is None:  fs = 12  # ETF — no PE, neutral

    # 3. Momentum (RSI + MA alignment)
    if rsi < 30:   mom = 18   # deeply oversold — buy signal
    elif rsi < 45: mom = 16
    elif rsi < 55: mom = 13
    elif rsi < 65: mom = 10
    elif rsi < 75: mom = 7
    else:          mom = 4    # overbought
    # MA bonus
    if current > ma20 > ma50: mom = min(mom + 2, 20)   # golden cross
    elif current < ma20 < ma50: mom = max(mom - 2, 0)  # death cross

    # 4. Valuation (position in 52w range)
    pct_in_range = (current - low_52w) / spread if spread > 0 else 0.5
    if pct_in_range < 0.2:   val = 20
    elif pct_in_range < 0.35: val = 17
    elif pct_in_range < 0.55: val = 13
    elif pct_in_range < 0.75: val = 9
    else:                     val = 5
    # Avg cost context
    if avg_cost and avg_cost > 0:
        below_avg_pct = (avg_cost - current) / avg_cost * 100
        if below_avg_pct > 10:  val = min(val + 2, 20)
        elif below_avg_pct < -15: val = max(val - 2, 0)

    # 5. Risk (volatility + distance from 52w low)
    if vol < 15:   risk = 18
    elif vol < 25: risk = 16
    elif vol < 35: risk = 13
    elif vol < 50: risk = 9
    elif vol < 70: risk = 6
    else:          risk = 3
    # Downside buffer from 52w low
    downside_pct = (current - low_52w) / current * 100 if current > 0 else 0
    if downside_pct > 30: risk = max(risk - 2, 0)   # large downside risk

    total = bq + fs + mom + val + risk
    verdict = (
        "Strong Buy"   if total >= 82 else
        "Value Buy"    if total >= 68 else
        "Accumulate"   if total >= 55 else
        "Hold"         if total >= 42 else
        "Wait for Dip" if total >= 30 else
        "Avoid"
    )

    scorecard = [
        {"category": "Business quality",  "score": bq,   "max": 20},
        {"category": "Financial strength","score": fs,   "max": 20},
        {"category": "Momentum (RSI/MA)", "score": mom,  "max": 20},
        {"category": "Valuation",         "score": val,  "max": 20},
        {"category": "Risk",              "score": risk, "max": 20},
    ]
    return total, verdict, scorecard


def build_warning(d, avg_cost, week):
    """Generate contextual warning text if needed."""
    warnings = []
    rsi = d.get("rsi") or 50
    vol = d.get("vol_annual_pct") or 0
    current = d["current"]

    if rsi > 70:
        warnings.append(f"RSI {rsi} — overbought. High risk of pullback this week.")
    if vol > 50:
        warnings.append(f"Annual volatility {vol}% — high risk asset, size position carefully.")
    if avg_cost and current > avg_cost * 1.2:
        pct = round((current / avg_cost - 1) * 100, 1)
        warnings.append(f"Current price is {pct}% above your avg cost — adding here increases your avg significantly.")
    if current == d["low_52w"] or current < d["low_52w"] * 1.03:
        warnings.append("Near 52-week low — potential value but could signal fundamental deterioration. Verify.")
    return " ".join(warnings) if warnings else None


def analyse_ticker(t212_ticker, yahoo, pie, cur, pos):
    """Full analysis pipeline for one ticker."""
    avg_cost = pos.get("avg_price") or pos.get("avg_cost") or None
    quantity = 0  # not stored in positions table
    display  = pos.get("display") or yahoo
    if avg_cost:
        avg_cost = round(float(avg_cost), 4)

    print(f"  Analysing {yahoo} ({pie})...", end=" ", flush=True)
    d = fetch_yahoo_data(yahoo)
    if not d:
        print("✗ no data")
        return None

    current = d["current"]
    zones   = build_entry_zones(current, d["low_52w"], d["high_52w"], avg_cost, cur)
    week    = build_this_week_target(current, d.get("ma20"), d.get("ma50"), d.get("rsi"), d["low_52w"], d["high_52w"], avg_cost)
    score, verdict, scorecard = build_scorecard(d, avg_cost)
    warning = build_warning(d, avg_cost, week)

    row = {
        "ticker":          yahoo,
        "display":         d.get("short_name") or display,
        "pie":             pie,
        "currency_symbol": cur,
        "score":           score,
        "score_max":       100,
        "verdict":         verdict,
        "entry_zones":     json.dumps(zones),
        "scorecard":       json.dumps(scorecard),
        "earnings":        json.dumps({}),
        "this_week":       json.dumps({
            "action":     week["action"],
            "price":      week["price"],
            "rationale":  week["rationale"],
            "current":    current,
            "avg_cost":   avg_cost,
            "quantity":   quantity,
            "rsi":        d.get("rsi"),
            "ma20":       d.get("ma20"),
            "ma50":       d.get("ma50"),
            "vol_pct":    d.get("vol_annual_pct"),
            "high_52w":   d["high_52w"],
            "low_52w":    d["low_52w"],
            "week_high":  d["week_high"],
            "week_low":   d["week_low"],
        }),
        "warning":    warning,
        "notes":      None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    print(f"✓ {verdict} | score={score} | action={week['action']} | target={cur}{week['price']}")
    return row


def sb_delete_stale(active_yahoo_tickers):
    """Delete rows from value_buy_scores that are no longer in the portfolio."""
    if not active_yahoo_tickers:
        return
    # Build NOT IN filter
    tickers_csv = ",".join(f'"{t}"' for t in active_yahoo_tickers)
    url = f"{SUPABASE_URL}/rest/v1/value_buy_scores?ticker=not.in.({tickers_csv})"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=minimal",
        },
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"  ✓ cleaned up stale rows (status {r.status})")
    except Exception as e:
        print(f"  ⚠ cleanup error: {e}")


def run():
    print(f"[value_buy_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Get latest snapshot id from portfolio_snapshots
    snapshots = sb_get("portfolio_snapshots", "?select=id&order=id.desc&limit=1")
    if not snapshots:
        print("  ERROR: no snapshots found — aborting")
        exit(1)
    snap_id = snapshots[0]["id"]
    print(f"  Using snapshot id={snap_id}")

    positions_raw = sb_get(
        "positions",
        f"?select=ticker,display,pie,exchange,avg_price&snapshot_id=eq.{snap_id}&order=pie,ticker"
    )

    if not positions_raw:
        print("  ERROR: no positions found — aborting")
        exit(1)

    # Deduplicate by ticker (keep latest)
    seen = {}
    for p in positions_raw:
        seen[p["ticker"]] = p
    positions = list(seen.values())
    print(f"  Loaded {len(positions)} distinct positions")

    rows = []
    active_yahoo_tickers = []

    for pos in positions:
        t212_ticker = pos["ticker"]
        exchange    = pos.get("exchange", "")
        pie         = (pos.get("pie") or "Individual").strip()

        yahoo, cur = t212_to_yahoo(t212_ticker, exchange)
        active_yahoo_tickers.append(yahoo)

        row = analyse_ticker(t212_ticker, yahoo, pie, cur, pos)
        if row:
            rows.append(row)
        time.sleep(1.5)  # be kind to Yahoo

    if rows:
        sb_upsert("value_buy_scores", rows)

    # Remove any rows for tickers no longer in the portfolio
    sb_delete_stale(active_yahoo_tickers)

    print(f"[value_buy_service] Done — {len(rows)}/{len(positions)} stocks analysed.")


if __name__ == "__main__":
    run()
