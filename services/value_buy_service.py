#!/usr/bin/env python3
"""
Value Buy Service — live analysis engine for all portfolio holdings.

For each stock in TICKER_MAP:
  1. Fetch current price, 52w range, RSI, MA20/MA50 from Yahoo Finance
  2. Pull avg cost + quantity from Supabase (from analyst_ratings or T212 positions)
  3. Calculate 5-band entry zones (based on 52w range + avg cost)
  4. Generate this-week buy price target (RSI dip + MA support)
  5. Score: business quality (analyst), momentum (RSI/MA), valuation (vs avg), risk
  6. Upsert to value_buy_scores table

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

# ── Ticker → Yahoo symbol mapping (from analyst_service) ──────────────────────
# ETFs are included — Yahoo has price data even without analyst ratings
TICKER_MAP = {
    # Atomic Resources
    "UEC_US_EQ":   {"yahoo": "UEC",    "pie": "Atomic Resources",  "currency": "$"},
    "CCJ_US_EQ":   {"yahoo": "CCJ",    "pie": "Atomic Resources",  "currency": "$"},
    "XOM_US_EQ":   {"yahoo": "XOM",    "pie": "Atomic Resources",  "currency": "$"},
    # Space x allied
    "SPCE_US_EQ":  {"yahoo": "SPCE",   "pie": "Space x allied",    "currency": "$"},
    "LMT_US_EQ":   {"yahoo": "LMT",    "pie": "Space x allied",    "currency": "$"},
    "RTX_US_EQ":   {"yahoo": "RTX",    "pie": "Space x allied",    "currency": "$"},
    "BA_US_EQ":    {"yahoo": "BA",     "pie": "Space x allied",    "currency": "$"},
    "NOC_US_EQ":   {"yahoo": "NOC",    "pie": "Space x allied",    "currency": "$"},
    # Magnificent 7
    "AAPL_US_EQ":  {"yahoo": "AAPL",   "pie": "Magnificent 7",     "currency": "$"},
    "MSFT_US_EQ":  {"yahoo": "MSFT",   "pie": "Magnificent 7",     "currency": "$"},
    "GOOGL_US_EQ": {"yahoo": "GOOGL",  "pie": "Magnificent 7",     "currency": "$"},
    "AMZN_US_EQ":  {"yahoo": "AMZN",   "pie": "Magnificent 7",     "currency": "$"},
    "NVDA_US_EQ":  {"yahoo": "NVDA",   "pie": "Magnificent 7",     "currency": "$"},
    "META_US_EQ":  {"yahoo": "META",   "pie": "Magnificent 7",     "currency": "$"},
    "TSLA_US_EQ":  {"yahoo": "TSLA",   "pie": "Magnificent 7",     "currency": "$"},
    # Wider ETF
    "VWRL_L_EQ":   {"yahoo": "VWRL.L", "pie": "Wider ETF",         "currency": "£"},
    "IWDG_L_EQ":   {"yahoo": "IWDG.L", "pie": "Wider ETF",         "currency": "£"},
    "VAPX_L_EQ":   {"yahoo": "VAPX.L", "pie": "Wider ETF",         "currency": "£"},
    "VMID_L_EQ":   {"yahoo": "VMID.L", "pie": "Wider ETF",         "currency": "£"},
    # Semiconductor
    "SOXX_US_EQ":  {"yahoo": "SOXX",   "pie": "Semiconductor",     "currency": "$"},
    "SMH_US_EQ":   {"yahoo": "SMH",    "pie": "Semiconductor",     "currency": "$"},
    # Country ETF
    "EWJ_US_EQ":   {"yahoo": "EWJ",    "pie": "Country Etf",       "currency": "$"},
    "EWZ_US_EQ":   {"yahoo": "EWZ",    "pie": "Country Etf",       "currency": "$"},
    "EWY_US_EQ":   {"yahoo": "EWY",    "pie": "Country Etf",       "currency": "$"},
    "EWG_US_EQ":   {"yahoo": "EWG",    "pie": "Country Etf",       "currency": "$"},
    "EWU_US_EQ":   {"yahoo": "EWU",    "pie": "Country Etf",       "currency": "$"},
    "EWA_US_EQ":   {"yahoo": "EWA",    "pie": "Country Etf",       "currency": "$"},
    # Global ETF
    "ACWI_US_EQ":  {"yahoo": "ACWI",   "pie": "Global ETF",        "currency": "$"},
    "VT_US_EQ":    {"yahoo": "VT",     "pie": "Global ETF",        "currency": "$"},
    "VXUS_US_EQ":  {"yahoo": "VXUS",   "pie": "Global ETF",        "currency": "$"},
    "VEA_US_EQ":   {"yahoo": "VEA",    "pie": "Global ETF",        "currency": "$"},
    "VWO_US_EQ":   {"yahoo": "VWO",    "pie": "Global ETF",        "currency": "$"},
    # EM markets
    "EEM_US_EQ":   {"yahoo": "EEM",    "pie": "EM markets",        "currency": "$"},
    "EMXC_US_EQ":  {"yahoo": "EMXC",   "pie": "EM markets",        "currency": "$"},
    # UK Gold & Silver
    "SSLN_L_EQ":   {"yahoo": "SSLN.L", "pie": "UK Gold & Silver",  "currency": "£"},
    "SGLN_L_EQ":   {"yahoo": "SGLN.L", "pie": "UK Gold & Silver",  "currency": "£"},
    # Atomic Resources (uranium ETF)
    "URNM_US_EQ":  {"yahoo": "URNM",   "pie": "Atomic Resources",  "currency": "$"},
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


def sb_upsert(table, rows, conflict="ticker"):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    req = urllib.request.Request(
        url,
        data=json.dumps(rows).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": f"resolution=merge-duplicates,return=minimal",
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


def analyse_ticker(t212_ticker, meta, positions_map):
    """Full analysis pipeline for one ticker."""
    yahoo = meta["yahoo"]
    pie   = meta["pie"]
    cur   = meta["currency"]

    print(f"  Analysing {yahoo} ({pie})...", end=" ", flush=True)
    d = fetch_yahoo_data(yahoo)
    if not d:
        print("✗ no data")
        return None

    # Get avg cost from positions if available
    pos = positions_map.get(t212_ticker) or positions_map.get(yahoo) or {}
    avg_cost = pos.get("avg_cost") or pos.get("averagePrice") or None
    quantity = pos.get("quantity") or 0
    if avg_cost: avg_cost = round(float(avg_cost), 4)

    current = d["current"]
    zones   = build_entry_zones(current, d["low_52w"], d["high_52w"], avg_cost, cur)
    week    = build_this_week_target(current, d.get("ma20"), d.get("ma50"), d.get("rsi"), d["low_52w"], d["high_52w"], avg_cost)
    score, verdict, scorecard = build_scorecard(d, avg_cost)
    warning = build_warning(d, avg_cost, week)

    # Earnings snapshot from info (if available)
    earnings = {}  # Yahoo doesn't have YoY growth easily — leave blank, populated manually if needed

    row = {
        "ticker":          yahoo,
        "display":         d.get("short_name") or yahoo,
        "pie":             pie,
        "currency_symbol": cur,
        "score":           score,
        "score_max":       100,
        "verdict":         verdict,
        "entry_zones":     json.dumps(zones),
        "scorecard":       json.dumps(scorecard),
        "earnings":        json.dumps(earnings),
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


def run():
    print(f"[value_buy_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Load positions from Supabase (avg cost per ticker)
    # Try the positions table first, fall back to empty
    positions_raw = sb_get("positions", "?select=ticker,avg_cost,quantity")
    positions_map = {p["ticker"]: p for p in positions_raw} if positions_raw else {}
    print(f"  Loaded {len(positions_map)} positions from Supabase")

    rows = []
    for t212_ticker, meta in TICKER_MAP.items():
        row = analyse_ticker(t212_ticker, meta, positions_map)
        if row:
            rows.append(row)
        time.sleep(1.5)  # be kind to Yahoo

    if rows:
        sb_upsert("value_buy_scores", rows)

    print(f"[value_buy_service] Done — {len(rows)}/{len(TICKER_MAP)} stocks analysed.")


if __name__ == "__main__":
    run()
