#!/usr/bin/env python3
"""
Analyst Service — fetches Yahoo Finance analyst ratings for all portfolio tickers
and upserts into Supabase analyst_ratings table.
Runs daily at 08:00 UTC via GitHub Actions.
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# Map T212 ticker suffixes → Yahoo Finance tickers
TICKER_MAP = {
    # Wider ETF
    "VWRL_EQ": "VWRL.L",
    "IWDG_EQ": "IWDG.L",
    "VAPX_EQ": "VAPX.L",
    "VMID_EQ": "VMID.L",
    # Semiconductor
    "SOXX_US_EQ": "SOXX",
    "SMH_US_EQ": "SMH",
    # Atomic Resources
    "URNM_US_EQ": "URNM",
    "UEC_US_EQ": "UEC",
    "CCJ_US_EQ": "CCJ",
    "XOM_US_EQ": "XOM",
    # Country ETF
    "EWJ_US_EQ": "EWJ",
    "EWZ_US_EQ": "EWZ",
    "EWY_US_EQ": "EWY",
    "EWG_US_EQ": "EWG",
    "EWU_US_EQ": "EWU",
    "EWA_US_EQ": "EWA",
    # Global ETF
    "ACWI_US_EQ": "ACWI",
    "VT_US_EQ": "VT",
    "VXUS_US_EQ": "VXUS",
    "VEA_US_EQ": "VEA",
    "VWO_US_EQ": "VWO",
    "IEMG_US_EQ": "IEMG",
    "SCHF_US_EQ": "SCHF",
    "VSS_US_EQ": "VSS",
    # Space x allied
    "ARKX_US_EQ": "ARKX",
    "SPCE_US_EQ": "SPCE",
    "LMT_US_EQ": "LMT",
    "RTX_US_EQ": "RTX",
    "BA_US_EQ": "BA",
    "NOC_US_EQ": "NOC",
    # EM markets
    "VWO_US_EQ_EM": "VWO",
    "EEM_US_EQ": "EEM",
    "EMXC_US_EQ": "EMXC",
    "FM_US_EQ": "FM",
    "EEMV_US_EQ": "EEMV",
    # UK Gold & Silver
    "SSLN_l_EQ": "SSLN.L",
    "SGLN_l_EQ": "SGLN.L",
    # Magnificent 7
    "AAPL_US_EQ": "AAPL",
    "MSFT_US_EQ": "MSFT",
    "GOOGL_US_EQ": "GOOGL",
    "AMZN_US_EQ": "AMZN",
    "NVDA_US_EQ": "NVDA",
    "META_US_EQ": "META",
    "TSLA_US_EQ": "TSLA",
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
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  Supabase {method} {path} → {e.code}: {body}")
        return None


def fetch_yahoo_analyst(yahoo_ticker):
    """Fetch analyst summary from Yahoo Finance v8 quoteSummary."""
    try:
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/quoteSummary/{yahoo_ticker}"
            "?modules=recommendationTrend,financialData,defaultKeyStatistics"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

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

    # Get unique Yahoo tickers
    yahoo_tickers = {}
    for t212_ticker, yahoo_ticker in TICKER_MAP.items():
        if yahoo_ticker not in yahoo_tickers:
            yahoo_tickers[yahoo_ticker] = t212_ticker

    upserted = 0
    failed = 0

    for yahoo_ticker, t212_ticker in yahoo_tickers.items():
        pie = PIE_MAP.get(yahoo_ticker, "Solo")
        print(f"  Fetching {yahoo_ticker} ({pie})...", end=" ")
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
                "updated_at": datetime.now(timezone.utc).isoformat(),
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

    print(f"\n[analyst_service] Done. Upserted={upserted} Failed={failed}")


if __name__ == "__main__":
    run()
