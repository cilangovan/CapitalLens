#!/usr/bin/env python3
"""
Profit Booking & Capital Protection Service

Five layers, scored per holding every weekday:
  1. Market conditions   — S&P 500 / MSCI ACWI vs 50 & 200 DMA, VIX, portfolio breadth
                           → regime: Aggressive · Neutral · Defensive
  2. Sector strength     — stock's sector ETF (or the ETF itself) 3-month return vs benchmark
  3. Volume & price      — 5d vs 20d relative volume, read together with price direction
  4. Position            — staged profit-booking ladder (stocks) / drift + drawdown rules (ETFs),
                           3×ATR trailing exit for stocks, 1%-risk position sizing
  5. Pie / portfolio     — concentration: stock ≤ 8%, sector ≤ 25%, pie drift vs target

Weekly score (100) = market 20 · sector 20 · momentum 15 · volume 15 · fundamentals 20 · concentration 10
  80–100 let it run · 65–79 hold & monitor · 50–64 consider partial booking · <50 reassess thesis

Writes: profit_booking (one row per holding), profit_booking_summary (one row)
These are review prompts, not automatic sell orders.
"""

import os
import json
import math
import urllib.request
import urllib.error
from datetime import datetime, timezone

import yfinance as yf

from services.value_buy_service import t212_to_yahoo

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

# ── Guardrails (aggressive end of the framework's ranges) ─────────────────────
RISK_PER_TRADE_PCT = 1.0     # % of holdings you can afford to lose on one stock
MAX_STOCK_PCT      = 8.0     # max single-stock weight
MAX_SECTOR_PCT     = 25.0    # max look-through sector weight
ATR_MULT           = 3.0     # trailing exit = highest close (3m) − 3 × ATR(14)
DRIFT_PP           = 5.0     # ETF rebalance trigger: +5 percentage points over target …
DRIFT_REL          = 0.20    # … or 20% relative over target

# Agreed long-term targets for the Wider ETF pie (VWRP≈VWCE, VUSA, Nasdaq-100≈SXRV, IUIT≈QDVE)
TARGET_OVERRIDES = {
    "Wider ETF": {"VWCEd_EQ": 0.50, "VUSAa_EQ": 0.25, "SXRVd_EQ": 0.15, "QDVEd_EQ": 0.10},
}

# Staged ladder for individual stocks: (gain %, label, trim % if score ≥ 80, trim % otherwise)
STOCK_LADDER = [
    (10, "Hold — review valuation",                    0.00, 0.00),
    (15, "Check momentum, volume & fundamentals",      0.00, 0.00),
    (20, "Trim 10–15%",                                0.10, 0.15),
    (30, "Trim another 15–20%",                        0.15, 0.20),
    (45, "Recover initial capital",                    None, None),   # sell cost basis
]

SECTOR_ETF = {
    "Technology": "XLK", "Communication Services": "XLC", "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP", "Financial Services": "XLF", "Healthcare": "XLV",
    "Industrials": "XLI", "Energy": "XLE", "Basic Materials": "XLB", "Utilities": "XLU",
    "Real Estate": "XLRE",
}

# Approximate look-through sector weights for known ETFs (index factsheets, rounded)
ETF_LOOKTHROUGH = {
    "QDVE.DE": {"Technology": 1.0},
    "SXRV.DE": {"Technology": 0.60, "Communication Services": 0.15, "Consumer Cyclical": 0.15, "Other": 0.10},
    "VUSA.AS": {"Technology": 0.33, "Financial Services": 0.13, "Healthcare": 0.10, "Consumer Cyclical": 0.10,
                "Communication Services": 0.09, "Other": 0.25},
    "VWCE.DE": {"Technology": 0.26, "Financial Services": 0.17, "Healthcare": 0.10, "Consumer Cyclical": 0.11,
                "Industrials": 0.11, "Other": 0.25},
    "SGLN.L":  {"Precious metals": 1.0},
    "SSLN.L":  {"Precious metals": 1.0},
    "ITWN.L":  {"Technology": 0.60, "Financial Services": 0.15, "Other": 0.25},
    "IAEX.L":  {"Technology": 0.25, "Financial Services": 0.20, "Other": 0.55},
    "XDAX.L":  {"Industrials": 0.25, "Financial Services": 0.22, "Technology": 0.12, "Other": 0.41},
    "IMIB.L":  {"Financial Services": 0.34, "Utilities": 0.15, "Energy": 0.10, "Other": 0.41},
    "IPOL.L":  {"Financial Services": 0.36, "Energy": 0.15, "Other": 0.49},
    "CS1.L":   {"Financial Services": 0.13, "Healthcare": 0.14, "Other": 0.73},
}
NAME_KEYWORDS = [
    (("semiconductor", "chip"), "Technology"), (("cyber", "software", "robot", "artificial", " ai ", "tech"), "Technology"),
    (("defence", "defense", "aerospace"), "Industrials"), (("gold", "silver", "precious"), "Precious metals"),
    (("miner", "mining", "metal"), "Basic Materials"), (("health", "biotech", "pharma"), "Healthcare"),
    (("bank", "financ"), "Financial Services"), (("energy", "oil", "uranium", "nuclear"), "Energy"),
    (("water", "infrastructure", "utilit", "clean"), "Utilities"), (("property", "reit", "real estate"), "Real Estate"),
]


# ── Supabase ──────────────────────────────────────────────────────────────────
def sb(method, path, data=None, prefer="return=minimal"):
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
               "Content-Type": "application/json", "Prefer": prefer}
    body = json.dumps(data, default=float).encode() if data is not None else None
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            c = r.read()
            return json.loads(c) if c else []
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path} → {e.code}: {e.read().decode()[:300]}")
        return None


# ── Market data ───────────────────────────────────────────────────────────────
_hist = {}


def hist(sym):
    if sym in _hist:
        return _hist[sym]
    try:
        h = yf.Ticker(sym).history(period="1y", interval="1d").dropna(subset=["Close"])
        d = {"c": h["Close"].tolist(), "h": h["High"].tolist(), "l": h["Low"].tolist(), "v": h["Volume"].fillna(0).tolist()}
    except Exception as e:
        print(f"  history error {sym}: {e}")
        d = None
    if d and len(d["c"]) < 30:
        d = None
    _hist[sym] = d
    return d


def sma(xs, n):
    xs = xs[-n:]
    return sum(xs) / len(xs) if xs else None


def ret(c, days):
    if not c or len(c) <= days:
        return None
    return (c[-1] / c[-days - 1] - 1) * 100


def trend(sym):
    d = hist(sym)
    if not d:
        return None
    c = d["c"]
    p, m50, m200 = c[-1], sma(c, 50), sma(c, 200)
    return {"price": p, "above50": p > m50, "above200": p > m200, "ret3m": ret(c, 63),
            "dd": (max(c) - p) / max(c) * 100}


def atr(d, n=14):
    trs = []
    for i in range(1, len(d["c"])):
        h, l, pc = d["h"][i], d["l"][i], d["c"][i - 1]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs[-n:]) / min(n, len(trs)) if trs else None


def info(sym):
    try:
        return yf.Ticker(sym).info or {}
    except Exception:
        return {}


# ── Layer 1: market regime ────────────────────────────────────────────────────
def regime(breadth_pct):
    spx, acwi = trend("^GSPC"), trend("ACWI")
    vix_d = hist("^VIX")
    vix = vix_d["c"][-1] if vix_d else None
    pts = 0
    for t in (spx, acwi):
        if t:
            pts += (1 if t["above50"] else 0) + (1 if t["above200"] else 0)
    if vix is not None:
        pts += 1 if vix < 20 else -1 if vix > 28 else 0
    if breadth_pct is not None:
        pts += 1 if breadth_pct >= 60 else -1 if breadth_pct < 40 else 0
    mode = "Aggressive" if pts >= 4 else "Defensive" if pts <= 1 else "Neutral"
    return {
        "mode": mode, "points": pts,
        "spx": {"above50": spx["above50"], "above200": spx["above200"], "ret3m": round(spx["ret3m"], 1)} if spx else None,
        "acwi": {"above50": acwi["above50"], "above200": acwi["above200"], "ret3m": round(acwi["ret3m"], 1)} if acwi else None,
        "vix": round(vix, 1) if vix else None,
        "breadth_pct": breadth_pct,
    }, spx, acwi


def market_score(bench):
    if not bench:
        return 10
    if bench["above50"] and bench["above200"]:
        return 20
    if bench["above200"]:
        return 12
    if bench["above50"]:
        return 8
    return 0


# ── Layer 2: sector ───────────────────────────────────────────────────────────
def classify_etf(yahoo, name):
    if yahoo in ETF_LOOKTHROUGH:
        lt = ETF_LOOKTHROUGH[yahoo]
        main = max((k for k in lt if k != "Other"), key=lambda k: lt[k], default="Broad market")
        return (main if lt.get(main, 0) >= 0.5 else "Broad market"), lt
    n = f" {(name or '').lower()} "
    for words, sector in NAME_KEYWORDS:
        if any(w in n for w in words):
            return sector, {sector: 1.0}
    return "Broad market", {"Broad market": 1.0}


def sector_score(rel):
    if rel is None:
        return 10
    return 20 if rel > 3 else 14 if rel > 0 else 8 if rel > -3 else 0


# ── Layer 3: volume & price ───────────────────────────────────────────────────
def volume_read(d):
    v, c = d["v"], d["c"]
    base = sma(v[-25:-5], 20) if len(v) >= 25 else None
    recent = sma(v, 5)
    rv = (recent / base) if base and base > 0 and recent else None
    move5 = ret(c, 5) or 0
    if rv is None:
        return None, 8, "no volume data"
    if move5 > 0.5:
        return rv, (15 if rv >= 1.2 else 11), ("rising on heavy volume — genuine buying" if rv >= 1.2 else "rising on normal volume")
    if move5 < -0.5:
        return rv, (0 if rv >= 1.5 else 5), ("falling on heavy volume — distribution" if rv >= 1.5 else "drifting lower, light volume")
    return rv, 8, "flat"


def momentum_score(t):
    if not t:
        return 7
    if t["above50"] and t["above200"]:
        return 15
    if t["above200"]:
        return 9
    if t["above50"]:
        return 5
    return 0


# ── Layer 4/5 helpers ─────────────────────────────────────────────────────────
def unit(exchange):
    e = (exchange or "").upper()
    return "$" if "NASDAQ" in e or "NYSE" in e else "p" if e == "LSE" else "€"


def combo_rule(mkt_ok, sec_ok, vol_bad):
    if mkt_ok and sec_ok and not vol_bad:
        return "Strong market + strong sector → let winners run"
    if not mkt_ok and sec_ok:
        return "Weak market + strong sector → selectively hold"
    if mkt_ok and not sec_ok:
        return "Strong market + weak sector → review this position"
    if vol_bad:
        return "Weak market + weak sector + heavy selling → reduce if thesis has deteriorated"
    return "Weak market + weak sector → hold only with conviction"


def band(score):
    if score >= 80:
        return "run", "Let it run — add only if allocation permits"
    if score >= 65:
        return "hold", "Hold & monitor"
    if score >= 50:
        return "trim", "Consider partial profit booking / reduce exposure"
    return "reassess", "Reassess the thesis — exit if it no longer qualifies"


# ── Main ──────────────────────────────────────────────────────────────────────
def run():
    now = datetime.now(timezone.utc).isoformat()
    print(f"[profit_booking] Starting {now}")

    snap = (sb("GET", "portfolio_snapshots?select=id,total_value,cash,invested,raw&order=id.desc&limit=1") or [None])[0]
    if not snap:
        print("  no snapshot — abort"); return
    positions = sb("GET", f"positions?snapshot_id=eq.{snap['id']}&select=*") or []
    ratings = {r["ticker"]: r for r in (sb("GET", "analyst_ratings?select=*") or [])}
    pies_raw = (snap.get("raw") or {}).get("pies") or []

    # Per-instrument GBP value & targets from pie data
    inst = {}
    for p in pies_raw:
        pname = p["name"].strip()
        over = TARGET_OVERRIDES.get(pname, {})
        for i in p.get("instruments") or []:
            r = i.get("result") or {}
            inst[i["ticker"]] = {
                "pie": pname,
                "value": float(r.get("priceAvgValue") or 0),
                "invested": float(r.get("priceAvgInvestedValue") or 0),
                "current": float(i.get("current") or 0) * 100,
                "t212_target": float(i.get("expected") or 0) * 100,
                "target": (over.get(i["ticker"], i.get("expected") or 0)) * 100,
                "override": i["ticker"] in over,
            }
    total = sum(v["value"] for v in inst.values()) or 1.0
    print(f"  {len(positions)} positions · holdings £{total:,.2f}")

    # Breadth: share of holdings above their 50-DMA
    tick_map = {}
    for p in positions:
        y, _ = t212_to_yahoo(p["ticker"], p.get("exchange"))
        tick_map[p["ticker"]] = y
    trends = {t: trend(y) for t, y in tick_map.items()}
    valid = [t for t in trends.values() if t]
    breadth = round(sum(1 for t in valid if t["above50"]) / len(valid) * 100) if valid else None
    reg, spx, acwi = regime(breadth)
    print(f"  Regime: {reg['mode']} ({reg})")

    sector_ret = {}
    spy = trend("SPY")

    rows, sector_exp = [], {}
    for p in positions:
        t = p["ticker"]
        y = tick_map[t]
        d = hist(y)
        tr = trends[t]
        rt = ratings.get(t, {})
        iv = inst.get(t, {})
        is_stock = (rt.get("analyst_count") or 0) > 0
        kind = "stock" if is_stock else "etf"
        value = iv.get("value") or 0.0
        weight = value / total * 100
        gain = float(p.get("gain_pct") or 0)
        qty = float(p.get("quantity") or 0)
        cur = float(p.get("current_price") or 0)
        avg = float(p.get("avg_price") or 0)
        u = unit(p.get("exchange"))
        notes, signals = [], {}

        # Sector
        if is_stock:
            inf = info(y)
            sector = inf.get("sector") or "Other"
            lt = {sector: 1.0}
            proxy = SECTOR_ETF.get(sector)
            if proxy and proxy not in sector_ret:
                st = trend(proxy)
                sector_ret[proxy] = st["ret3m"] if st else None
            rel = (sector_ret.get(proxy) - spy["ret3m"]) if proxy and sector_ret.get(proxy) is not None and spy else None
            bench = spx
            upside = ((inf.get("targetMeanPrice") or 0) / inf["currentPrice"] - 1) * 100 if inf.get("currentPrice") and inf.get("targetMeanPrice") else None
        else:
            inf = info(y) if y not in ETF_LOOKTHROUGH else {}
            sector, lt = classify_etf(y, inf.get("longName") or inf.get("shortName"))
            rel = (tr["ret3m"] - acwi["ret3m"]) if tr and acwi and tr["ret3m"] is not None else None
            bench = spx if y in ("VUSA.AS", "QDVE.DE", "SXRV.DE") else acwi
            upside = None
        for s, w in lt.items():
            if s not in ("Other", "Broad market"):
                sector_exp[s] = sector_exp.get(s, 0) + value * w

        # Scores
        s_mkt = market_score(bench)
        s_sec = sector_score(rel)
        s_mom = momentum_score(tr)
        rv, s_vol, vol_note = volume_read(d) if d else (None, 8, "no data")
        star = rt.get("star_rating") or 3
        if is_stock:
            s_fun = min(20, star * 3 + (5 if (upside or 0) > 15 else 3 if (upside or 0) > 5 else 1 if (upside or 0) > 0 else 0))
            s_con = 10 if weight <= 5 else 6 if weight <= MAX_STOCK_PCT else 0
        else:
            s_fun = star * 4
            s_con = 10 if weight <= 15 else 5 if weight <= 25 else 0
        score = int(round(s_mkt + s_sec + s_mom + s_vol + s_fun + s_con))
        level, action = band(score)
        breakdown = {"market": s_mkt, "sector": s_sec, "momentum": s_mom, "volume": s_vol,
                     "fundamentals": s_fun, "concentration": s_con}
        signals = {
            "rule": combo_rule(s_mkt == 20, s_sec >= 14, s_vol == 0),
            "volume": vol_note,
            "sector_rel_3m": round(rel, 1) if rel is not None else None,
            "upside_pct": round(upside, 1) if upside is not None else None,
            "drawdown_pct": round(tr["dd"], 1) if tr else None,
            "above50": tr["above50"] if tr else None, "above200": tr["above200"] if tr else None,
        }

        trim_plan, trail, dist, max_pos, breached = [], None, None, None, False
        if is_stock:
            # Staged ladder
            for lvl, label, pct_hi, pct_lo in STOCK_LADDER:
                pct = (pct_hi if score >= 80 else pct_lo)
                if pct is None:
                    pct = 1 / (1 + lvl / 100)   # share of the position worth your original stake at this level
                trim_plan.append({
                    "gain": lvl, "label": label, "price": round(avg * (1 + lvl / 100), 2), "unit": u,
                    "hit": gain >= lvl, "sell_pct": round(pct * 100),
                    "sell_qty": round(qty * pct, 4), "sell_gbp": round(value * pct, 2),
                })
            # Trailing exit (3×ATR below 3-month high close), applied as a % to the T212 price
            if d:
                a = atr(d)
                hi = max(d["c"][-63:])
                if a:
                    py = d["c"][-1]
                    stop_y = hi - ATR_MULT * a
                    dist = (py - stop_y) / py            # negative → price already below the exit
                    trail = round(cur * stop_y / py, 2)
                    breached = py < stop_y
                    size_dist = ATR_MULT * a / py        # risk distance used for position sizing
                    max_pos = round(total * RISK_PER_TRADE_PCT / 100 / size_dist, 2)
            if breached:
                notes.append(f"Trailing exit breached — price is {abs(dist)*100:.0f}% below the 3×ATR exit from the 3-month high; "
                             f"trend has broken, decide hold vs exit on the thesis")
                signals["trail_breached"] = True
            if max_pos:
                if value > max_pos:
                    notes.append(f"Oversized for 1% risk: £{value:,.0f} vs £{max_pos:,.0f} max")
            hit = [x for x in trim_plan if x["hit"] and x["sell_pct"]]
            if hit and level != "reassess":
                h = hit[-1]
                action = f"{h['label']} — sell ~{h['sell_qty']} sh (≈£{h['sell_gbp']:.0f})" + (" · score strong, smaller trim" if score >= 80 else "")
                level = "trim"
            elif level == "trim" and gain <= 0:
                action = "Score 50–64 while in a loss — don't add; reduce only if the thesis has weakened"
            elif gain >= 15 and level in ("run", "hold"):
                notes.append("+15% reached — check momentum, volume and fundamentals before the +20% trim")
            if weight > MAX_STOCK_PCT:
                notes.append(f"Above {MAX_STOCK_PCT:.0f}% single-stock limit ({weight:.1f}%)")
        else:
            # ETF rules: gain bands, drift, drawdown — no tight stops
            if gain >= 20:
                notes.append("Gain 20–30%+: trim only if overweight")
            elif gain >= 10:
                notes.append("Gain 10–20%: review allocation & underlying index")
            elif gain >= 5:
                notes.append("Gain 5–10%: hold — no automatic selling")
            tgt, curw = iv.get("target"), iv.get("current")
            if tgt:
                over_pp = curw - tgt
                over_rel = (curw / tgt - 1) if tgt else 0
                if over_pp >= DRIFT_PP or over_rel >= DRIFT_REL:
                    level = "rebalance" if level != "reassess" else level
                    action = (f"Overweight {curw:.0f}% vs {tgt:.0f}% target — stop adding, route new money to "
                              f"underweight holdings; sell down only at quarterly review")
                elif tgt - curw >= DRIFT_PP or (curw and tgt / max(curw, 0.01) - 1 >= DRIFT_REL):
                    notes.append(f"Underweight {curw:.0f}% vs {tgt:.0f}% target — direct new contributions here")
                if iv.get("override"):
                    notes.append(f"Target from agreed plan ({tgt:.0f}%); T212 pie set to {iv['t212_target']:.0f}%")
            dd = tr["dd"] if tr else 0
            if dd >= 20:
                notes.append(f"{dd:.0f}% below 52w high — reassess risk & thesis")
            elif dd >= 10:
                notes.append(f"{dd:.0f}% below 52w high — review, don't panic sell")
            if weight > 25:
                notes.append(f"{weight:.0f}% of all holdings in one ETF — concentration risk")

        rows.append({
            "ticker": t, "display": p.get("display"), "yahoo_ticker": y, "pie": (p.get("pie") or "").strip(),
            "kind": kind, "sector": sector, "value_gbp": round(value, 2), "weight_pct": round(weight, 2),
            "gain_pct": gain, "score": score, "breakdown": breakdown, "action": action, "action_level": level,
            "trim_plan": trim_plan, "trailing_stop": trail,
            "stop_distance_pct": round(dist * 100, 1) if dist else None,
            "max_position_gbp": max_pos, "rel_volume": round(rv, 2) if rv else None,
            "signals": signals, "notes": notes, "updated_at": now,
        })
        print(f"  {y:<9} {kind:<5} score={score:>3} {level:<9} {action[:70]}")

    # Upsert + clean stale
    if rows:
        sb("POST", "profit_booking?on_conflict=ticker", rows, prefer="resolution=merge-duplicates,return=minimal")
        keep = ",".join(f'"{r["ticker"]}"' for r in rows)
        sb("DELETE", f"profit_booking?ticker=not.in.({urllib.request.quote(keep, safe=',()')})")

    # ── Summary ──
    sectors = sorted(({"sector": s, "gbp": round(v, 2), "pct": round(v / total * 100, 1),
                       "over": v / total * 100 > MAX_SECTOR_PCT} for s, v in sector_exp.items()),
                     key=lambda x: -x["pct"])
    pies = []
    for p in pies_raw:
        pname = p["name"].strip()
        items = [v for v in inst.values() if v["pie"] == pname]
        val = sum(i["value"] for i in items)
        invd = sum(i["invested"] for i in items)
        pr = [r for r in rows if r["pie"] == pname]
        pies.append({
            "pie": pname, "gbp": round(val, 2), "pct": round(val / total * 100, 1),
            "invested_gbp": round(invd, 2), "gain_gbp": round(val - invd, 2) if invd else None,
            "gain_pct": round((val / invd - 1) * 100, 1) if invd else None,
            "avg_score": round(sum(r["score"] for r in pr) / len(pr)) if pr else None,
            "flags": [r["display"] for r in pr if r["action_level"] in ("trim", "rebalance", "reassess")],
        })
    pies.sort(key=lambda x: -x["gbp"])
    trims = sum(next((x["sell_gbp"] for x in reversed(r["trim_plan"]) if x["hit"] and x["sell_pct"]), 0)
                for r in rows if r["kind"] == "stock" and r["action_level"] == "trim")
    notes = []
    tech = next((s for s in sectors if s["sector"] == "Technology"), None)
    if tech and tech["over"]:
        notes.append(f"Technology look-through is {tech['pct']}% of holdings (limit {MAX_SECTOR_PCT:.0f}%) — "
                     f"QDVE, SXRV, VUSA, VWCE and Mag 7 overlap; grow VWCE towards 50% of Wider ETF with new money")
    for s in sectors:
        if s["over"] and s["sector"] != "Technology":
            notes.append(f"{s['sector']} is {s['pct']}% of holdings — above the {MAX_SECTOR_PCT:.0f}% sector cap")
    top = max(rows, key=lambda r: r["weight_pct"]) if rows else None
    if top and top["weight_pct"] > 20:
        notes.append(f"Largest single holding: {top['display']} at {top['weight_pct']}% of holdings")
    notes.append({"Aggressive": "Market regime Aggressive — let winners run, trim only at ladder levels.",
                  "Neutral": "Market regime Neutral — follow the ladder, tighten review on weak sectors.",
                  "Defensive": "Market regime Defensive — book ladder profits fully, protect gains, avoid new stock risk."}[reg["mode"]])

    summary = {
        "regime": reg, "sectors": sectors, "pies": pies,
        "limits": {"risk_per_trade_pct": RISK_PER_TRADE_PCT, "risk_per_trade_gbp": round(total * RISK_PER_TRADE_PCT / 100, 2),
                   "max_stock_pct": MAX_STOCK_PCT, "max_sector_pct": MAX_SECTOR_PCT, "atr_mult": ATR_MULT,
                   "drift_pp": DRIFT_PP, "drift_rel_pct": DRIFT_REL * 100},
        "totals": {"holdings_gbp": round(total, 2),
                   "invested_gbp": round(sum(v["invested"] for v in inst.values()), 2),
                   "account_total": snap.get("total_value"), "cash": snap.get("cash"),
                   "suggested_trims_gbp": round(trims, 2),
                   "counts": {lvl: sum(1 for r in rows if r["action_level"] == lvl)
                              for lvl in ("run", "hold", "trim", "rebalance", "reassess")}},
        "notes": notes, "updated_at": now,
    }
    sb("DELETE", "profit_booking_summary?id=gt.0")
    sb("POST", "profit_booking_summary", summary)
    print(f"  ✓ {len(rows)} holdings scored · regime {reg['mode']} · trims £{trims:.2f}")
    print("[profit_booking] Done.")


if __name__ == "__main__":
    run()
