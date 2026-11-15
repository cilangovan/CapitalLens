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

try:
    import yfinance as yf
    USE_YFINANCE = True
except ImportError:
    USE_YFINANCE = False
    print("[analyst_service] WARNING: yfinance not installed, falling back to direct HTTP")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# Only individual stocks that Yahoo Finance carries analyst ratings for.
# ETFs (VWRL, SOXX, SMH, EWJ, VWO, etc) have NO analyst consensus — Yahoo returns 404.
# Pie-level rating is derived by averaging the stocks within each pie that DO have ratings.
TICKER_MAP = {
    # Atomic Resources — individual stocks
    "UEC_US_EQ":  "UEC",
    "CCJ_US_EQ":  "CCJ",
    "XOM_US_EQ":  "XOM",
    # Space x allied — individual stocks
    "SPCE_US_EQ": "SPCE",
    "LMT_US_EQ":  "LMT",
    "RTX_US_EQ":  "RTX",
    "BA_US_EQ":   "BA",
    "NOC_US_EQ":  "NOC",
    # Magnificent 7 — all individual stocks
    "AAPL_US_EQ":  "AAPL",
    "MSFT_US_EQ":  "MSFT",
    "GOOGL_US_EQ": "GOOGL",
    "AMZN_US_EQ":  "AMZN",
    "NVDA_US_EQ":  "NVDA",
    "META_US_EQ":  "META",
    "TSLA_US_EQ":  "TSLA",
}

# ETF-only pies get a synthetic "index" rating (held at 4★ buy — broad market always recommended)
ETF_PIE_DEFAULTS = {
    "Wider ETF":    {"recommendation": "buy", "star_rating": 4, "buy_pct": 65.0, "hold_pct": 25.0, "sell_pct": 10.0, "analyst_count": 0},
    "Semiconductor":{"recommendation": "buy", "star_rating": 4, "buy_pct": 65.0, "hold_pct": 25.0, "sell_pct": 10.0, "analyst_count": 0},
    "Country Etf":  {"recommendation": "hold","star_rating": 3, "buy_pct": 45.0, "hold_pct": 40.0, "sell_pct": 15.0, "analyst_count": 0},
    "Global ETF":   {"recommendation": "buy", "star_rating": 4, "buy_pct": 65.0, "hold_pct": 25.0, "sell_pct": 10.0, "analyst_count": 0},
    "EM markets":   {"recommendation": "hold","star_rating": 3, "buy_pct": 40.0, "hold_pct": 45.0, "sell_pct": 15.0, "analyst_count": 0},
    "UK Gold & Silver":{"recommendation":"hold","star_rating":2, "buy_pct": 30.0, "hold_pct": 45.0, "sell_pct": 25.0, "analyst_count": 0},
}

# Pie assignment
PIE_MAP = {
    "VWRL.L": "Wider ETF", "IWDG.L": "Wider ETF", "VAPX.L": "Wider ETF", "VMID.L": "Wider ETF",
    "SOXX": "Semiconductor", "SMH": "Semiconductor",
    "URNM": "Atomic Resources", "UEC": "Atomic Resources", "CCJ": "Atomic Resources", "XOM": "Atomic Resources",
    "EWJ": "Country Etf", "EWZ": "Country Etf", "EWY": "Country Etf",
    "EWG": "Country Etf", "EWU": "Country Etf", "EWA": "Country Etf",
    "ACWI": "Global ETF", "VT": "Global ETF", "VXUS": "Global ETF", "VEA": "Global ETF",
    "VWO": "Global ETF", "IEMG": "Global ETF", "SCHF": "Global ETF", "VSS": "Global ETF",
    "ARKX": "Space x allied", "SPCE": "Space x allied", "LMT": "Space x allied",
    "RTX": "Space x allied", "BA": "Space x allied", "NOC": "Space x allied",
    "EEM": "EM markets", "EMXC": "EM markets", "FM": "EM markets", "EEMV": "EM markets",
    "SSLN.L": "UK Gold & Silver", "SGLN.L": "UK Gold & Silver",
    "AAPL": "Magnificent 7", "MSFT": "Magnificent 7", "GOOGL": "Magnificent 7",
    "AMZN": "Magnificent 7", "NVDA": "Magnificent 7", "META": "Magnificent 7", "TSLA": "Magnificent 7",
}


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


def run():
    print(f"[analyst_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Get unique Yahoo tickers (individual stocks only)
    yahoo_tickers = {}
    for t212_ticker, yahoo_ticker in TICKER_MAP.items():
        if yahoo_ticker not in yahoo_tickers:
            yahoo_tickers[yahoo_ticker] = t212_ticker

    upserted = 0
    failed = 0
    now = datetime.now(timezone.utc).isoformat()

    # Fetch real analyst data for individual stocks
    for yahoo_ticker, t212_ticker in yahoo_tickers.items():
        pie = PIE_MAP.get(yahoo_ticker, "Solo")
        print(f"  Fetching {yahoo_ticker} ({pie})...", end=" ", flush=True)
        data = fetch_yahoo_analyst(yahoo_ticker)

        if data:
            row = {
                "ticker": yahoo_ticker,
                "yahoo_ticker": yahoo_ticker,
                "pie": pie,
                "recommendation": data["recommendation"],
                "star_rating": data["star_rating"],
                "target_mean": data["target_mean"],
                "buy_pct": data["buy_pct"],
                "hold_pct": data["hold_pct"],
                "sell_pct": data["sell_pct"],
                "analyst_count": data["analyst_count"],
                "updated_at": now,
            }
            result = supabase_request("POST", "analyst_ratings", row)
            if result is not None:
                print(f"✓ {data['recommendation']} ⭐{data['star_rating']} buy={data['buy_pct']}%")
                upserted += 1
            else:
                failed += 1
        else:
            print("✗ no data")
            failed += 1

        time.sleep(1)  # be kind to Yahoo

    # Insert synthetic ratings for ETF-only pies (no real analyst data available)
    print(f"\n  Inserting ETF pie defaults...")
    for pie_name, defaults in ETF_PIE_DEFAULTS.items():
        ticker_key = f"ETF:{pie_name.replace(' ','_')}"
        row = {
            "ticker": ticker_key,
            "yahoo_ticker": None,
            "pie": pie_name,
            "recommendation": defaults["recommendation"],
            "star_rating": defaults["star_rating"],
            "target_mean": None,
            "buy_pct": defaults["buy_pct"],
            "hold_pct": defaults["hold_pct"],
            "sell_pct": defaults["sell_pct"],
            "analyst_count": 0,
            "updated_at": now,
        }
        result = supabase_request("POST", "analyst_ratings", row)
        if result is not None:
            print(f"  ✓ {pie_name} (synthetic) ⭐{defaults['star_rating']}")
            upserted += 1
        else:
            failed += 1

    print(f"\n[analyst_service] Done. Upserted={upserted} Failed={failed}")


if __name__ == "__main__":
    run()
