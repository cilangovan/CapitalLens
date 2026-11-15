#!/usr/bin/env python3
"""
Returns Service — calculates XIRR, annualised return, yearly/monthly breakdowns
from portfolio_snapshots in Supabase.
Runs daily after analyst_service.
"""

import os
import json
import math
import urllib.request
import urllib.error
from datetime import datetime, timezone, date
from collections import defaultdict

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# Approximate monthly contributions (£) — used for XIRR cashflow estimation
# Format: "YYYY-MM" → amount contributed that month
# If not in map, default to £200
MONTHLY_CONTRIBUTIONS = {
    "2024-01": 200,
    "2024-02": 200,
    "2024-03": 200,
    "2024-04": 200,
    "2024-05": 200,
    "2024-06": 200,
    "2024-07": 200,
    "2024-08": 200,
    "2024-09": 200,
    "2024-10": 200,
    "2024-11": 200,
    "2024-12": 200,
    "2025-01": 200,
    "2025-02": 200,
    "2025-03": 200,
    "2025-04": 200,
    "2025-05": 200,
    "2025-06": 200,
    "2025-07": 200,
    "2025-08": 200,
    "2025-09": 200,
    "2025-10": 200,
    "2025-11": 200,
    "2025-12": 200,
    "2026-01": 200,
    "2026-02": 200,
    "2026-03": 200,
    "2026-04": 200,
    "2026-05": 200,
    "2026-06": 200,
    "2026-07": 200,
    "2026-08": 200,
    "2026-09": 200,
    "2026-10": 200,
    "2026-11": 300,
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


def xirr(cashflows, dates, guess=0.1):
    """
    Pure-Python XIRR calculation.
    cashflows: list of floats (negative = outflow, positive = inflow)
    dates: list of date objects
    Returns annualised rate as decimal (e.g. 0.15 = 15%)
    """
    if not cashflows or not dates:
        return 0.0

    base_date = dates[0]
    day_fracs = [(d - base_date).days / 365.0 for d in dates]

    def npv(rate):
        return sum(cf / ((1 + rate) ** t) for cf, t in zip(cashflows, day_fracs))

    def dnpv(rate):
        return sum(-t * cf / ((1 + rate) ** (t + 1)) for cf, t in zip(cashflows, day_fracs))

    rate = guess
    for _ in range(200):
        try:
            f = npv(rate)
            df = dnpv(rate)
            if abs(df) < 1e-12:
                break
            new_rate = rate - f / df
            if abs(new_rate - rate) < 1e-8:
                return new_rate
            rate = new_rate
            if rate <= -1:
                rate = -0.9999
        except (OverflowError, ZeroDivisionError):
            break
    return rate


def get_snapshots():
    """Fetch all portfolio snapshots ordered by time."""
    path = "portfolio_snapshots?select=id,created_at,total_value,invested,cash&order=created_at.asc"
    return supabase_request("GET", path) or []


def build_cashflows(snapshots):
    """
    Build XIRR cashflow list from snapshots + monthly contributions.
    Only uses months from the FIRST snapshot onwards (not before).
    - Monthly contributions are negative outflows (money invested)
    - Current portfolio value is positive inflow (terminal value)
    """
    if not snapshots:
        return [], []

    first_snap = snapshots[0]
    first_dt = datetime.fromisoformat(first_snap["created_at"].replace("Z", "+00:00"))
    first_date = first_dt.date()
    last_snap = snapshots[-1]
    current_value = float(last_snap["total_value"] or 0)

    # Start from the month of the first snapshot
    start_month = first_date.replace(day=1)
    today = date.today()

    # Safety: if we have < 30 days of data, XIRR is meaningless
    if (today - first_date).days < 30:
        return [], []

    cashflows = []
    dates = []

    # Monthly contributions from first snapshot month to today
    cur = start_month
    while cur <= today:
        key = cur.strftime("%Y-%m")
        amount = MONTHLY_CONTRIBUTIONS.get(key, 200)
        cashflows.append(-amount)  # outflow
        dates.append(cur)
        # advance month
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)

    # Terminal value = current portfolio (positive inflow)
    cashflows.append(current_value)
    dates.append(today)

    return cashflows, dates


def build_yearly_breakdown(snapshots):
    """Group snapshots by year, compute start/end values and return %."""
    if not snapshots:
        return {}

    by_year = defaultdict(list)
    for s in snapshots:
        dt = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))
        by_year[dt.year].append(s)

    result = {}
    for year in sorted(by_year.keys()):
        year_snaps = by_year[year]
        start_val = float(year_snaps[0]["invested"] or 0)
        end_val = float(year_snaps[-1]["total_value"] or 0)
        end_invested = float(year_snaps[-1]["invested"] or 0)
        ppl = end_val - end_invested if end_invested else 0
        ppl_pct = round((ppl / end_invested * 100) if end_invested else 0, 2)
        result[str(year)] = {
            "total_value": round(end_val, 2),
            "invested": round(end_invested, 2),
            "ppl": round(ppl, 2),
            "ppl_pct": ppl_pct,
            "snapshot_count": len(year_snaps),
        }
    return result


def build_monthly_breakdown(snapshots):
    """Last snapshot per month → monthly return %."""
    if not snapshots:
        return {}

    by_month = defaultdict(list)
    for s in snapshots:
        dt = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))
        key = dt.strftime("%Y-%m")
        by_month[key].append(s)

    result = {}
    prev_value = None
    for month in sorted(by_month.keys()):
        last = by_month[month][-1]
        total_val = float(last["total_value"] or 0)
        invested = float(last["invested"] or 0)
        ppl = total_val - invested if invested else 0
        monthly_ret = None
        if prev_value and prev_value > 0:
            monthly_ret = round((total_val - prev_value) / prev_value * 100, 2)
        result[month] = {
            "total_value": round(total_val, 2),
            "invested": round(invested, 2),
            "ppl": round(ppl, 2),
            "monthly_ret_pct": monthly_ret,
        }
        prev_value = total_val
    return result


def run():
    print(f"[returns_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    snapshots = get_snapshots()
    print(f"  Fetched {len(snapshots)} snapshots")

    if not snapshots:
        print("  No snapshots — skipping")
        return

    # XIRR
    cashflows, dates = build_cashflows(snapshots)
    if cashflows:
        xirr_rate = xirr(cashflows, dates)
        # Guard against diverged result (XIRR should be between -100% and +1000%)
        if abs(xirr_rate) > 10:
            print(f"  XIRR diverged ({xirr_rate:.2f}), setting to 0")
            xirr_rate = 0.0
        xirr_pct = round(xirr_rate * 100, 2)
    else:
        xirr_pct = 0.0
        print("  XIRR: insufficient data (<30 days)")
    print(f"  XIRR: {xirr_pct}%")

    # Simple annualised from first to last snapshot
    first = snapshots[0]
    last = snapshots[-1]
    first_dt = datetime.fromisoformat(first["created_at"].replace("Z", "+00:00"))
    last_dt = datetime.fromisoformat(last["created_at"].replace("Z", "+00:00"))
    days = (last_dt - first_dt).days or 1

    start_invested = float(first["invested"] or 1)
    end_value = float(last["total_value"] or 0)
    total_ret_pct = round((end_value - start_invested) / start_invested * 100, 2)
    # Only annualise if we have 90+ days of history; otherwise it extrapolates wildly
    if days >= 90 and start_invested > 0:
        raw_ann = ((end_value / start_invested) ** (365 / days) - 1) * 100
        # Cap at ±500% to avoid display insanity from short periods
        ann_pct = round(max(-500, min(500, raw_ann)), 2)
    else:
        ann_pct = 0.0
        print(f"  Annualised: insufficient history ({days} days < 90), setting to 0")

    print(f"  Annualised: {ann_pct}%  Total return: {total_ret_pct}%")

    yearly = build_yearly_breakdown(snapshots)
    monthly = build_monthly_breakdown(snapshots)

    row = {
        "xirr_pct": xirr_pct,
        "annualised_pct": ann_pct,
        "total_return_pct": total_ret_pct,
        "yearly_breakdown": yearly,
        "monthly_breakdown": monthly,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Upsert (single row — delete old, insert new)
    supabase_request("DELETE", "returns_summary?id=gt.0")
    result = supabase_request("POST", "returns_summary", row)
    if result is not None:
        print("  ✓ returns_summary upserted")
    else:
        print("  ✗ failed to upsert returns_summary")

    print(f"[returns_service] Done.")


if __name__ == "__main__":
    run()
