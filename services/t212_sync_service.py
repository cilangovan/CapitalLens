#!/usr/bin/env python3
"""
T212 Sync — pulls your complete Trading 212 history into Supabase, losslessly.

Endpoints (Trading 212 Public API v0, rate limit 6 requests / minute each):
  /api/v0/equity/history/orders   → t212_orders        (every fill: date, qty, price, £ impact, realised P&L)
  /api/v0/history/dividends       → t212_dividends
  /api/v0/history/transactions    → t212_transactions  (deposits, withdrawals, fees)

Rules:
  • Raw JSON is stored exactly as received; rows are never deleted (append-only, `last_seen` refreshed).
  • Pagination follows T212's own `nextPagePath` (limit 50). The API ignores from/to date filters,
    so there is no date windowing.
  • Rate limits are respected (≈10.5 s between calls); a 429 waits and retries — a run never silently
    truncates. If retries run out, the run fails loudly and the next run resumes.
  • Incremental: stops once a whole page is already stored, unless FULL=1 (or no successful full sync yet).
  • Derived tables realised_pnl and dividends are rebuilt from the raw rows.

Run via: python -m services.t212_sync_service     (FULL=1 to re-walk everything)
"""

import os
import sys
import json
import time
import base64
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone

T212_BASE    = "https://live.trading212.com"
CREDS        = base64.b64encode(f"{os.environ['T212_API_KEY']}:{os.environ['T212_API_SECRET']}".encode()).decode()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
PACE_S       = 10.5          # 6 req/min
MAX_RETRIES  = 6
FORCE_FULL   = os.environ.get("FULL") == "1"
NOW          = lambda: datetime.now(timezone.utc).isoformat()

_last_call = [0.0]


def t212(path):
    """GET with pacing + 429/5xx retry. Returns parsed JSON or raises."""
    url = path if path.startswith("http") else f"{T212_BASE}{path}"
    for attempt in range(MAX_RETRIES):
        wait = PACE_S - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {CREDS}", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if e.code == 429 or e.code >= 500:
                reset = e.headers.get("x-ratelimit-reset")
                pause = max(15, min(90, (int(reset) - time.time()) if reset and reset.isdigit() else 60))
                print(f"    {e.code} — waiting {pause:.0f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(pause)
                continue
            raise RuntimeError(f"T212 {path} → {e.code}: {body}")
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"    network error {e} — retrying in 30s")
            time.sleep(30)
    raise RuntimeError(f"T212 {path}: gave up after {MAX_RETRIES} retries")


def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(data, default=str).encode() if data is not None else None,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else True


def sb_all(path, page=1000):
    """GET every row (PostgREST caps a response at 1000 rows)."""
    out, off = [], 0
    sep = "&" if "?" in path else "?"
    while True:
        rows = sb("GET", f"{path}{sep}limit={page}&offset={off}") or []
        out += rows
        if len(rows) < page:
            return out
        off += page


def count_rows(table):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{table}?select=*", method="HEAD",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Prefer": "count=exact"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int((r.headers.get("Content-Range") or "*/0").split("/")[-1])


def upsert(table, rows, key):
    rows = list({r[key]: r for r in rows}.values())
    for i in range(0, len(rows), 500):
        sb("POST", f"{table}?on_conflict={key}", rows[i:i + 500], prefer="resolution=merge-duplicates,return=minimal")


def existing_keys(table, key, keys):
    found = set()
    keys = list(keys)
    for i in range(0, len(keys), 100):
        q = ",".join(urllib.parse.quote(f'"{k}"', safe="") for k in keys[i:i + 100])
        for r in sb("GET", f"{table}?select={key}&{key}=in.({q})") or []:
            found.add(r[key])
    return found


def f(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# ── mappers: keep raw, extract the fields we query on ─────────────────────────
def map_order(it):
    fill, order = it.get("fill") or {}, it.get("order") or {}
    wi = fill.get("walletImpact") or {}
    oid = str(order.get("id") or "")
    return {
        "id": str(fill["id"]) if fill.get("id") is not None else f"order:{oid}",
        "order_id": oid,
        "ticker": order.get("ticker") or (order.get("instrument") or {}).get("ticker"),
        "side": order.get("side"), "status": order.get("status"),
        "filled_at": fill.get("filledAt") or order.get("createdAt"),
        "quantity": f(fill.get("quantity") if fill else order.get("filledQuantity")),
        "price": f(fill.get("price")),
        "net_value": f(wi.get("netValue")), "realised_pnl": f(wi.get("realisedProfitLoss")),
        "fx_rate": f(wi.get("fxRate")),
        "raw": it, "last_seen": NOW(),
    }


def map_dividend(it):
    return {"reference": str(it.get("reference")), "ticker": it.get("ticker"), "paid_on": it.get("paidOn"),
            "amount": f(it.get("amount")), "quantity": f(it.get("quantity")), "type": it.get("type"),
            "raw": it, "last_seen": NOW()}


def map_txn(it):
    return {"reference": str(it.get("reference")), "type": it.get("type"), "amount": f(it.get("amount")),
            "date_time": it.get("dateTime"), "raw": it, "last_seen": NOW()}


ENDPOINTS = [
    ("orders",       "/api/v0/equity/history/orders?limit=50", "t212_orders",       "id",        map_order),
    ("dividends",    "/api/v0/history/dividends?limit=50",     "t212_dividends",    "reference", map_dividend),
    ("transactions", "/api/v0/history/transactions?limit=50",  "t212_transactions", "reference", map_txn),
]


def sync(name, path, table, key, mapper):
    state = (sb("GET", f"t212_sync_state?endpoint=eq.{name}&select=*") or [{}])
    state = state[0] if state else {}
    full = FORCE_FULL or not state.get("last_full")
    print(f"\n[{name}] {'FULL walk' if full else 'incremental'}")
    nxt, pages, new, seen = path, 0, 0, 0
    while nxt:
        resp = t212(nxt)
        items = resp.get("items", []) if isinstance(resp, dict) else (resp or [])
        rows = [mapper(it) for it in items]
        rows = [r for r in rows if r[key] not in (None, "None", "")]
        known = existing_keys(table, key, [r[key] for r in rows]) if rows else set()
        for r in rows:          # keep first_seen for rows we already had
            if r[key] not in known:
                r["first_seen"] = NOW()
        upsert(table, rows, key)
        pages += 1; seen += len(rows); new += len(rows) - len(known)
        print(f"  page {pages}: {len(rows)} items, {len(rows) - len(known)} new")
        if not full and rows and len(known) == len(rows):
            print("  reached already-stored history — stopping")
            break
        nxt = resp.get("nextPagePath") if isinstance(resp, dict) else None
    total = count_rows(table)
    upd = {"endpoint": name, "last_run": NOW(), "items_total": total, "status": "ok",
           "detail": f"{pages} pages, {seen} items read, {new} new"}
    if full:
        upd["last_full"] = NOW()
    upsert("t212_sync_state", [upd], "endpoint")
    print(f"  ✓ {name}: {new} new · {total} stored in total")
    return new


def rebuild_derived():
    """realised_pnl and dividends (used by the dashboard) from the complete raw tables."""
    orders = sb_all("t212_orders?select=id,ticker,side,status,filled_at,quantity,price,net_value,realised_pnl&order=filled_at,id")
    rows = []
    for o in orders:
        if o["status"] not in ("FILLED", "PARTIALLY_FILLED") or not o["ticker"]:
            continue
        nv, rp = abs(o["net_value"] or 0), o["realised_pnl"] or 0
        rows.append({"order_id": o["id"], "ticker": o["ticker"], "display": o["ticker"].split("_")[0],
                     "filled_date": (o["filled_at"] or "")[:10] or None, "quantity": round(o["quantity"] or 0, 6),
                     "fill_price": round(o["price"] or 0, 4), "avg_cost": 0, "realised_pnl": round(rp, 4),
                     "realised_pnl_pct": round(rp / nv * 100, 2) if nv and o["side"] == "SELL" else 0,
                     "side": o["side"]})
    upsert("realised_pnl", rows, "order_id")
    divs = sb_all("t212_dividends?select=reference,ticker,paid_on,amount&order=reference")
    upsert("dividends", [{"reference": d["reference"], "ticker": d["ticker"], "display": (d["ticker"] or "").split("_")[0],
                          "paid_date": (d["paid_on"] or "")[:10] or None, "amount": round(d["amount"] or 0, 4)} for d in divs],
           "reference")
    print(f"\n[derived] realised_pnl {len(rows)} fills · dividends {len(divs)}")


def run():
    print(f"[t212_sync] {NOW()}  (pace {PACE_S}s/request)")
    failed = []
    for ep in ENDPOINTS:
        try:
            sync(*ep)
        except Exception as e:
            failed.append(ep[0])
            print(f"  ✗ {ep[0]}: {e}")
            try:
                upsert("t212_sync_state", [{"endpoint": ep[0], "last_run": NOW(), "status": "error", "detail": str(e)[:300]}], "endpoint")
            except Exception:
                pass
    rebuild_derived()
    if failed:
        sys.exit(f"sync incomplete for: {', '.join(failed)} — stored pages are kept; next run resumes")
    print("[t212_sync] done")


if __name__ == "__main__":
    run()
