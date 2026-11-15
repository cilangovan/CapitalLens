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
    return fetch_all_pages("/api/v0/equity/history/dividends")


def fetch_transactions():
    """Fetch deposits and withdrawals."""
    print("  Fetching transactions...")
    return fetch_all_pages("/api/v0/equity/history/transactions")


def process_orders(orders):
    """Convert T212 order records to realised_pnl rows.

    T212 response structure (historical events API):
      items[].fill.walletImpact.realisedProfitLoss  ← actual realised P&L
      items[].fill.price, fill.quantity, fill.filledAt
      items[].order.side (BUY/SELL), order.status, order.ticker,
      items[].order.instrument.ticker
    """
    rows = []
    for item in orders:
        fill  = item.get("fill") or {}
        order = item.get("order") or {}

        status = order.get("status", "")
        if status not in ("FILLED", "PARTIALLY_FILLED"):
            continue

        side    = order.get("side", "")   # BUY or SELL
        ticker  = order.get("ticker") or (order.get("instrument") or {}).get("ticker", "")
        display = ticker.split("_")[0]

        filled_at   = fill.get("filledAt") or order.get("createdAt") or ""
        filled_date = filled_at[:10] if filled_at else None

        fill_price = float(fill.get("price") or 0)
        quantity   = float(fill.get("quantity") or order.get("filledQuantity") or 0)

        wallet     = fill.get("walletImpact") or {}
        realised   = float(wallet.get("realisedProfitLoss") or 0)
        fill_value = abs(float(wallet.get("netValue") or 0))  # £ value of trade

        realised_pct = round((realised / fill_value * 100) if fill_value > 0 and side == "SELL" else 0, 2)

        rows.append({
            "order_id":         str(fill.get("id") or order.get("id") or ""),
            "ticker":           ticker,
            "display":          display,
            "filled_date":      filled_date,
            "quantity":         round(quantity, 6),
            "fill_price":       round(fill_price, 4),
            "avg_cost":         0,  # not available directly
            "realised_pnl":     round(realised, 4),
            "realised_pnl_pct": realised_pct,
            "side":             side,
        })
    return rows


def process_dividends(dividends):
    """Convert T212 dividend records to dividend rows.

    T212 fields: amount, amountInEuro, grossAmountPerShare,
                 paidOn, quantity, reference, ticker, type
    """
    rows = []
    for d in dividends:
        ticker    = d.get("ticker", "")
        display   = ticker.split("_")[0]
        paid_date = (d.get("paidOn") or "")[:10] or None
        amount    = float(d.get("amount") or 0)  # account currency (£)
        rows.append({
            "reference": str(d.get("reference") or ""),
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
    if orders:
        print(f"  Sample order keys: {list(orders[0].keys())}")
        print(f"  Sample order: {json.dumps(orders[0], default=str)[:300]}")
    order_rows = process_orders(orders)
    sells = [r for r in order_rows if r["side"] == "SELL"]
    print(f"  {len(order_rows)} processed, {len(sells)} sells")
    if order_rows:
        sb_upsert("realised_pnl", order_rows, "order_id")

    # Dividends
    divs = fetch_dividends()
    print(f"  {len(divs)} dividends fetched")
    if divs:
        print(f"  Sample dividend keys: {list(divs[0].keys())}")
        print(f"  Sample dividend: {json.dumps(divs[0], default=str)[:300]}")
    div_rows = process_dividends(divs)
    if div_rows:
        sb_upsert("dividends", div_rows, "reference")

    # Transactions (deposits/withdrawals) — log only, used for context
    txns = fetch_transactions()
    print(f"  {len(txns)} transactions fetched")
    if txns:
        print(f"  Sample transaction: {json.dumps(txns[0], default=str)[:300]}")
    deposits    = sum(float(t.get("amount",0)) for t in txns if float(t.get("amount",0)) > 0)
    withdrawals = sum(float(t.get("amount",0)) for t in txns if float(t.get("amount",0)) < 0)
    print(f"  Deposits: £{deposits:.2f}  Withdrawals: £{withdrawals:.2f}")

    # Summary
    total_realised = sum(r["realised_pnl"] for r in order_rows if r["side"] == "SELL")
    total_divs     = sum(r["amount"] for r in div_rows)
    print(f"  Total realised P&L: £{total_realised:.2f}")
    print(f"  Total dividends:    £{total_divs:.2f}")
    print(f"[history_service] Done.")


if __name__ == "__main__":
    run()
