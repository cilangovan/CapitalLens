#!/usr/bin/env python3
"""
Holding Decision Service — weekly per-stock/ETF decision score.

Scores every holding in the positions table out of 100 across 6 factors:
  - Institutional accumulation / distribution  20pts
  - Price trend & technical indicators          20pts
  - Company financial health                   25pts  (proxy: momentum quality)
  - Valuation                                  15pts
  - Sector & market outlook                    10pts
  - Risk & volatility                          10pts

Decision bands:
  80-100 → Strong Hold / Consider Buy
  65-79  → Hold
  50-64  → Watch / No additional buying
  35-49  → Consider Reducing
  <35    → Consider Exit

Also applies the 5-level selling framework:
  Level 1 (Warning)              — down 5-8% from recent high
  Level 2 (Weakness)             — down 10-12%, trend deteriorating
  Level 3 (Distribution)         — institutional selling + price deterioration
  Level 4 (Thesis deterioration) — persistent weakness + poor momentum
  Level 5 (Exit)                 — score <35 + Level 3+ sell signal

And buying rules:
  BUY signal  → institutional accumulation + price above MA50
  WAIT signal → institutional accumulation + price below MA50
  AVOID       → institutional selling + price below MA50

Run via: python -m services.holding_decision_service
Triggered Sunday by daily_services.yml alongside institutional_flow.
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, date, timezone

try:
    import yfinance as yf
    import numpy as np
except ImportError:
    print("[holding_dec] ERROR: yfinance / numpy not installed")
    exit(1)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

# T212 exchange → suffix for yfinance lookup
EXCHANGE_SUFFIX = {
    "LSE":       ".L",
    "XETRA":     ".DE",
    "AMS":       ".AS",
    "EURONEXT":  ".PA",
    "NASDAQ/NYSE": "",
    "NYSE":      "",
    "NASDAQ":    "",
}

# Sector ETF map — used to give sector outlook score per region
SECTOR_REGION_MAP = {
    "USA":    {"proxy": "QQQ",   "benchmark": "^IXIC"},
    "UK":     {"proxy": "ISF.L", "benchmark": "^FTSE"},
    "Europe": {"proxy": "VEUR.AS","benchmark": "^STOXX50E"},
}


# ── Supabase helpers ─────────────────────────────────────────────────────────
def sb_get(table, query=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}{query}"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_URL and SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    })
    req.add_header("apikey", SUPABASE_KEY)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  sb_get {table} error: {e}")
        return []


def sb_upsert(table, rows, conflict="report_date,ticker"):
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


# ── Technical helpers ────────────────────────────────────────────────────────
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


def fetch_ticker(symbol, period="6mo"):
    """Returns technical metrics for a symbol, or None on failure."""
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period=period, interval="1d", auto_adjust=True)
        if hist.empty or len(hist) < 10:
            return None
        closes  = hist["Close"].tolist()
        volumes = hist["Volume"].tolist()
        highs   = hist["High"].tolist()
        current   = closes[-1]
        high_52w  = max(highs)
        ma20 = float(np.mean(closes[-20:])) if len(closes) >= 20 else closes[-1]
        ma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else closes[-1]
        rsi   = calc_rsi(closes)
        vol_r = float(np.mean(volumes[-5:])) / float(np.mean(volumes[-20:-5])) \
                if len(volumes) >= 20 else 1.0
        mom_4w = round((closes[-1] / closes[-20] - 1) * 100, 1) if len(closes) >= 20 else 0.0
        mom_1w = round((closes[-1] / closes[-5]  - 1) * 100, 1) if len(closes) >= 5  else 0.0
        pct_from_high = round((current - high_52w) / high_52w * 100, 1)
        return {
            "current":        round(current, 4),
            "ma20":           round(ma20, 4),
            "ma50":           round(ma50, 4),
            "rsi":            rsi,
            "vol_ratio":      round(vol_r, 2),
            "mom_4w":         mom_4w,
            "mom_1w":         mom_1w,
            "pct_from_high":  pct_from_high,
        }
    except Exception as e:
        print(f"    fetch_ticker {symbol}: {e}")
        return None


def exchange_to_region(exchange):
    ex = (exchange or "").upper()
    if ex in ("NASDAQ/NYSE", "NYSE", "NASDAQ"):
        return "USA"
    if ex == "LSE":
        return "UK"
    if ex in ("XETRA", "AMS", "EURONEXT"):
        return "Europe"
    return None


def yf_symbol(ticker, exchange):
    suffix = EXCHANGE_SUFFIX.get((exchange or "").upper(), "")
    # Avoid double suffix (e.g. ticker already ends with .L)
    if suffix and ticker.endswith(suffix):
        return ticker
    return ticker + suffix


# ── Scoring engine ────────────────────────────────────────────────────────────
def score_institutional(d):
    """20pts — volume spike + momentum signals institutional activity."""
    s = 10
    if d["vol_ratio"] > 1.3:    s += 4
    elif d["vol_ratio"] > 1.1:  s += 2
    elif d["vol_ratio"] < 0.8:  s -= 3
    if d["mom_4w"] > 5:         s += 4
    elif d["mom_4w"] > 2:       s += 2
    elif d["mom_4w"] < -5:      s -= 4
    elif d["mom_4w"] < -2:      s -= 2
    return max(0, min(20, s))


def score_price_trend(d):
    """20pts — MA alignment + recent momentum."""
    s = 10
    if d["current"] > d["ma20"] > d["ma50"]:    s += 6
    elif d["current"] > d["ma50"]:               s += 3
    elif d["current"] < d["ma50"]:               s -= 4
    if d["mom_1w"] > 1.5:   s += 4
    elif d["mom_1w"] > 0:   s += 2
    elif d["mom_1w"] < -3:  s -= 4
    elif d["mom_1w"] < 0:   s -= 1
    return max(0, min(20, s))


def score_financial_health(d):
    """25pts — momentum quality proxy (RSI health + consistency)."""
    s = 13
    rsi = d["rsi"]
    if 50 <= rsi <= 70:   s += 7
    elif 40 <= rsi < 50:  s += 3
    elif rsi > 75:        s -= 3   # overbought
    elif rsi < 35:        s -= 5   # oversold / distress
    if d["mom_4w"] > 0 and d["mom_1w"] > 0:    s += 5
    elif d["mom_4w"] < 0 and d["mom_1w"] < 0:  s -= 5
    return max(0, min(25, s))


def score_valuation(d):
    """15pts — distance from 52w high (further = better value)."""
    pfh = d["pct_from_high"]
    s = 7
    if pfh < -25:   s += 7
    elif pfh < -15: s += 5
    elif pfh < -8:  s += 3
    elif pfh < -3:  s += 1
    elif pfh > -1:  s -= 3   # near all-time high
    return max(0, min(15, s))


def score_sector_outlook(region_score):
    """10pts — market-level score from institutional_flow_reports, normalised."""
    # region_score is 0-100 from inst flow; map to 0-10
    return max(0, min(10, round(region_score / 10)))


def score_risk(d):
    """10pts — volatility + drawdown risk."""
    s = 5
    pfh = d["pct_from_high"]
    if pfh > -5:    s -= 3   # near high, downside risk elevated
    elif pfh < -20: s += 3   # already corrected, risk lower
    rsi = d["rsi"]
    if rsi > 70:    s -= 2   # overbought
    elif rsi < 40:  s += 2   # oversold, reversal potential
    return max(0, min(10, s))


# ── Selling framework ─────────────────────────────────────────────────────────
def sell_level(d, inst_score):
    """Return (level 0-5, signal text) per the 5-level framework."""
    pfh   = d["pct_from_high"]
    below = d["current"] < d["ma50"]
    weak  = inst_score < 10   # institutional selling zone

    if pfh > -5:
        return 0, None
    if pfh > -8:
        return 1, "Warning — down 5-8% from recent high; investigate"
    if pfh > -12:
        level = 2 if not (below and weak) else 3
        return level, ("Weakness — down 10-12%, trend deteriorating; stop adding"
                       if level == 2 else
                       "Distribution — institutional selling + price breakdown")
    if pfh > -20:
        if weak and below:
            return 3, "Distribution — persistent selling; consider reducing 20-25%"
        return 2, "Weakness — extended drawdown; monitor closely"
    # > 20% down
    if weak and below and d["rsi"] < 40:
        return 4, "Thesis deterioration risk — consider reducing 25-50%; reassess"
    return 3, "Distribution — significant drawdown; review investment thesis"


def buy_signal(d, inst_score):
    """Return buy guidance per buying rules."""
    above_ma50 = d["current"] >= d["ma50"]
    accumulating = inst_score >= 14   # above-average institutional score
    if accumulating and above_ma50:
        return "BUY signal — institutional accumulation + price above MA50; consider gradual entry"
    if accumulating and not above_ma50:
        return "WAIT — institutional buying but price below MA50; wait for price confirmation"
    if not accumulating and above_ma50:
        return "HOLD — no institutional accumulation; hold existing position"
    return "AVOID — institutional selling + price below MA50; no new buying"


def decision_label(score):
    if score >= 80: return "Strong Hold / Consider Buy"
    if score >= 65: return "Hold"
    if score >= 50: return "Watch / No Additional Buying"
    if score >= 35: return "Consider Reducing"
    return "Consider Exit"


# ── Main pipeline ─────────────────────────────────────────────────────────────
def run():
    today = date.today().isoformat()
    print(f"[holding_dec] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Load positions
    positions_raw = sb_get("positions", "?select=ticker,display,pie,exchange&order=pie,ticker")
    if not positions_raw:
        print("[holding_dec] No positions found — aborting.")
        return
    print(f"  Loaded {len(positions_raw)} positions")

    # Load latest market scores from institutional_flow_reports for sector outlook
    region_scores = {}
    flow_rows = sb_get("institutional_flow_reports",
                       "?select=markets&order=report_date.desc&limit=1")
    if flow_rows and flow_rows[0].get("markets"):
        try:
            for m in json.loads(flow_rows[0]["markets"]):
                region_scores[m["region"]] = m["score"]
        except Exception:
            pass
    print(f"  Region scores from last inst report: {region_scores}")

    rows = []
    for pos in positions_raw:
        ticker   = pos["ticker"]
        exchange = pos.get("exchange", "")
        sym      = yf_symbol(ticker, exchange)
        region   = exchange_to_region(exchange)
        print(f"  Scoring {ticker} ({sym})...")

        d = fetch_ticker(sym)
        if not d:
            print(f"    skipped — no data")
            continue
        time.sleep(0.5)

        reg_score = region_scores.get(region, 50) if region else 50

        s_inst   = score_institutional(d)
        s_price  = score_price_trend(d)
        s_fin    = score_financial_health(d)
        s_val    = score_valuation(d)
        s_sector = score_sector_outlook(reg_score)
        s_risk   = score_risk(d)
        total    = s_inst + s_price + s_fin + s_val + s_sector + s_risk

        sl, ss   = sell_level(d, s_inst)
        bs       = buy_signal(d, s_inst)
        decision = decision_label(total)

        notes_parts = []
        if sl >= 3:
            notes_parts.append(ss)
        if total >= 65 and sl == 0:
            notes_parts.append("No selling signals")
        notes = "; ".join(notes_parts) if notes_parts else None

        rows.append({
            "report_date":   today,
            "ticker":        ticker,
            "display":       pos.get("display", ticker),
            "pie":           pos.get("pie"),
            "exchange":      exchange,
            "score":         total,
            "decision":      decision,
            "sell_level":    sl,
            "sell_signal":   ss,
            "buy_signal":    bs,
            "inst_score":    s_inst,
            "price_score":   s_price,
            "fin_score":     s_fin,
            "val_score":     s_val,
            "sector_score":  s_sector,
            "risk_score":    s_risk,
            "rsi":           d["rsi"],
            "mom_4w":        d["mom_4w"],
            "mom_1w":        d["mom_1w"],
            "pct_from_high": d["pct_from_high"],
            "above_ma50":    d["current"] >= d["ma50"],
            "vol_ratio":     d["vol_ratio"],
            "notes":         notes,
        })
        print(f"    {total}/100 — {decision} | sell L{sl} | {bs.split(' —')[0]}")

    if rows:
        sb_upsert("holding_decisions", rows)
        # Summary
        exits    = [r for r in rows if r["sell_level"] >= 4]
        warnings = [r for r in rows if r["sell_level"] in (1, 2, 3)]
        buys     = [r for r in rows if "BUY signal" in (r["buy_signal"] or "")]
        print(f"\n[holding_dec] Done — {len(rows)} holdings scored")
        print(f"  Exit signals:   {[r['ticker'] for r in exits]}")
        print(f"  Warning/reduce: {[r['ticker'] for r in warnings]}")
        print(f"  Buy signals:    {[r['ticker'] for r in buys]}")
    else:
        print("[holding_dec] No rows to store.")


if __name__ == "__main__":
    run()
