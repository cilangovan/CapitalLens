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
  • How much: your share of whatever amount you enter on the dashboard, split across actionable names

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


def fmt_px(v, ccy, quote_ccy=None):
    """Human price for messages: pence for London lines quoted in GBp, else currency symbol."""
    if v is None: return "—"
    if quote_ccy in ("GBp", "GBX"): return f"{v * 100:,.2f}p"
    sym = {"GBP": "£", "USD": "$", "EUR": "€"}.get(ccy)
    return f"{sym}{v:,.2f}" if sym else f"{v:,.2f} {ccy}"


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
def fetch(sym, now, category="stock"):
    t = yf.Ticker(sym)
    h = t.history(period="1y", interval="1d", auto_adjust=False)
    meta = getattr(t, "history_metadata", None) or {}
    if h is None or h.empty:
        return None, "no price history"
    h = h.dropna(subset=["Close"])
    if len(h) < MIN_SESSIONS:
        return None, f"only {len(h)} sessions of history (need {MIN_SESSIONS})"
    last_date = h.index[-1].date()
    if (now.date() - last_date).days > (2 if category == "crypto" else MAX_STALE_DAYS):
        return None, f"latest close is stale ({last_date:%d %b})"
    ccy = (meta.get("currency") or "").strip()
    if not ccy:
        return None, "listing currency unknown"
    scale, ccy_out = (0.01, SUBUNITS[ccy]) if ccy in SUBUNITS else (1.0, ccy.upper())
    closes = (h["Close"].astype(float) * scale).tolist()
    dates = [i.date().isoformat() for i in h.index]
    window = closes[-20:]
    jumps = [b / a for a, b in zip(window, window[1:]) if a > 0]
    if min(window) <= 0 or any(j > 8 or j < 1 / 8 for j in jumps):   # pence↔pound style 100× jumps
        return None, "inconsistent price units in history"

    vols = h["Volume"].astype(float).tolist() if "Volume" in h else []
    # exclude today's unfinished session from volume stats while that market is open
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    def _epoch(x):   # yfinance gives epoch ints or pandas Timestamps depending on version
        if x is None: return None
        try: return float(x)
        except (TypeError, ValueError):
            try: return x.timestamp()
            except Exception: return None
    st, en = _epoch(reg.get("start")), _epoch(reg.get("end"))
    partial = bool(st and en and st <= now.timestamp() < en)
    if category == "crypto":           # 24/7 market: today's bar is always unfinished
        partial = last_date == now.date()
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
    try:   # analyst breakdown (current month): strongBuy / buy / hold / sell / strongSell counts
        rs = t.recommendations
        if rs is not None and not rs.empty:
            row = rs.iloc[0]
            info["_rec_counts"] = {k: int(row.get(k, 0) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}
    except Exception:
        pass
    return {"closes": closes, "dates": dates, "ccy": ccy_out, "quote_ccy": ccy, "last_date": last_date, "info": info, "scale": scale,
            "volumes": vols,
            "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
            "vol_ratio": vol_ratio, "vol_last": vol_last, "vol_avg": vol_avg, "partial": partial}, None


# ── analysis ──────────────────────────────────────────────────────────────────
def quality(info, price, ma200, closes, is_etf, category="stock"):
    reasons, score = [], 0
    if category in ("crypto", "commodity") or is_etf:
        calm, wild = {"crypto": (60, 100), "commodity": (25, 45)}.get(category, (22, 35))
        if ma200 and price > ma200: score += 1; reasons.append("✓ Above its 200-day average (uptrend)")
        elif ma200: score -= 1; reasons.append("✗ Below its 200-day average (downtrend)")
        r1y = (closes[-1] / closes[0] - 1) * 100
        if r1y > 0: score += 1; reasons.append(f"✓ 1-year return {r1y:+.1f}%")
        else: score -= 1; reasons.append(f"✗ 1-year return {r1y:+.1f}%")
        rets = np.diff(closes) / np.array(closes[:-1])
        vol = float(np.std(rets) * math.sqrt(252) * 100)
        if vol < calm: score += 1; reasons.append(f"✓ Moderate volatility for its class ({vol:.0f}%/yr)")
        elif vol > wild: score -= 1; reasons.append(f"✗ Very volatile ({vol:.0f}%/yr)")
        else: reasons.append(f"• Volatility {vol:.0f}%/yr")
        if category == "crypto":
            mc = info.get("marketCap")
            if mc and mc >= 10e9: score += 1; reasons.append(f"✓ Large market cap (${mc/1e9:,.0f}bn)")
            elif mc and mc < 1e9: score -= 1; reasons.append(f"✗ Small market cap (${mc/1e9:,.2f}bn) — higher risk")
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
    category = item.get("category") or "stock"
    d, reason = fetch(sym, now, category)
    base = {"symbol": sym, "exchange": item.get("exchange"), "name": item.get("name"),
            "t212_ticker": item.get("t212_ticker"), "category": category,
            "alternatives": item.get("alternatives") or []}
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
    q_label, q_score, q_reasons = quality(info, price, ma200, c, is_etf, category)
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
    trend_only = is_etf or category in ("commodity", "crypto")      # "quality" = trend/volatility, no fundamentals
    small_coin = category == "crypto" and (info.get("marketCap") or 0) < 1e9
    if q_label == "Weak" and (not trend_only or small_coin) and rec not in ("strong_buy", "buy"):
        verdict = "AVOID"
        why.append("Small, weak coin — not worth the risk." if small_coin else "Quality checks are weak — not worth the risk this week.")
    elif q_label == "Weak" and trend_only:
        verdict = "HOLD"
        why.append("In a downtrend (below its 200-day average, negative 1-year return) — wait for it to turn; "
                   "the price points below are where it gets interesting.")
    elif overbought:
        verdict = "HOLD"; why.append(f"Stretched: RSI {rsi:.0f} and trading near its highs — wait for a pullback.")
    elif downtrend:
        if q_label == "Good":
            verdict = "ACCUMULATE"; why.append("Good business in a downtrend — build slowly in small steps, don't rush.")
        else:
            verdict = "HOLD"; why.append("Downtrend (below falling 200-day average) — wait for the trend to turn.")
    elif rsi is not None and rsi < 35:
        verdict = "ENTER"
        if ma200 and price < ma200:
            why.append(f"RSI {rsi:.0f} is oversold, but it's below its 200-day average — enter small and add only if it stabilises.")
        else:
            why.append(f"RSI {rsi:.0f} is oversold while the longer trend holds — a reasonable entry.")
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
    alts = item.get("alternatives") or []
    if category == "crypto":
        why.append("Crypto swings hard — keep it a small slice of the portfolio.")
    if not item.get("t212_ticker") and verdict in ("ENTER", "ACCUMULATE", "HOLD"):
        if alts:
            why.append("On Trading 212 buy it via " + ", ".join(a.get("symbol", "").replace(".L", "") for a in alts[:3]) +
                       (" (ETPs that track the coin)" if category == "crypto" else " (ETCs that track the price)") + ".")
        elif category == "crypto":
            why.append("Not buyable directly on Trading 212 Invest — use a crypto exchange, or check the app for an ETP.")
        elif category == "commodity":
            why.append("This is the futures price (for reference) — buy exposure through an ETC on Trading 212.")
        else:
            why.append("Not found on your Trading 212 exchanges — check the app or buy via another broker.")
    if upside is not None and verdict != "AVOID":
        why.append(f"Analyst average target {fmt_px(tgt, ccy, d.get('quote_ccy'))} ({upside:+.0f}% from here).")

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
        "quote_ccy": d.get("quote_ccy"),
        **build_drilldown(d, price, ccy, is_etf, category),
    }


# ── Drill-down: profile, key stats, fundamentals, analyst detail, insights ────
REC_LABEL = [(1.5, "Strong buy"), (2.5, "Buy"), (3.5, "Hold"), (4.5, "Sell"), (9, "Strong sell")]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def build_drilldown(d, price, ccy, is_etf, category):
    """Everything the dashboard's detail page shows, from Yahoo Finance data. Prices in `ccy` (sub-units converted)."""
    info, scale = d["info"], d["scale"]
    px = lambda k: (_num(info.get(k)) * scale) if _num(info.get(k)) is not None else None
    c = d["closes"]
    shares = _num(info.get("sharesOutstanding"))
    mcap = _num(info.get("marketCap"))
    if shares and price:                                   # sanity: feed sometimes mixes pence/pounds
        calc = shares * price
        if not mcap or not (0.2 < mcap / calc < 5):
            mcap = calc
    stats = {
        "prev_close": px("previousClose") or (c[-2] if len(c) > 1 else None),
        "open": px("open") or px("regularMarketOpen"),
        "day_low": px("dayLow"), "day_high": px("dayHigh"),
        "volume": _num(info.get("volume")), "avg_volume": _num(info.get("averageVolume")),
        "market_cap": mcap, "shares_out": shares,
        "pe": _num(info.get("trailingPE")), "fwd_pe": _num(info.get("forwardPE")),
        "div_yield": _num(info.get("dividendYield")),
        "beta": _num(info.get("beta")),
        "high52": px("fiftyTwoWeekHigh") or max(c[-252:]), "low52": px("fiftyTwoWeekLow") or min(c[-252:]),
    }
    # discard feed values that disagree with the verified closes (unit mix-ups)
    for k in ("prev_close", "open", "day_low", "day_high", "high52", "low52"):
        if stats[k] and price and not (0.33 < stats[k] / price < 3):
            stats[k] = None
    stats["high52"] = stats["high52"] or max(c[-252:]); stats["low52"] = stats["low52"] or min(c[-252:])
    f = {k: _num(info.get(k)) for k in ("profitMargins", "operatingMargins", "returnOnAssets", "returnOnEquity",
                                         "debtToEquity", "currentRatio", "quickRatio", "revenueGrowth", "earningsGrowth")}
    fundamentals = {"net_margin": f["profitMargins"], "op_margin": f["operatingMargins"], "roa": f["returnOnAssets"],
                    "roe": f["returnOnEquity"], "debt_to_equity": f["debtToEquity"], "current_ratio": f["currentRatio"],
                    "quick_ratio": f["quickRatio"], "revenue_growth": f["revenueGrowth"], "earnings_growth": f["earningsGrowth"]}
    mean = _num(info.get("recommendationMean"))
    rc = info.get("_rec_counts") or {}
    n_rc = sum(rc.values())
    if mean is None and n_rc:   # consensus from the analyst breakdown (1 = strong buy … 5 = strong sell)
        mean = round(sum(w * rc.get(k, 0) for w, k in enumerate(("strongBuy", "buy", "hold", "sell", "strongSell"), 1)) / n_rc, 2)
    if mean is None:   # some listings only carry the text consensus
        mean = {"strong_buy": 1.3, "buy": 2.0, "hold": 3.0, "underperform": 4.0, "sell": 4.5,
                "strong_sell": 4.8}.get((info.get("recommendationKey") or "").lower())
    tgt = lambda k: (_num(info.get(k)) * scale) if _num(info.get(k)) else None
    analyst = {"mean": mean, "label": next((l for t, l in REC_LABEL if mean and mean <= t), None),
               "count": int(info.get("numberOfAnalystOpinions") or n_rc or 0), "breakdown": rc or None,
               "target_mean": tgt("targetMeanPrice"), "target_low": tgt("targetLowPrice"), "target_high": tgt("targetHighPrice")}
    if analyst["target_mean"] and price and not (-90 < (analyst["target_mean"] / price - 1) * 100 < 300):
        analyst.update(target_mean=None, target_low=None, target_high=None)   # unit mismatch in feed
    summary = (info.get("longBusinessSummary") or "").strip()
    profile = {"sector": info.get("sector") or info.get("category"), "industry": info.get("industry"),
               "summary": summary[:900] + ("…" if len(summary) > 900 else ""), "website": info.get("website"),
               "employees": info.get("fullTimeEmployees"), "country": info.get("country"),
               "fund_family": info.get("fundFamily"), "expense_ratio": _num(info.get("annualReportExpenseRatio"))}
    perf = {lbl: round((c[-1] / c[-n - 1] - 1) * 100, 1) for lbl, n in (("1M", 21), ("6M", 126), ("1Y", 251)) if len(c) > n}
    return {"stats": stats, "fundamentals": fundamentals, "analyst_detail": analyst, "profile": profile,
            "performance": perf, "insights": insights(stats, fundamentals, analyst, perf, price, is_etf, category),
            "history": {"dates": d["dates"][-260:], "closes": [round(x, 6) for x in c[-260:]]}}


def insights(st, fu, an, perf, price, is_etf, category):
    """Rule-based insight bullets + 0–6 scores per area (valuation, earnings, growth, performance, health)."""
    good, bad, score = [], [], {}
    clamp = lambda x: max(0, min(6, round(x)))
    # Analysts
    if an["label"] in ("Strong buy", "Buy") and an["count"] >= 3:
        good.append(f"Analysts rate it {an['label']} ({an['count']} analysts)")
    elif an["label"] in ("Sell", "Strong sell"):
        bad.append(f"Analysts rate it {an['label']} ({an['count']} analysts)")
    if an["target_mean"] and price:
        up = (an["target_mean"] / price - 1) * 100
        if up >= 10:  good.append(f"Average analyst target {up:+.0f}% above today's price")
        elif up < 0:  bad.append(f"Average analyst target {up:+.0f}% below today's price")
    # Valuation
    pe, fpe = st["pe"], st["fwd_pe"]
    if pe is not None:
        v = 6 if 0 < pe < 10 else 5 if pe < 15 else 4 if pe < 20 else 3 if pe < 25 else 2 if pe < 35 else 1 if pe < 60 else 0
        if pe <= 0: v = 0
        if fpe and pe and 0 < fpe < pe: v += 1; good.append(f"Earnings expected to grow (forward P/E {fpe:.1f} below trailing {pe:.1f})")
        if 0 < pe < 15: good.append(f"Low P/E of {pe:.1f}")
        elif pe > 40: bad.append(f"Expensive on earnings (P/E {pe:.1f})")
        score["valuation"] = clamp(v)
    # Earnings (profitability)
    nm, roa, roe = fu["net_margin"], fu["roa"], fu["roe"]
    if nm is not None or roa is not None:
        e = 0
        if nm is not None:
            e += 3 if nm > .2 else 2 if nm > .1 else 1 if nm > 0 else 0
            if nm > .1:    good.append(f"Healthy net profit margin ({nm*100:.1f}%)")
            elif nm < .05: bad.append(f"Thin net profit margin ({nm*100:.1f}%)")
        if roa is not None:
            e += 2 if roa > .08 else 1 if roa > .03 else 0
            if roa < .03: bad.append(f"Low return on assets ({roa*100:.1f}%)")
        if roe is not None and roe > .15: e += 1; good.append(f"Strong return on equity ({roe*100:.0f}%)")
        score["earnings"] = clamp(e)
    # Growth
    rg, eg = fu["revenue_growth"], fu["earnings_growth"]
    if rg is not None or eg is not None:
        g = 0
        if rg is not None:
            g += 3 if rg > .2 else 2 if rg > .08 else 1 if rg > 0 else 0
            if rg > .08:  good.append(f"Revenue growing {rg*100:+.0f}% year on year")
            elif rg < -.01: bad.append(f"Revenue shrinking {rg*100:+.0f}% year on year")
        if eg is not None:
            g += 3 if eg > .2 else 2 if eg > .05 else 1 if eg > 0 else 0
            if eg < 0: bad.append(f"Earnings shrinking ({eg*100:+.0f}%)")
        score["growth"] = clamp(g)
    # Performance (price)
    if perf:
        y, m6 = perf.get("1Y"), perf.get("6M")
        p = 3 + (1.5 if (y or 0) > 15 else .5 if (y or 0) > 0 else -1.5 if (y or 0) < -15 else -.5) + \
            (1.5 if (m6 or 0) > 10 else .5 if (m6 or 0) > 0 else -1.5 if (m6 or 0) < -10 else -.5)
        score["performance"] = clamp(p)
        if y is not None:
            (good if y > 0 else bad).append(f"{'Up' if y > 0 else 'Down'} {abs(y):.0f}% over the past year")
    # Health (balance sheet)
    cr, de = fu["current_ratio"], fu["debt_to_equity"]
    if cr is not None or de is not None:
        h = 3
        if cr is not None:
            if cr < 1: h -= 2; bad.append(f"Short-term liabilities exceed short-term assets (current ratio {cr:.2f})")
            elif cr > 1.5: h += 1; good.append(f"Covers short-term liabilities comfortably (current ratio {cr:.2f})")
        if de is not None:
            if de > 150: h -= 2; bad.append(f"High debt (debt/equity {de:.0f}%)")
            elif de < 50: h += 2; good.append(f"Low debt (debt/equity {de:.0f}%)")
        score["health"] = clamp(h)
    if (is_etf or category in ("commodity", "crypto")) and not score.get("valuation"):
        good.append("Fund/asset: judged on price trend and volatility — no company fundamentals")
    items = [{"good": True, "text": t} for t in good] + [{"good": False, "text": t} for t in bad]
    return {"items": items, "scores": score}


def size_positions(results):
    """Relative sizing only; there is no fixed budget. Gives each actionable name its share of whatever you decide to invest in this section
    (shares of the actionable names add up to 1) and splits it across the price points. The £ are worked out on the dashboard from the amount you enter."""
    w = {"ENTER": 2, "ACCUMULATE": 1}
    raw_w = sum(w.get(v, 0) for st, v, _ in results if st == "ok")
    total_w = raw_w or 1
    n_hold = sum(1 for st, v, _ in results if st == "ok" and v == "HOLD")
    for status, verdict, data in results:
        if status != "ok": continue
        if verdict in w:
            share = w[verdict] / total_w
            basis = "this week"
        elif verdict == "HOLD":
            share = 1 / max(raw_w + n_hold, 1)   # its slice if it reaches the price points
            basis = "only if the price points are hit"
        else:
            share, basis = 0, "no buys"
        steps = []
        for (label, px), tranche in zip(data.pop("entries_raw"), TRANCHES):
            pct = round((px / data["price"] - 1) * 100, 1) if data["price"] else 0
            steps.append({"label": label, "price": px, "pct_from_now": pct, "share": tranche})
        data["entries"] = steps
        data["weight"] = {"share": round(share, 4), "basis": basis}


def run(only=None):
    now = datetime.now(timezone.utc)
    print(f"[watchlist] {now.isoformat()}  {'ticker=' + only if only else 'all'}")
    wl = sb("GET", "watchlist?select=*") or []
    if not wl:
        print("  Watchlist empty."); return

    # sizing needs every name's verdict, so analyse all; `only` just logs which one triggered
    results = []
    for item in wl:
        try:
            status, verdict, data = analyse(item, now)
        except Exception as e:
            status, verdict, data = "error", None, {"reason": f"{type(e).__name__}: {e}"[:200]}
        results.append((status, verdict, data))
        print(f"  {item['ticker']:<14} {status:<10} {verdict or '-':<11} {data.get('reason','')}")
    for cat in ("stock", "commodity", "crypto"):
        group = [r for item, r in zip(wl, results) if (item.get("category") or "stock") == cat]
        if not group: continue
        size_positions(group)
    for item, (status, verdict, data) in zip(wl, results):
        sb("POST", "watchlist_analysis?on_conflict=ticker",
           {"ticker": item["ticker"], "updated_at": now.isoformat(), "status": status,
            "verdict": verdict, "data": data},
           prefer="resolution=merge-duplicates,return=minimal")
    print(f"[watchlist] done — {len(results)} analysed")


if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else None)
