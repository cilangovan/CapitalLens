#!/usr/bin/env python3
"""
History Service — fetches realised P&L (closed orders) and dividends
from Trading 212 history API and stores in Supabase.
Runs daily via GitHub Actions.
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

T212_BASE    = "https://live.trading212.com"
T212_API_KEY = os.environ["T212_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]


def t212_get(path, params=None):
    url = f"{T212_BASE}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"Authorization": T212_API_KEY})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  T212 {path} → {e.code}: {e.read().decode()[:200]}")
        return None
    except Exception as ex:
        print(f"  T212 {path} error: {ex}")
        return None


def sb_upsert(table, rows, conflict_col):
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    req = urllib.request.Request(
        url,
        data=json.dumps(rows).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": f"resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"  ✓ upserted {len(rows)} rows into {table}")
    except urllib.error.HTTPError as e:
        print(f"  ✗ {table} upsert failed {e.code}: {e.read().decode()[:300]}")


def fetch_all_pages(path, data_key="items", cursor_key="nextPagePath"):
    """Paginate through T212 history endpoint."""
    all_items = []
    next_path = path
    page = 0
    while next_path and page < 20:  # max 20 pages safety cap
        page += 1
        resp = t212_get(next_path)
        if not resp:
            break
        items = resp.get(data_key, [])
        all_items.extend(items)
        print(f"    page {page}: {len(items)} items (total {len(all_items)})")
        next_path = resp.get(cursor_key)
        if next_path:
            time.sleep(1)  # be kind to T212 rate limits
    return all_items


def fetch_orders():
    """Fetch all historical filled orders."""
    print("  Fetching order history...")
    return fetch_all_pages("/api/v0/equity/history/orders")


def fetch_dividends():
    """Fetch all dividend payments."""
    print("  Fetching dividend history...")
    return fetch_all_pages("/api/v0/history/dividends")


def process_orders(orders):
    """Convert T212 order records to realised_pnl rows."""
    rows = []
    for o in orders:
        status = o.get("status", "")
        if status not in ("FILLED", "PARTIALLY_FILLED"):
            continue
        ticker = o.get("ticker", "")
        display = ticker.split("_")[0]
        filled_at = o.get("dateModified") or o.get("dateCreated") or ""
        filled_date = filled_at[:10] if filled_at else None

        fill_price = float(o.get("fillPrice") or o.get("fillCost") or 0)
        quantity   = float(o.get("filledQuantity") or o.get("quantity") or 0)
        avg_cost   = float(o.get("averagePrice") or 0)

        # T212 sometimes provides realised P&L directly
        raw_pnl = o.get("result") or {}
        realised = float(raw_pnl.get("realised") or 0) if isinstance(raw_pnl, dict) else 0

        # If not provided, estimate from fill vs avg cost (sell orders only)
        side = o.get("type", "").upper()  # BUY / SELL / LIMIT_BUY etc
        is_sell = "SELL" in side
        if realised == 0 and is_sell and avg_cost > 0 and quantity > 0:
            realised = (fill_price - avg_cost) * quantity

        realised_pct = round((realised / (avg_cost * quantity) * 100) if avg_cost > 0 and quantity > 0 else 0, 2)

        rows.append({
            "order_id":        str(o.get("id", "")),
            "ticker":          ticker,
            "display":         display,
            "filled_date":     filled_date,
            "quantity":        round(quantity, 6),
            "fill_price":      round(fill_price, 4),
            "avg_cost":        round(avg_cost, 4),
            "realised_pnl":    round(realised, 2),
            "realised_pnl_pct": realised_pct,
            "side":            side,
        })
    return rows


def process_dividends(dividends):
    """Convert T212 dividend records to dividend rows."""
    rows = []
    for d in dividends:
        ticker  = d.get("ticker", "")
        display = ticker.split("_")[0]
        paid_at = d.get("paidOn") or d.get("dateModified") or ""
        paid_date = paid_at[:10] if paid_at else None
        amount = float(d.get("amount") or d.get("grossAmount") or 0)
        rows.append({
            "reference": str(d.get("reference") or d.get("id") or ""),
            "ticker":    ticker,
            "display":   display,
            "paid_date": paid_date,
            "amount":    round(amount, 4),
        })
    return rows


def run():
    print(f"[history_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    # Orders → realised P&L
    orders = fetch_orders()
    print(f"  {len(orders)} total orders fetched")
    order_rows = process_orders(orders)
    sells = [r for r in order_rows if "SELL" in r["side"]]
    print(f"  {len(sells)} sell orders with realised P&L")
    sb_upsert("realised_pnl", order_rows, "order_id")

    # Dividends
    divs = fetch_dividends()
    print(f"  {len(divs)} dividends fetched")
    div_rows = process_dividends(divs)
    sb_upsert("dividends", div_rows, "reference")

    # Summary stats
    total_realised = sum(r["realised_pnl"] for r in order_rows if "SELL" in r["side"])
    total_divs     = sum(r["amount"] for r in div_rows)
    print(f"  Total realised P&L: £{total_realised:.2f}")
    print(f"  Total dividends:    £{total_divs:.2f}")
    print(f"[history_service] Done.")


if __name__ == "__main__":
    run()
