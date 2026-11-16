#!/usr/bin/env python3
"""
Strategy Service — 4-week rolling top-up recommendation engine.
Reads analyst_ratings + portfolio_snapshots from Supabase.
Writes strategy_recommendations.
Target: 15% annual return. Monthly budget: £200–£300 (£30/pie default).
"""

import os
import json
import math
import urllib.request
import urllib.error
from datetime import datetime, timezone, date

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

MONTHLY_BUDGET_MIN = 200
MONTHLY_BUDGET_MAX = 300
PER_PIE = 30
TARGET_ANNUAL = 15.0

# Tier classification
TIER_1 = ["Magnificent 7", "Wider ETF", "Global ETF"]          # always top up
TIER_2 = ["Semiconductor", "Atomic Resources", "Space x allied", "EM markets", "Country Etf"]  # conditional
HOLD   = ["UK Gold & Silver"]                                    # no new money

# Week pattern (1-indexed, rolling)
WEEK_FOCUS = {
    1: "Core",
    2: "Growth",
    3: "Dip",
    4: "Concentrate",
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
            return json.loads(content) if content else []
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path} → {e.code}: {e.read().decode()}")
        return None


def get_analyst_ratings():
    """Fetch latest analyst ratings grouped by pie."""
    rows = supabase_request("GET", "analyst_ratings?select=ticker,pie,recommendation,star_rating,buy_pct,target_mean") or []
    by_pie = {}
    for r in rows:
        pie = (r.get("pie") or "Solo").strip()
        if pie not in by_pie:
            by_pie[pie] = []
        by_pie[pie].append(r)
    return by_pie


def get_latest_snapshot():
    """Fetch most recent portfolio snapshot."""
    rows = supabase_request("GET", "portfolio_snapshots?select=*&order=created_at.desc&limit=1") or []
    return rows[0] if rows else {}


def get_latest_positions():
    """Fetch positions from most recent snapshot."""
    snap = get_latest_snapshot()
    if not snap:
        return []
    snap_id = snap.get("id")
    rows = supabase_request("GET", f"positions?snapshot_id=eq.{snap_id}&select=*") or []
    return rows


def get_returns():
    """Fetch returns summary."""
    rows = supabase_request("GET", "returns_summary?select=*&limit=1") or []
    return rows[0] if rows else {}


def week_number_of_year():
    """Return ISO week number."""
    return date.today().isocalendar()[1]


def rolling_week():
    """1-4 rolling week based on ISO week number."""
    return (week_number_of_year() % 4) or 4


def pie_avg_star(analyst_by_pie, pie_name):
    """Average star rating for a pie."""
    tickers = analyst_by_pie.get(pie_name, [])
    if not tickers:
        return 0.0
    stars = [t.get("star_rating", 0) or 0 for t in tickers]
    return round(sum(stars) / len(stars), 1)


def pie_avg_buy_pct(analyst_by_pie, pie_name):
    """Average buy% for a pie."""
    tickers = analyst_by_pie.get(pie_name, [])
    if not tickers:
        return 0.0
    buys = [t.get("buy_pct", 0) or 0 for t in tickers]
    return round(sum(buys) / len(buys), 1)


def has_dip(positions, pie_name):
    """Check if any position in pie has dip_from_high <= -8%."""
    for p in positions:
        if (p.get("pie") or "").strip() == pie_name:
            dip = p.get("dip_from_high", 0) or 0
            if dip <= -8.0:
                return True, dip
    return False, 0


def best_pie_by_analyst(analyst_by_pie):
    """Return pie name with highest avg star rating (excluding HOLD pies)."""
    best_pie = None
    best_star = 0
    for pie in TIER_1 + TIER_2:
        star = pie_avg_star(analyst_by_pie, pie)
        if star > best_star:
            best_star = star
            best_pie = pie
    return best_pie, best_star


def build_recommendations(week, analyst_by_pie, positions, returns):
    recs = []
    notes = []
    total = 0
    ann_ret = returns.get("annualised_pct", 0) or 0

    if week == 1:
        # Core — always Tier 1 pies £30 each
        for pie in TIER_1:
            star = pie_avg_star(analyst_by_pie, pie)
            recs.append({
                "pie": pie,
                "amount": PER_PIE,
                "reason": f"Core Tier 1 — always top up | ⭐{star}",
                "priority": "HIGH",
            })
            total += PER_PIE
        notes.append("Week 1: Core — Tier 1 pies unconditional top-up.")

    elif week == 2:
        # Growth — Tier 2 if analyst ⭐≥3.0 and buy%≥40%
        notes.append("Week 2: Growth — Tier 2 pies conditional on analyst quality.")
        for pie in TIER_2:
            star = pie_avg_star(analyst_by_pie, pie)
            buy_pct = pie_avg_buy_pct(analyst_by_pie, pie)
            if star >= 3.0 and buy_pct >= 40.0:
                recs.append({
                    "pie": pie,
                    "amount": PER_PIE,
                    "reason": f"⭐{star} buy={buy_pct}% — qualifies for growth top-up",
                    "priority": "MEDIUM",
                })
                total += PER_PIE
            else:
                notes.append(f"  ✗ {pie}: ⭐{star} buy={buy_pct}% — below threshold (skipped)")

        if not recs:
            # Fall back to Tier 1
            for pie in TIER_1:
                star = pie_avg_star(analyst_by_pie, pie)
                recs.append({
                    "pie": pie,
                    "amount": PER_PIE,
                    "reason": f"No Tier 2 qualifies — fallback to Tier 1 | ⭐{star}",
                    "priority": "MEDIUM",
                })
                total += PER_PIE
            notes.append("  Fallback: no Tier 2 pies qualified, using Tier 1.")

    elif week == 3:
        # Dip buying — any pie with confirmed -8% dip
        notes.append("Week 3: Dip buying — looking for -8%+ dips.")
        dip_found = False
        for pie in TIER_1 + TIER_2:
            dipped, worst_dip = has_dip(positions, pie)
            if dipped:
                recs.append({
                    "pie": pie,
                    "amount": PER_PIE,
                    "reason": f"Dip confirmed {worst_dip:.1f}% from high — buy opportunity",
                    "priority": "HIGH",
                })
                total += PER_PIE
                dip_found = True

        if not dip_found:
            notes.append("  No dips detected. Defaulting to Tier 1 core top-up.")
            for pie in TIER_1:
                star = pie_avg_star(analyst_by_pie, pie)
                recs.append({
                    "pie": pie,
                    "amount": PER_PIE,
                    "reason": f"No dips this week — Tier 1 default | ⭐{star}",
                    "priority": "LOW",
                })
                total += PER_PIE

    elif week == 4:
        # Concentrate — double up on best-rated pie
        best_pie, best_star = best_pie_by_analyst(analyst_by_pie)
        notes.append(f"Week 4: Concentrate — double up on {best_pie} (⭐{best_star}).")
        if best_pie:
            recs.append({
                "pie": best_pie,
                "amount": PER_PIE * 2,
                "reason": f"Week 4 concentrate — best analyst rating ⭐{best_star}",
                "priority": "HIGH",
            })
            total += PER_PIE * 2
        # Also Tier 1 cores
        for pie in TIER_1:
            if pie != best_pie:
                star = pie_avg_star(analyst_by_pie, pie)
                recs.append({
                    "pie": pie,
                    "amount": PER_PIE,
                    "reason": f"Tier 1 always-on | ⭐{star}",
                    "priority": "MEDIUM",
                })
                total += PER_PIE

    # Pace check
    on_track = ann_ret >= (TARGET_ANNUAL * 0.5)  # at least half target = OK
    if ann_ret < TARGET_ANNUAL * 0.5:
        notes.append(f"⚠️ Growth lag: annualised {ann_ret:.1f}% vs target {TARGET_ANNUAL}%")
    elif ann_ret >= TARGET_ANNUAL:
        notes.append(f"✅ On track: annualised {ann_ret:.1f}% ≥ {TARGET_ANNUAL}% target")
    else:
        notes.append(f"📈 Progress: annualised {ann_ret:.1f}% (target {TARGET_ANNUAL}%)")

    return recs, notes, total, on_track


def run():
    print(f"[strategy_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    analyst_by_pie = get_analyst_ratings()
    print(f"  Analyst data: {sum(len(v) for v in analyst_by_pie.values())} tickers across {len(analyst_by_pie)} pies")

    positions = get_latest_positions()
    print(f"  Positions: {len(positions)}")

    returns = get_returns()
    ann_ret = returns.get("annualised_pct", 0)
    print(f"  Returns: annualised={ann_ret}%")

    week = rolling_week()
    focus = WEEK_FOCUS[week]
    print(f"  Week {week} of 4 — {focus}")

    recs, notes, total, on_track = build_recommendations(week, analyst_by_pie, positions, returns)

    row = {
        "week_number": week,
        "total_suggested": total,
        "on_track": on_track,
        "annualised_return": ann_ret,
        "recommendations": recs,
        "notes": notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Delete old + insert fresh
    supabase_request("DELETE", "strategy_recommendations?id=gt.0")
    result = supabase_request("POST", "strategy_recommendations", row)
    if result is not None:
        print(f"  ✓ strategy_recommendations saved (week={week}, total=£{total})")
    else:
        print("  ✗ failed to save strategy_recommendations")

    print("[strategy_service] Done.")


if __name__ == "__main__":
    run()
