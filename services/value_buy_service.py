#!/usr/bin/env python3
"""
Value Buy Service — manages PWI Scout / fundamental value-buy scores.

This is a manual-seed microservice: data is defined here (not fetched from an API)
and upserted to Supabase on each run.

To add a new stock: append an entry to SCORES below and re-run / trigger the workflow.
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

# ── RATING KEY ──────────────────────────────────────────────────────────────
# entry_zones[].rating:
#   "high"   → strong value entry, buy with conviction
#   "medium" → fair value, can accumulate gradually
#   "low"    → near/above fair value, wait or trim
# ────────────────────────────────────────────────────────────────────────────

SCORES = [
    {
        "ticker": "ITC",
        "display": "ITC Ltd",
        "pie": "India Value",
        "currency_symbol": "₹",
        "score": 78,
        "score_max": 100,
        "verdict": "Value Buy",
        "entry_zones": [
            {"label": "Below ₹255",    "low": None,  "high": 255,  "rating": "high",   "note": "Strong accumulate zone"},
            {"label": "₹255 – ₹275",  "low": 255,   "high": 275,  "rating": "high",   "note": "Good entry"},
            {"label": "₹275 – ₹295",  "low": 275,   "high": 295,  "rating": "medium", "note": "Fair value, accumulate slowly"},
            {"label": "₹295 – ₹315",  "low": 295,   "high": 315,  "rating": "low",    "note": "Near fair value, hold"},
            {"label": "Above ₹315",   "low": 315,   "high": None, "rating": "low",    "note": "Above fair value, avoid / trim"},
        ],
        "scorecard": [
            {"category": "Business quality",  "score": 19, "max": 20},
            {"category": "Financial strength", "score": 19, "max": 20},
            {"category": "Earnings momentum",  "score": 10, "max": 20},
            {"category": "Valuation",          "score": 16, "max": 20},
            {"category": "Growth outlook",     "score": 14, "max": 20},
        ],
        "earnings": {
            "period": "Sep 2026 quarter",
            "revenue_growth_pct": 3.93,
            "op_profit_growth_pct": -16.07,
            "net_profit_growth_pct": -18.46,
        },
        "warning": (
            "Earnings momentum is a concern — revenue grew +3.9% YoY but "
            "operating profit fell -16.1% and net profit -18.5% in Q2 FY27. "
            "Score reflects strong fundamentals tempered by near-term headwinds."
        ),
        "notes": (
            "ITC has excellent return ratios, a strong balance sheet and diversified "
            "revenue (cigarettes, FMCG, hotels, agri). Current price is not a screaming "
            "bargain given the earnings dip, but sub-₹275 offers a solid long-term entry."
        ),
    },
    # ── Add more stocks here ────────────────────────────────────────────────
    # {
    #     "ticker": "HDFC",
    #     "display": "HDFC Bank",
    #     "pie": "India Value",
    #     "currency_symbol": "₹",
    #     "score": 82,
    #     ...
    # },
]


def sb_upsert(rows):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/value_buy_scores"
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  ✓ upserted {len(rows)} value_buy_scores rows")
    except urllib.error.HTTPError as e:
        print(f"  ✗ value_buy_scores upsert failed {e.code}: {e.read().decode()[:300]}")


def run():
    print(f"[value_buy_service] Starting at {datetime.now(timezone.utc).isoformat()}")
    rows = []
    for s in SCORES:
        row = dict(s)
        row["entry_zones"] = json.dumps(s["entry_zones"])
        row["scorecard"]   = json.dumps(s["scorecard"])
        row["earnings"]    = json.dumps(s["earnings"])
        row["updated_at"]  = datetime.now(timezone.utc).isoformat()
        rows.append(row)
    sb_upsert(rows)
    print(f"[value_buy_service] Done — {len(rows)} stocks seeded.")


if __name__ == "__main__":
    run()
