#!/usr/bin/env python3
"""
Watchlist Service — this week's call for every stock you've bookmarked.

For each watchlist symbol (Yahoo Finance — any exchange worldwide):
  • Price, daily change, RSI(14), MA20/50/200, 52-week range, 20-day drawdown
  • Volume: last complete session vs 20-session average → Low / Normal / High,
    read together with the price move (selling pressure, quiet pullback …)
  • Quality: analyst consensus + fundamentals (stocks) or trend/volatility (ETFs) → Good / Mixed / Weak
  • Verdict for this week: ENTER · ACCUMULATE · HOLD (wait) · AVOID
  • Entry price points from real support levels, with £ amounts per step
  • How much: a share of the strategy engine's weekly budget, split across actionable names

Price data must be verified (≥60 sessions, close within the last 4 days, known currency,
no unit jumps); otherwise the stock is marked "unverified" and gets no verdict.
Sub-unit quotes (GBp, ZAc, ILA) are converted; every price also shows a £ equivalent.

Run:  python -m services.watchlist_service            (all)
      python -m services.watchlist_service 7203.T     (one symbol, after you add it)
"""

import os
import sys
import json
import math
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta

import numpy as np
import yfinance as yf

from services.value_buy_service import calc_rsi

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

WATCHLIST_SHARE   = 0.35          # share of the weekly budget earmarked for watchlist buys
FALLBACK_WEEKLY   = 300 / 4.33    # if no strategy row yet
TRANCHES          = (0.40, 0.30, 0.30)
MIN_SESSIONS      = 60
SUBUNITS          = {"GBp": "GBP", "GBX": "GBP", "ZAc": "ZAR", "ILA": "ILS"}
MAX_STALE_DAYS    = 4             # tolerates weekends/holidays on any market


# ── Supabase ──────────────────────────────────────────────────────────────────
def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(data, default=float).encode() if data is not None else None, method=method,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path[:60]} → {e.code}: {e.read().decode()[:300]}")
        return None


# ── helpers ───────────────────────────────────────────────────────────────────
_FX = {}
def per_gbp(ccy):
    if ccy == "GBP": return 1.0
    if ccy not in _FX:
        try:
            h = yf.Ticker(f"GBP{ccy}=X").history(period="5d")
            _FX[ccy] = float(h["Close"].dropna().iloc[-1])
        except Exception:
            _FX[ccy] = None
    return _FX[ccy]


def rnd(v, ccy):
    if v is None: return None
    return round(v, 2 if v >= 1 else 4)


def classify_rsi(rsi):
    if rsi is None: return "n/a"
    if rsi < 30: return "Low — oversold"
    if rsi < 40: return "Low"
    if rsi <= 60: return "Neutral"
    if rsi <= 70: return "Elevated"
    return "High — overbought"


def classify_volume(ratio, daily):
    if ratio is None: return "No data", "No reliable volume data for this line."
    lab = "Low" if ratio < 0.7 else "High" if ratio > 1.5 else "Normal"
    if lab == "High" and daily <= -1.5: note = "Heavy volume on a down day — selling pressure; let it settle."
    elif lab == "High" and daily >= 1.5: note = "Heavy volume on an up day — strong buying interest."
    elif lab == "High": note = "Unusually busy session — check the news."
    elif lab == "Low" and daily < 0: note = "Quiet pullback on light volume — usually healthy."
    elif lab == "Low" and daily > 0: note = "Rally on light volume — weak conviction."
    elif lab == "Low": note = "Light trading — fewer buyers and sellers than usual."
    else: note = "Normal trading activity."
    return lab, note


# ── data ──────────────────────────────────────────────────────────────────────
def fetch(sym, now):
    t = yf.Ticker(sym)
    h = t.history(period="1y", interval="1d", auto_adjust=False)
    meta = getattr(t, "history_metadata", None) or {}
    if h is None or h.empty:
        return None, "no price history"
    h = h.dropna(subset=["Close"])
    if len(h) < MIN_SESSIONS:
        return None, f"only {len(h)} sessions of history (need {MIN_SESSIONS})"
    last_date = h.index[-1].date()
    if (now.date() - last_date).days > MAX_STALE_DAYS:
        return None, f"latest close is stale ({last_date:%d %b})"
    ccy = (meta.get("currency") or "").strip()
    if not ccy:
        return None, "listing currency unknown"
    scale, ccy_out = (0.01, SUBUNITS[ccy]) if ccy in SUBUNITS else (1.0, ccy.upper())
    closes = (h["Close"].astype(float) * scale).tolist()
    window = closes[-20:]
    if min(window) <= 0 or max(window) / min(window) >= 1.5:
        return None, "inconsistent price units in history"

    vols = h["Volume"].astype(float).tolist() if "Volume" in h else []
    # exclude today's unfinished session from volume stats while that market is open
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    ts = now.timestamp()
    partial = bool(reg.get("start") and reg.get("end") and reg["start"] <= ts < reg["end"])
    vser = vols[:-1] if partial else vols
    vol_ratio = vol_last = vol_avg = None
    if len(vser) >= 21 and np.mean(vser[-21:-1]) > 0:
        vol_last = vser[-1]; vol_avg = float(np.mean(vser[-21:-1]))
        vol_ratio = vol_last / vol_avg if vol_avg else None
    info = {}
    try:
        info = t.info or {}
    except Exception:
        pass
    return {"closes": closes, "ccy": ccy_out, "last_date": last_date, "info": info, "scale": scale,
            "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
            "vol_ratio": vol_ratio, "vol_last": vol_last, "vol_avg": vol_avg, "partial": partial}, None


# ── analysis ──────────────────────────────────────────────────────────────────
def quality(info, price, ma200, closes, is_etf):
    reasons, score = [], 0
    if is_etf:
        if ma200 and price > ma200: score += 1; reasons.append("✓ Above its 200-day average (uptrend)")
        elif ma200: score -= 1; reasons.append("✗ Below its 200-day average (downtrend)")
        r1y = (closes[-1] / closes[0] - 1) * 100
        if r1y > 0: score += 1; reasons.append(f"✓ 1-year return {r1y:+.1f}%")
        else: score -= 1; reasons.append(f"✗ 1-year return {r1y:+.1f}%")
        rets = np.diff(closes) / np.array(closes[:-1])
        vol = float(np.std(rets) * math.sqrt(252) * 100)
        if vol < 22: score += 1; reasons.append(f"✓ Moderate volatility ({vol:.0f}%/yr)")
        elif vol > 35: score -= 1; reasons.append(f"✗ High volatility ({vol:.0f}%/yr)")
        label = "Good" if score >= 2 else "Mixed" if score >= 0 else "Weak"
        return label, score, reasons
    rec = (info.get("recommendationKey") or "none").lower()
    n = info.get("numberOfAnalystOpinions") or 0
    if rec in ("strong_buy", "buy") and n >= 3: score += 2; reasons.append(f"✓ Analysts: {rec.replace('_',' ')} ({n})")
    elif rec in ("sell", "underperform", "strong_sell"): score -= 2; reasons.append(f"✗ Analysts: {rec} ({n})")
    elif rec != "none": reasons.append(f"• Analysts: {rec.replace('_',' ')} ({n})")
    else: reasons.append("• No analyst coverage")
    tgt = info.get("targetMeanPrice")
    pm, rg, roe, de = (info.get(k) for k in ("profitMargins", "revenueGrowth", "returnOnEquity", "debtToEquity"))
    if pm is not None:
        if pm > 0.10: score += 1; reasons.append(f"✓ Profit margin {pm*100:.0f}%")
        elif pm < 0: score -= 1; reasons.append(f"✗ Loss-making (margin {pm*100:.0f}%)")
    if rg is not None:
        if rg > 0.05: score += 1; reasons.append(f"✓ Revenue growth {rg*100:+.0f}%")
        elif rg < 0: score -= 1; reasons.append(f"✗ Revenue shrinking {rg*100:+.0f}%")
    if roe is not None and roe > 0.15: score += 1; reasons.append(f"✓ Return on equity {roe*100:.0f}%")
    if de is not None and de > 200: score -= 1; reasons.append(f"✗ High debt (D/E {de:.0f}%)")
    if ma200:
        if price > ma200: score += 1; reasons.append("✓ Above its 200-day average (uptrend)")
        else: score -= 1; reasons.append("✗ Below its 200-day average (downtrend)")
    label = "Good" if score >= 3 else "Mixed" if score >= 0 else "Weak"
    return label, score, reasons


def support_levels(price, ma20, ma50, ma200, low20, low52, high52):
    spread = (high52 - low52) or price * 0.3
    cands = [("20-day average", ma20), ("50-day average", ma50), ("200-day average", ma200),
             ("20-day low", low20), ("Lower quarter of 52-week range", low52 + spread * 0.25)]
    cands = sorted([(n, v) for n, v in cands if v and v < price * 0.995], key=lambda x: -x[1])
    picked = []
    for n, v in cands:
        if all(abs(v / p[1] - 1) >= 0.03 for p in picked):
            picked.append((n, v))
    for f in (0.95, 0.90, 0.85, 0.80):
        if len(picked) >= 3: break
        v = price * f
        if all(abs(v / p[1] - 1) >= 0.03 for p in picked):
            picked.append((f"{int(round((1-f)*100))}% below today", v))
    return sorted(picked, key=lambda x: -x[1])[:3]


def analyse(item, now):
    sym = item["ticker"]                      # Yahoo Finance symbol
    d, reason = fetch(sym, now)
    base = {"symbol": sym, "exchange": item.get("exchange"), "name": item.get("name"),
            "t212_ticker": item.get("t212_ticker")}
    if reason:
        return "unverified", None, {**base, "reason": reason}

    c = d["closes"]; info = d["info"]; ccy = d["ccy"]
    price = c[-1]; prev = c[-2]
    daily = (price / prev - 1) * 100
    rsi = calc_rsi(c)
    ma20 = float(np.mean(c[-20:])); ma50 = float(np.mean(c[-50:]))
    ma200 = float(np.mean(c[-200:])) if len(c) >= 200 else None
    high52, low52 = max(c), min(c)
    low20, high20 = min(c[-20:]), max(c[-20:])
    range_pos = (price - low52) / (high52 - low52) if high52 > low52 else 0.5
    is_etf = (item.get("type") == "ETF") or (info.get("quoteType") == "ETF")
    if d.get("exchange"): base["exchange"] = d["exchange"]
    q_label, q_score, q_reasons = quality(info, price, ma200, c, is_etf)
    vol_label, vol_note = classify_volume(d["vol_ratio"], daily)
    rsi_label = classify_rsi(rsi)
    rec = (info.get("recommendationKey") or "none").lower()
    tgt = info.get("targetMeanPrice")
    tgt = tgt * (0.01 if info.get("currency") in SUBUNITS else 1) if tgt else None
    upside = ((tgt / price - 1) * 100) if tgt else None
    if upside is not None and not (-90 < upside < 300):   # unit mismatch in the feed — don't trust it
        tgt = upside = None
    downtrend = bool(ma200 and price < ma200 and ma50 < ma200)
    overbought = (rsi or 50) > 70 or (range_pos > 0.9 and price > ma20 * 1.05)
    selling = vol_label == "High" and daily <= -1.5

    why = []
    if q_label == "Weak" and rec not in ("strong_buy", "buy"):
        verdict = "AVOID"; why.append("Quality checks are weak — not worth the risk this week.")
    elif overbought:
        verdict = "HOLD"; why.append(f"Stretched: RSI {rsi:.0f} and trading near its highs — wait for a pullback.")
    elif downtrend:
        if q_label == "Good":
            verdict = "ACCUMULATE"; why.append("Good business in a downtrend — build slowly in small steps, don't rush.")
        else:
            verdict = "HOLD"; why.append("Downtrend (below falling 200-day average) — wait for the trend to turn.")
    elif rsi is not None and rsi < 35:
        verdict = "ENTER"; why.append(f"RSI {rsi:.0f} is oversold while the longer trend holds — a reasonable entry.")
    elif rsi is not None and rsi < 50:
        verdict = "ACCUMULATE"; why.append(f"RSI {rsi:.0f} — momentum has cooled; buy gradually at the price points.")
    elif rsi is not None and rsi < 60 and q_label == "Good" and not downtrend:
        verdict = "ACCUMULATE"; why.append(f"Healthy uptrend, RSI {rsi:.0f} — small first buy, add on dips.")
    else:
        verdict = "HOLD"; why.append(f"RSI {rsi:.0f} — no edge at today's price; set alerts at the entry points.")
    if verdict == "ENTER" and selling:
        verdict = "ACCUMULATE"; why.append("Heavy selling volume today — stage the buys instead of all at once.")
    if verdict in ("ENTER", "ACCUMULATE") and q_label == "Mixed":
        why.append("Quality is mixed — keep the position small.")
    if not item.get("t212_ticker") and verdict in ("ENTER", "ACCUMULATE", "HOLD"):
        why.append("Not found on your Trading 212 exchanges — check the app or buy via another broker.")
    if upside is not None and verdict != "AVOID":
        why.append(f"Analyst average target {rnd(tgt, ccy)} ({upside:+.0f}% from here).")

    levels = support_levels(price, ma20, ma50, ma200, low20, low52, high52)
    entries = []
    if verdict == "ENTER":
        entries = [("Buy now (market)", price)] + levels[:2]
    elif verdict == "ACCUMULATE":
        entries = [("Small first buy now", price)] + levels[:2]
    elif verdict == "HOLD":
        entries = levels[:3]
    invalidation = min([v for _, v in levels] + [price]) * 0.93   # "rethink if it closes below"
    take_profit = tgt if (tgt and tgt > price) else high52 if high52 > price * 1.03 else None

    return "ok", verdict, {
        **base, "type": "ETF" if is_etf else "Stock", "ccy": ccy, "per_gbp": per_gbp(ccy),
        "price": rnd(price, ccy), "daily_pct": round(daily, 2), "as_of": d["last_date"].isoformat(),
        "rsi": rsi, "rsi_label": rsi_label,
        "volume": {"ratio": round(d["vol_ratio"], 2) if d["vol_ratio"] else None,
                   "label": vol_label, "note": vol_note, "partial_excluded": d["partial"]},
        "ma20": rnd(ma20, ccy), "ma50": rnd(ma50, ccy), "ma200": rnd(ma200, ccy),
        "high52": rnd(high52, ccy), "low52": rnd(low52, ccy), "range_pos": round(range_pos * 100),
        "drawdown20": round((price / high20 - 1) * 100, 2),
        "quality": {"label": q_label, "score": q_score, "reasons": q_reasons},
        "analyst": {"rec": rec, "count": info.get("numberOfAnalystOpinions") or 0,
                    "target": rnd(tgt, ccy), "upside": round(upside, 1) if upside is not None else None},
        "why": why,
        "entries_raw": [(n, rnd(v, ccy)) for n, v in entries],
        "invalidation": rnd(invalidation, ccy), "take_profit": rnd(take_profit, ccy),
        "sector": info.get("sector"),
    }


def size_positions(results, weekly):
    """Split the watchlist pool across actionable names; attach £ per entry step."""
    pool = weekly * WATCHLIST_SHARE
    w = {"ENTER": 2, "ACCUMULATE": 1}
    total_w = sum(w.get(v, 0) for _, v, _ in results) or 1
    for status, verdict, data in results:
        if status != "ok": continue
        if verdict in w:
            amt = pool * w[verdict] / total_w
            basis = "this week"
        elif verdict == "HOLD":
            amt = pool / max(total_w, 1)      # what you'd put in if it reaches the price points
            basis = "only if the price points are hit"
        else:
            amt, basis = 0, "no buys"
        steps = []
        for (label, px), share in zip(data.pop("entries_raw"), TRANCHES):
            gbp = round(amt * share)
            pct = round((px / data["price"] - 1) * 100, 1) if data["price"] else 0
            steps.append({"label": label, "price": px, "pct_from_now": pct, "amount_gbp": gbp,
                          "shares": round(gbp * (data["per_gbp"] or 1) / px, 4) if px else None})
        data["entries"] = steps
        data["budget"] = {"weekly_budget": round(weekly, 2), "watchlist_pool": round(pool, 2),
                          "this_stock": round(sum(s["amount_gbp"] for s in steps)), "basis": basis}


def run(only=None):
    now = datetime.now(timezone.utc)
    print(f"[watchlist] {now.isoformat()}  {'ticker=' + only if only else 'all'}")
    wl = sb("GET", "watchlist?select=*") or []
    if not wl:
        print("  Watchlist empty."); return
    strat = sb("GET", "strategy_recommendations?select=weekly_budget&order=updated_at.desc&limit=1") or []
    weekly = float((strat[0] if strat else {}).get("weekly_budget") or FALLBACK_WEEKLY)

    # sizing needs every name's verdict, so analyse all; `only` just logs which one triggered
    results = []
    for item in wl:
        try:
            status, verdict, data = analyse(item, now)
        except Exception as e:
            status, verdict, data = "error", None, {"reason": f"{type(e).__name__}: {e}"[:200]}
        results.append((status, verdict, data))
        print(f"  {item['ticker']:<14} {status:<10} {verdict or '-':<11} {data.get('reason','')}")
    size_positions(results, weekly)
    for item, (status, verdict, data) in zip(wl, results):
        sb("POST", "watchlist_analysis?on_conflict=ticker",
           {"ticker": item["ticker"], "updated_at": now.isoformat(), "status": status,
            "verdict": verdict, "data": data},
           prefer="resolution=merge-duplicates,return=minimal")
    print(f"[watchlist] done — {len(results)} analysed, weekly budget £{weekly:.0f}")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else None)
