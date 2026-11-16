#!/usr/bin/env python3
"""
Strategy Service — AGGRESSIVE weekly allocator.

Each week it splits (monthly max budget ÷ Mondays in the month) across the live pies,
weighted by:
  1. Pie quality      — average star rating from analyst_ratings (analysts for stocks,
                        aggressive trend rating for ETFs)
  2. Dip size         — average drawdown from the 52-week high (buy quality dips)
  3. Market mood      — VIX level, S&P 500 drawdown, and news-headline sentiment.
                        Aggressive stance: fear → lean harder into quality dips;
                        greed → avoid chasing stretched pies.
  4. Growth pace      — portfolio annualised return vs 10% base / 15% stretch target.
                        Behind base → tilt to fastest-growing pies.

Reads:  analyst_ratings, portfolio_snapshots (+ raw.pies), positions, returns_summary
Writes: strategy_recommendations (single latest row)
"""

import os
import json
import calendar
import urllib.request
import urllib.error
from datetime import datetime, timezone, date

try:
    import yfinance as yf
except ImportError:
    yf = None

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# ── Settings ──────────────────────────────────────────────────────────────────
MONTHLY_BUDGET_MAX = 300          # £ deployed per month, split evenly across Mondays
TARGET_BASE        = 10.0         # % a year — the realistic baseline
TARGET_STRETCH     = 15.0         # % a year — optimistic goal
MIN_ALLOC          = 5            # £ — skip anything smaller and redistribute
MAX_PIE_SHARE      = 0.35         # no pie gets more than 35% of a week
TIER_1             = ["Magnificent 7", "Wider ETF", "Global ETF"]   # always-on core
TIER_1_FLOOR       = 8            # £ minimum each core pie gets every week
GROWTH_PIES        = ["Magnificent 7", "Semiconductor"]             # tilted up when behind pace

STAR_WEIGHT = {1: 0.0, 2: 0.5, 3: 1.5, 4: 2.5, 5: 3.5}

NEG_WORDS = ["crash", "selloff", "sell-off", "plunge", "tumble", "slump", "rout", "fear",
             "recession", "war", "tariff", "downgrade", "panic", "sinks", "slides", "losses",
             "bear", "volatility", "crisis", "default", "layoffs", "inflation surge"]
POS_WORDS = ["rally", "record high", "surge", "soar", "gains", "rebound", "beat", "jumps",
             "bull", "optimism", "upgrade", "rate cut", "climbs", "strong earnings"]


# ── Supabase ──────────────────────────────────────────────────────────────────
def supabase_request(method, path, data=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    if method == "POST" and data:
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            return json.loads(content) if content else []
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path} → {e.code}: {e.read().decode()}")
        return None


def get_analyst_ratings():
    rows = supabase_request("GET", "analyst_ratings?select=ticker,yahoo_ticker,pie,star_rating,buy_pct") or []
    by_pie = {}
    for r in rows:
        by_pie.setdefault((r.get("pie") or "Solo").strip(), []).append(r)
    return by_pie


def get_live_pies():
    rows = supabase_request("GET", "portfolio_snapshots?select=raw&order=id.desc&limit=1") or []
    if not rows:
        return []
    pies = (rows[0].get("raw") or {}).get("pies") or []
    return [p["name"].strip() for p in pies if p.get("name")]


def get_returns():
    rows = supabase_request("GET", "returns_summary?select=*&limit=1") or []
    return rows[0] if rows else {}


# ── Calendar ──────────────────────────────────────────────────────────────────
def mondays_in_month(d):
    return sum(1 for wk in calendar.monthcalendar(d.year, d.month) if wk[calendar.MONDAY])


def week_of_month(d):
    return sum(1 for day in range(1, d.day + 1) if date(d.year, d.month, day).weekday() == 0) or 1


# ── Market data ───────────────────────────────────────────────────────────────
def closes(symbol, period="1y"):
    if not yf:
        return []
    try:
        h = yf.Ticker(symbol).history(period=period, interval="1d")
        return [float(c) for c in h["Close"].dropna().tolist()]
    except Exception as e:
        print(f"  history error {symbol}: {e}")
        return []


def ticker_stats(symbol):
    """Drawdown from 52w high (%, positive) and annualised 6-month trend (%)."""
    c = closes(symbol)
    if len(c) < 60:
        return None
    dd = (max(c) - c[-1]) / max(c) * 100
    base = c[-126] if len(c) >= 126 else c[0]
    ret_6m = (c[-1] / base - 1) * 100
    ann = ((1 + ret_6m / 100) ** 2 - 1) * 100
    return {"dd": dd, "ann": ann}


def headline_sentiment():
    if not yf:
        return 0, 0
    titles = []
    for sym in ("^GSPC", "SPY", "QQQ"):
        try:
            for n in (yf.Ticker(sym).news or [])[:15]:
                t = n.get("title") or (n.get("content") or {}).get("title") or ""
                if t:
                    titles.append(t.lower())
        except Exception:
            pass
    titles = list(dict.fromkeys(titles))
    neg = sum(any(w in t for w in NEG_WORDS) for t in titles)
    pos = sum(any(w in t for w in POS_WORDS) for t in titles)
    return pos - neg, len(titles)


def market_mood():
    vix_c = closes("^VIX", "1mo")
    vix = vix_c[-1] if vix_c else None
    spx = ticker_stats("^GSPC")
    news_net, news_n = headline_sentiment()

    level = 1  # 0 greed · 1 normal · 2 fear · 3 extreme fear
    if vix is not None:
        level = 0 if vix < 15 else 1 if vix < 20 else 2 if vix < 30 else 3
    if spx and spx["dd"] >= 10:
        level += 1
    if news_n and news_net <= -3:
        level += 1
    if news_n and news_net >= 3 and level > 0:
        level -= 1
    level = max(0, min(3, level))
    label = ["Greed / calm", "Normal", "Fear", "Extreme fear"][level]
    return {
        "level": level, "label": label,
        "vix": round(vix, 1) if vix else None,
        "spx_drawdown": round(spx["dd"], 1) if spx else None,
        "news_net": news_net, "news_count": news_n,
    }


# ── Allocation ────────────────────────────────────────────────────────────────
def pie_profile(pie, ratings):
    rows = ratings.get(pie, [])
    stars = [r.get("star_rating") or 0 for r in rows]
    stats = [s for s in (ticker_stats(r["yahoo_ticker"]) for r in rows if r.get("yahoo_ticker")) if s]
    return {
        "star": round(sum(stars) / len(stars), 1) if stars else None,
        "dd":   round(sum(s["dd"] for s in stats) / len(stats), 1) if stats else 0.0,
        "ann":  round(sum(s["ann"] for s in stats) / len(stats), 1) if stats else None,
        "n":    len(rows),
    }


def star_weight(star):
    lo = int(star)
    hi = min(5, lo + 1)
    frac = star - lo
    return STAR_WEIGHT.get(lo, 0) * (1 - frac) + STAR_WEIGHT.get(hi, 0) * frac


def weigh(pie, prof, mood, ann_ret):
    why = []
    if prof["star"] is None:
        w = STAR_WEIGHT[3]
        why.append("new pie — seed funding")
        star = 3.0
    else:
        star = prof["star"]
        w = star_weight(star)
        why.append(f"⭐{star}")
    if w == 0:
        return 0.0, why + ["weak trend — no new money"]

    dd, lvl = prof["dd"], mood["level"]
    if star >= 3 and dd >= 4:
        dip_mult = 1.8 if dd >= 15 else 1.4 if dd >= 8 else 1.15
        if lvl >= 2:
            dip_mult += 0.3                       # fear → buy quality dips harder
        w *= dip_mult
        why.append(f"{dd:.0f}% off high ×{dip_mult:.2f}")

    if lvl >= 2:
        if pie in TIER_1:
            w *= 1.2; why.append("fear → core boost")
        elif star < 3:
            w *= 0.5; why.append("fear → trim weak")
    elif lvl == 0 and dd < 2 and (prof["ann"] or 0) > 30:
        w *= 0.8; why.append("greed → don't chase")

    if ann_ret is not None and ann_ret < TARGET_BASE and pie in GROWTH_PIES:
        w *= 1.25; why.append(f"behind {TARGET_BASE:.0f}% → growth tilt")

    if prof["ann"] is not None:
        tag = "≥15%" if prof["ann"] >= TARGET_STRETCH else "≥10%" if prof["ann"] >= TARGET_BASE else "<10%"
        why.append(f"trend {prof['ann']:+.0f}%/yr ({tag})")
    return w, why


def allocate(weekly, weights):
    total_w = sum(weights.values())
    if total_w <= 0:
        return {}
    alloc = {p: weekly * w / total_w for p, w in weights.items() if w > 0}
    for _ in range(5):  # cap, floor, and minimum passes
        cap = weekly * MAX_PIE_SHARE
        over = {p: a - cap for p, a in alloc.items() if a > cap}
        for p in over:
            alloc[p] = cap
        for p in TIER_1:
            if p in alloc and alloc[p] < TIER_1_FLOOR:
                alloc[p] = TIER_1_FLOOR
        alloc = {p: a for p, a in alloc.items() if a >= MIN_ALLOC or p in TIER_1}
        spare = weekly - sum(alloc.values())
        free = {p: weights[p] for p, a in alloc.items() if a < cap}
        fw = sum(free.values())
        if abs(spare) < 0.5 or fw <= 0:
            break
        for p, w in free.items():
            alloc[p] += spare * w / fw
    rounded = {p: int(round(a)) for p, a in alloc.items()}
    diff = int(round(weekly)) - sum(rounded.values())
    if rounded and diff:
        top = max(rounded, key=lambda p: weights[p])
        rounded[top] += diff
    return {p: a for p, a in rounded.items() if a > 0}


def run():
    print(f"[strategy_service] Aggressive allocator — {datetime.now(timezone.utc).isoformat()}")
    today = date.today()
    weeks = mondays_in_month(today)
    week = week_of_month(today)
    weekly = MONTHLY_BUDGET_MAX / weeks
    print(f"  Budget £{MONTHLY_BUDGET_MAX}/month ÷ {weeks} Mondays = £{weekly:.2f} this week (week {week})")

    ratings = get_analyst_ratings()
    pies = get_live_pies() or list(ratings.keys())
    returns = get_returns()
    raw_ann = returns.get("annualised_pct")
    ann_ret = float(raw_ann) if raw_ann not in (None, "", 0, "0", "0.0") else None  # None = not enough history yet
    mood = market_mood()
    print(f"  Mood: {mood}")
    print(f"  Portfolio annualised: {ann_ret}%")

    weights, reasons, profiles = {}, {}, {}
    for pie in pies:
        prof = pie_profile(pie, ratings)
        w, why = weigh(pie, prof, mood, ann_ret)
        weights[pie], reasons[pie], profiles[pie] = w, why, prof
        print(f"  {pie:<18} w={w:.2f}  {' | '.join(why)}")

    alloc = allocate(weekly, weights)
    recs = []
    for pie, amt in sorted(alloc.items(), key=lambda x: -x[1]):
        share = amt / weekly
        recs.append({
            "pie": pie,
            "amount": amt,
            "reason": " · ".join(reasons[pie]),
            "priority": "HIGH" if share >= 0.25 else "MEDIUM" if share >= 0.12 else "LOW",
        })
    skipped = [p for p in pies if p not in alloc]

    notes = [
        f"Aggressive mode · £{MONTHLY_BUDGET_MAX}/month → £{weekly:.0f} this week (week {week} of {weeks})",
        f"Market mood: {mood['label']} — VIX {mood['vix']}, S&P {mood['spx_drawdown']}% off high, "
        f"news {mood['news_net']:+d} across {mood['news_count']} headlines",
    ]
    if mood["level"] >= 2:
        notes.append("😨 Fear in the market — leaning into quality dips and core pies.")
    elif mood["level"] == 0:
        notes.append("😎 Calm/greedy market — favouring pies off their highs over stretched ones.")
    if ann_ret is None:
        notes.append(f"ℹ️ Not enough history for an annualised return yet — pace tilt off until it builds up (targets {TARGET_BASE:.0f}% base / {TARGET_STRETCH:.0f}% stretch).")
    elif ann_ret < TARGET_BASE:
        notes.append(f"⚠️ Annualised {ann_ret:.1f}% is below the {TARGET_BASE:.0f}% base — tilting to growth pies.")
    elif ann_ret < TARGET_STRETCH:
        notes.append(f"📈 Annualised {ann_ret:.1f}% — above {TARGET_BASE:.0f}% base, chasing {TARGET_STRETCH:.0f}% stretch.")
    else:
        notes.append(f"✅ Annualised {ann_ret:.1f}% — at or above the {TARGET_STRETCH:.0f}% stretch target.")
    if skipped:
        notes.append("No money this week: " + ", ".join(f"{p} ({' · '.join(reasons[p][-1:])})" for p in skipped))

    row = {
        "week_number": week,
        "total_suggested": sum(alloc.values()),
        "on_track": (ann_ret >= TARGET_BASE) if ann_ret is not None else None,
        "annualised_return": ann_ret,
        "recommendations": recs,
        "notes": notes,
        "weeks_in_month": weeks,
        "weekly_budget": round(weekly, 2),
        "market_mood": mood,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase_request("DELETE", "strategy_recommendations?id=gt.0")
    if supabase_request("POST", "strategy_recommendations", row) is not None:
        print(f"  ✓ saved — £{row['total_suggested']} across {len(recs)} pies")
    else:
        print("  ✗ failed to save strategy_recommendations")
    print("[strategy_service] Done.")


if __name__ == "__main__":
    run()
