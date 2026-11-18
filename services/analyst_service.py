#!/usr/bin/env python3
"""
Analyst Service — fetches Yahoo Finance analyst ratings for all portfolio tickers
and upserts into Supabase analyst_ratings table.
Runs daily at 08:00 UTC via GitHub Actions.
Uses yfinance library which handles Yahoo auth/crumb automatically.
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

from services import lynch_service

try:
    import yfinance as yf
    USE_YFINANCE = True
except ImportError:
    USE_YFINANCE = False
    print("[analyst_service] WARNING: yfinance not installed, falling back to direct HTTP")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# Driven entirely by the latest positions snapshot — no hardcoded tickers or pies.
#  • Individual stocks → real Yahoo analyst consensus (buy/hold/sell split, target price)
#  • ETFs (no analyst coverage on Yahoo) → trend rating from the ETF's own price data
#    (price vs 50/200-day MA, 6-month return). analyst_count = 0 marks a trend rating.
from services.value_buy_service import t212_to_yahoo


def supabase_request(method, path, data=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    if method == "POST" and data:
        # resolution=merge-duplicates triggers ON CONFLICT DO UPDATE (upsert)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"  Supabase {method} {path} → {e.code}: {err_body}")
        # 409 duplicate key = table missing ON CONFLICT support, try DELETE+INSERT
        if e.code == 409 and method == "POST" and data and "ticker" in data:
            return supabase_upsert_fallback(path, data)
        return None


def supabase_upsert_fallback(path, data):
    """Fallback upsert: DELETE existing row by ticker, then INSERT fresh."""
    ticker = data.get("ticker", "")
    path = path.split("?")[0]
    # Delete existing
    del_url = f"{SUPABASE_URL}/rest/v1/{path}?ticker=eq.{urllib.request.quote(ticker)}"
    del_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "return=minimal",
    }
    del_req = urllib.request.Request(del_url, headers=del_headers, method="DELETE")
    try:
        with urllib.request.urlopen(del_req, timeout=15):
            pass
    except Exception:
        pass  # ignore delete errors (row may not exist)
    # Re-insert
    ins_url = f"{SUPABASE_URL}/rest/v1/{path}"
    ins_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    ins_body = json.dumps(data).encode()
    ins_req = urllib.request.Request(ins_url, data=ins_body, headers=ins_headers, method="POST")
    try:
        with urllib.request.urlopen(ins_req, timeout=15) as resp:
            content = resp.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e2:
        print(f"  Supabase fallback INSERT → {e2.code}: {e2.read().decode()}")
        return None


def fetch_yahoo_analyst_yf(yahoo_ticker):
    """Fetch analyst data via yfinance (handles auth automatically)."""
    try:
        t = yf.Ticker(yahoo_ticker)
        # Use fast_info first (lighter request) then fall to full info
        try:
            info = t.info or {}
        except Exception as e1:
            print(f"  info() failed for {yahoo_ticker}: {e1} — trying fast_info")
            try:
                fi = t.fast_info
                # Build minimal info dict from fast_info
                info = {
                    "recommendationKey": getattr(fi, "recommendationKey", None) or getattr(fi, "recommendation_key", None),
                    "targetMeanPrice": getattr(fi, "targetMeanPrice", None),
                    "numberOfAnalystOpinions": getattr(fi, "numberOfAnalystOpinions", None),
                }
            except Exception as e2:
                print(f"  fast_info also failed for {yahoo_ticker}: {e2}")
                return None

        recommendation = (info.get("recommendationKey") or "none").lower()
        target_mean = info.get("targetMeanPrice")
        analyst_count = info.get("numberOfAnalystOpinions") or 1

        # yfinance info doesn't always have buy/hold/sell split — use recommendations df if available
        buy_pct, hold_pct, sell_pct = None, None, None
        try:
            recs = t.recommendations
            if recs is not None and not recs.empty:
                # Sum last 3 months
                recent = recs.tail(3) if len(recs) >= 3 else recs
                sb = recent.get("strongBuy", recent.get("Strong Buy", 0)).sum() if hasattr(recent, 'get') else 0
                b  = recent.get("buy",       recent.get("Buy",         0)).sum() if hasattr(recent, 'get') else 0
                h  = recent.get("hold",      recent.get("Hold",        0)).sum() if hasattr(recent, 'get') else 0
                s  = recent.get("sell",      recent.get("Sell",        0)).sum() if hasattr(recent, 'get') else 0
                ss = recent.get("strongSell",recent.get("Strong Sell", 0)).sum() if hasattr(recent, 'get') else 0
                # Try column access
                cols = list(recent.columns) if hasattr(recent, 'columns') else []
                for col in cols:
                    cv = recent[col].sum()
                    cl = col.lower().replace(" ", "")
                    if cl == "strongbuy": sb = cv
                    elif cl == "buy": b = cv
                    elif cl == "hold": h = cv
                    elif cl == "sell": s = cv
                    elif cl == "strongsell": ss = cv
                total = sb + b + h + s + ss or analyst_count or 1
                buy_pct  = round((sb + b) / total * 100, 1)
                hold_pct = round(h / total * 100, 1)
                sell_pct = round((s + ss) / total * 100, 1)
        except Exception:
            pass

        # Fallback: estimate from recommendation key
        if buy_pct is None:
            rec_map = {
                "strong_buy":  (85, 10, 5),
                "buy":         (65, 25, 10),
                "hold":        (30, 50, 20),
                "underperform":(15, 35, 50),
                "sell":        (10, 20, 70),
                "none":        (40, 40, 20),
            }
            buy_pct, hold_pct, sell_pct = rec_map.get(recommendation, (40, 40, 20))

        if buy_pct >= 70: star_rating = 5
        elif buy_pct >= 55: star_rating = 4
        elif buy_pct >= 40: star_rating = 3
        elif buy_pct >= 25: star_rating = 2
        else: star_rating = 1

        # Skip tickers with no useful data
        if recommendation == "none" and not target_mean:
            return None

        return {
            "recommendation": recommendation,
            "star_rating": star_rating,
            "target_mean": target_mean,
            "buy_pct": buy_pct,
            "hold_pct": hold_pct,
            "sell_pct": sell_pct,
            "analyst_count": analyst_count,
        }
    except Exception as e:
        print(f"  yfinance error for {yahoo_ticker}: {e}")
        return None


def _yahoo_crumb_and_cookie():
    """Get a crumb + session cookie from Yahoo Finance (required for v10 API)."""
    req = urllib.request.Request(
        "https://finance.yahoo.com/quote/AAPL",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        cookie = resp.headers.get("Set-Cookie", "")
        html = resp.read().decode("utf-8", errors="ignore")

    # Extract crumb from page source
    import re
    m = re.search(r'"crumb":"([^"]+)"', html)
    crumb = m.group(1) if m else None
    return crumb, cookie


_CRUMB = None
_COOKIE = None


def fetch_yahoo_analyst(yahoo_ticker):
    """Fetch analyst summary — yfinance first, HTTP fallback."""
    if USE_YFINANCE:
        return fetch_yahoo_analyst_yf(yahoo_ticker)
    return _fetch_yahoo_http(yahoo_ticker)


def _fetch_yahoo_http(yahoo_ticker):
    """HTTP fallback using Yahoo Finance v10 quoteSummary."""
    global _CRUMB, _COOKIE
    try:
        # Get crumb once per session
        if not _CRUMB:
            try:
                _CRUMB, _COOKIE = _yahoo_crumb_and_cookie()
            except Exception as e:
                print(f"  crumb fetch failed: {e}")

        # Try v10 with crumb first, fall back to v7 quote endpoint
        data = None
        for attempt in range(2):
            try:
                if attempt == 0 and _CRUMB:
                    url = (
                        f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{yahoo_ticker}"
                        f"?modules=recommendationTrend%2CfinancialData&crumb={urllib.request.quote(_CRUMB)}"
                    )
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "application/json",
                        "Cookie": _COOKIE or "",
                    }
                else:
                    # v7 quote — simpler, just price + recommendation, no analyst counts
                    url = (
                        f"https://query1.finance.yahoo.com/v7/finance/quote"
                        f"?symbols={yahoo_ticker}&fields=recommendationKey,targetMeanPrice,numberOfAnalystOpinions"
                    )
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "application/json",
                    }

                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
                break
            except urllib.error.HTTPError as e:
                if e.code in (401, 403, 404) and attempt == 0:
                    _CRUMB = None  # reset crumb, retry with v7
                    continue
                raise

        if not data:
            return None

        # Parse v10 quoteSummary response
        if "quoteSummary" in data:
            result = data.get("quoteSummary", {}).get("result", [])
            if not result:
                return None
            r = result[0]
            fd = r.get("financialData", {})
            rt = r.get("recommendationTrend", {}).get("trend", [{}])
            trend = rt[0] if rt else {}

            recommendation = fd.get("recommendationKey", "none").lower()
            target_mean = fd.get("targetMeanPrice", {}).get("raw", None)

            strong_buy = trend.get("strongBuy", 0)
            buy = trend.get("buy", 0)
            hold = trend.get("hold", 0)
            sell = trend.get("sell", 0)
            strong_sell = trend.get("strongSell", 0)
            total = strong_buy + buy + hold + sell + strong_sell or 1

            buy_pct = round((strong_buy + buy) / total * 100, 1)
            hold_pct = round(hold / total * 100, 1)
            sell_pct = round((sell + strong_sell) / total * 100, 1)

        # Parse v7 quote response (fallback)
        elif "quoteResponse" in data:
            results = data.get("quoteResponse", {}).get("result", [])
            if not results:
                return None
            q = results[0]
            recommendation = q.get("recommendationKey", "none").lower()
            target_mean = q.get("targetMeanPrice", None)
            total = q.get("numberOfAnalystOpinions", 1) or 1
            # v7 doesn't split buy/hold/sell — estimate from recommendation
            rec_map = {
                "strong_buy": (85, 10, 5),
                "buy": (65, 25, 10),
                "hold": (30, 50, 20),
                "underperform": (15, 35, 50),
                "sell": (10, 20, 70),
            }
            buy_pct, hold_pct, sell_pct = rec_map.get(recommendation, (40, 40, 20))
        else:
            return None

        # Star rating 1-5 based on buy %
        if buy_pct >= 70:
            star_rating = 5
        elif buy_pct >= 55:
            star_rating = 4
        elif buy_pct >= 40:
            star_rating = 3
        elif buy_pct >= 25:
            star_rating = 2
        else:
            star_rating = 1

        return {
            "recommendation": recommendation,
            "star_rating": star_rating,
            "target_mean": target_mean,
            "buy_pct": buy_pct,
            "hold_pct": hold_pct,
            "sell_pct": sell_pct,
            "analyst_count": total,
        }

    except Exception as e:
        print(f"  Yahoo fetch error for {yahoo_ticker}: {e}")
        return None


def stars_from_buy_pct(buy_pct):
    if buy_pct >= 70: return 5
    if buy_pct >= 55: return 4
    if buy_pct >= 40: return 3
    if buy_pct >= 25: return 2
    return 1


def fetch_trend_rating(yahoo_ticker):
    """Rating for ETFs / uncovered tickers from 1y price history."""
    if not USE_YFINANCE:
        return None
    try:
        hist = yf.Ticker(yahoo_ticker).history(period="1y", interval="1d")
        closes = [float(c) for c in hist["Close"].dropna().tolist()]
    except Exception as e:
        print(f"  trend error for {yahoo_ticker}: {e}")
        return None
    if len(closes) < 60:
        return None
    price = closes[-1]
    ma50  = sum(closes[-50:]) / 50
    ma200 = sum(closes[-200:]) / min(len(closes), 200)
    base6 = closes[-126] if len(closes) >= 126 else closes[0]
    ret_6m = (price / base6 - 1) * 100

    # AGGRESSIVE: lower momentum bars, reward dips inside an uptrend,
    # only hard-penalise genuine falling knives (6m < -25%).
    points = 0
    if price > ma200: points += 1
    if ma50 > ma200:  points += 1
    if ret_6m > 3:    points += 1
    if ret_6m > 10:   points += 1
    dip_in_uptrend = price < ma50 and price > ma200
    if dip_in_uptrend: points += 1
    points = min(points, 4)
    falling_knife = ret_6m < -25
    if falling_knife:
        points = 0
    buy_pct  = 15.0 if falling_knife else {0: 25.0, 1: 40.0, 2: 55.0, 3: 65.0, 4: 80.0}[points]
    sell_pct = 55.0 if falling_knife else {0: 35.0, 1: 25.0, 2: 15.0, 3: 10.0, 4: 5.0}[points]
    hold_pct = round(100 - buy_pct - sell_pct, 1)
    rec = ("sell" if falling_knife else "strong_buy" if points == 4 else
           "buy" if points >= 2 else "hold" if points == 1 else "underperform")
    return {
        "recommendation": rec,
        "star_rating": stars_from_buy_pct(buy_pct),
        "target_mean": None,
        "buy_pct": buy_pct, "hold_pct": hold_pct, "sell_pct": sell_pct,
        "analyst_count": 0,
        "_note": f"aggr trend 6m={ret_6m:+.1f}% px{'>' if price > ma200 else '<'}MA200"
                 + (" dip-in-uptrend" if dip_in_uptrend else "") + (" FALLING KNIFE" if falling_knife else ""),
    }


def load_positions():
    snaps = supabase_request("GET", "portfolio_snapshots?select=id&order=id.desc&limit=1") or []
    if not snaps:
        return []
    rows = supabase_request(
        "GET", f"positions?snapshot_id=eq.{snaps[0]['id']}&select=ticker,display,pie,exchange") or []
    seen = {}
    for r in rows:
        seen[r["ticker"]] = r
    return list(seen.values())


def run():
    print(f"[analyst_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    positions = load_positions()
    if not positions:
        print("  ERROR: no positions in latest snapshot — aborting (ratings left untouched)")
        return
    print(f"  Loaded {len(positions)} positions from latest snapshot")

    upserted = failed = 0
    now = datetime.now(timezone.utc).isoformat()
    rated = []

    for pos in positions:
        t212_ticker = pos["ticker"]
        pie = (pos.get("pie") or "Solo holdings").strip()
        yahoo_ticker, _ = t212_to_yahoo(t212_ticker, pos.get("exchange", ""))
        print(f"  Rating {yahoo_ticker} ({pie})...", end=" ", flush=True)

        data = fetch_yahoo_analyst(yahoo_ticker)
        source = "analysts"
        if not data:
            data = fetch_trend_rating(yahoo_ticker)
            source = "trend"
        if not data:
            print("✗ no data")
            failed += 1
            continue

        row = {
            "ticker": t212_ticker,
            "yahoo_ticker": yahoo_ticker,
            "pie": pie,
            "recommendation": data["recommendation"],
            "star_rating": data["star_rating"],
            "target_mean": data["target_mean"],
            "buy_pct": data["buy_pct"],
            "hold_pct": data["hold_pct"],
            "sell_pct": data["sell_pct"],
            "analyst_count": data["analyst_count"],
            "source": "analysts" if (data.get("analyst_count") or 0) > 0 else "trend",
            "updated_at": now,
        }
        try:                                    # Peter Lynch bucket (needs db/tenant/14_lynch_columns.sql); never blocks the rating
            ly = lynch_service.classify(lynch_service.fetch_fundamentals(yahoo_ticker))
            if ly["bucket"] is not None or ly["reason"]:
                row.update({"lynch_bucket": ly["bucket"], "lynch_name": ly["name"], "lynch_reason": ly["reason"],
                            "lynch_growth": ly["growth"], "lynch_basis": ly["basis"], "lynch_confidence": ly["confidence"]})
        except Exception as e:
            print(f"  lynch skipped for {yahoo_ticker}: {e}")
        result = supabase_request("POST", "analyst_ratings?on_conflict=ticker", row)
        if result is None and "lynch_bucket" in row:      # table without the Lynch columns yet: keep the rating, drop the extras
            for k in [k for k in row if k.startswith("lynch_")]:
                row.pop(k)
            result = supabase_request("POST", "analyst_ratings?on_conflict=ticker", row)
        if result is not None:
            extra = data.get("_note") or f"{data['analyst_count']} analysts"
            print(f"✓ [{source}] {data['recommendation']} ⭐{data['star_rating']} buy={data['buy_pct']}% ({extra})")
            upserted += 1
            rated.append(t212_ticker)
        else:
            failed += 1
        time.sleep(1)  # be kind to Yahoo

    # Drop ratings for anything not currently held (old placeholder tickers, ETF:* synthetic rows, sold pies)
    if rated:
        keep = ",".join(f'"{t}"' for t in rated)
        supabase_request("DELETE", f"analyst_ratings?ticker=not.in.({urllib.request.quote(keep, safe=',()')})")
        print(f"  ✓ removed ratings not in current positions")

    print(f"\n[analyst_service] Done. Upserted={upserted} Failed={failed}")


if __name__ == "__main__":
    run()
