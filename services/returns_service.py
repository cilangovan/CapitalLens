#!/usr/bin/env python3
"""
Returns Service — your real returns, rebuilt from Trading 212 money flows.

Sources (all synced from Trading 212 by t212_sync_service):
  t212_transactions  deposits / withdrawals (money you put in or took out) + interest on cash, fees
  t212_orders        every buy and sell (£ impact, realised P&L)
  t212_dividends     every dividend (£)
  pie_history        '__ALL__' row: value of everything you held, day by day (pie_history_service)
  portfolio_snapshots  latest Trading 212 account totals (today's value)

How:
  cash(day)    = deposits − withdrawals − buys + sells + dividends + interest/fees, replayed in date order
                 (reconciles to Trading 212's free + reserved + pie cash)
  value(day)   = holdings(day) + cash(day); today = Trading 212's own account total
  profit       = value − net money put in (deposits − withdrawals)
  XIRR         = money-weighted yearly rate: counts when each deposit/withdrawal happened
  time-weighted return = how the investments performed, ignoring deposit timing (daily-linked)

Writes one returns_summary row: xirr_pct, annualised_pct (= XIRR), total_return_pct (profit ÷ net put in),
yearly/monthly breakdowns, and `details` (everything the Returns page shows).

Run via: python -m services.returns_service
"""

import os
import json
import math
import urllib.request
import urllib.error
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, date, timedelta

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]


def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(data, allow_nan=False).encode() if data is not None else None,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path[:70]} → {e.code}: {e.read().decode()[:300]}")
        return None


def sb_all(path, page=1000):
    out, off = [], 0
    while True:
        rows = sb("GET", f"{path}&limit={page}&offset={off}") or []
        out += rows
        if len(rows) < page:
            return out
        off += page


def r2(v):
    return None if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else round(float(v), 2)


def pct(v):
    return None if v is None else round(v * 100, 2)


def xirr(flows):
    """flows: [(date, amount)] — negative = money in, positive = money out/terminal value. Bisection (robust)."""
    flows = [(d, a) for d, a in flows if abs(a) > 1e-9]
    if len(flows) < 2 or not any(a < 0 for _, a in flows) or not any(a > 0 for _, a in flows):
        return None
    d0 = min(d for d, _ in flows)
    def npv(r):
        return sum(a / (1 + r) ** ((d - d0).days / 365.0) for d, a in flows)
    lo, hi = -0.99, 10.0
    flo, fhi = npv(lo), npv(hi)
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fm = npv(mid)
        if abs(fm) < 1e-7:
            break
        if flo * fm < 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def day(s):
    return date.fromisoformat(s[:10])


def run():
    print(f"[returns] {datetime.now(timezone.utc).isoformat()}")
    snap = (sb("GET", "portfolio_snapshots?select=total_value,cash,raw&order=id.desc&limit=1") or [None])[0]
    if not snap:
        print("  no snapshot"); return
    acc = (snap.get("raw") or {}).get("account") or {}
    live_total = float(acc.get("total") or snap.get("total_value") or 0)
    live_cash = float(acc.get("free") or snap.get("cash") or 0) + float(acc.get("blocked") or 0) + float(acc.get("pieCash") or 0)
    unrealised = float(acc.get("ppl") or 0)

    txns = sb_all("t212_transactions?select=type,amount,date_time&order=date_time.asc")
    divs = sb_all("t212_dividends?select=amount,paid_on&order=paid_on.asc")
    orders = sb_all("t212_orders?select=side,net_value,realised_pnl,filled_at&status=in.(FILLED,PARTIALLY_FILLED)&order=filled_at.asc")
    hist = (sb("GET", "pie_history?pie=eq.__ALL__&select=series") or [None])[0]
    if not txns:
        print("  no Trading 212 transactions synced yet — run the T212 sync first"); return

    # ── daily money flows ────────────────────────────────────────────────────
    ext = defaultdict(float)          # money you put in (+) / took out (−)
    cashd = defaultdict(float)        # every movement of cash inside the account
    dep = defaultdict(float); wdr = defaultdict(float); intr = defaultdict(float); other = defaultdict(float)
    divd = defaultdict(float); real = defaultdict(float); buys = defaultdict(float); sells = defaultdict(float)
    for t in txns:
        if not t.get("date_time") or t.get("amount") is None:
            continue
        d, a, ty = day(t["date_time"]), float(t["amount"]), (t.get("type") or "").upper()
        cashd[d] += a
        if ty == "DEPOSIT":
            ext[d] += a; dep[d] += a
        elif ty in ("WITHDRAW", "WITHDRAWAL"):
            ext[d] += a; wdr[d] += a
        elif "INTEREST" in ty:
            intr[d] += a
        else:
            other[d] += a                  # fees, transfers, adjustments
    for x in divs:
        if x.get("paid_on") and x.get("amount") is not None:
            d = day(x["paid_on"]); cashd[d] += float(x["amount"]); divd[d] += float(x["amount"])
    for o in orders:
        if not o.get("filled_at"):
            continue
        d, v = day(o["filled_at"]), abs(float(o.get("net_value") or 0))
        if o["side"] == "BUY":
            cashd[d] -= v; buys[d] += v
        else:
            cashd[d] += v; sells[d] += v
        if o.get("realised_pnl") is not None:
            real[d] += float(o["realised_pnl"])

    today = date.today()
    start = min(min(ext), min(cashd))
    days = [start + timedelta(n) for n in range((today - start).days + 1)]

    # holdings value per day (business days in pie_history → carried over weekends/holidays)
    hv = {}
    if hist:
        s = hist["series"]
        for d, v in zip(s.get("dates") or [], s.get("value") or []):
            if v is not None:
                hv[date.fromisoformat(d)] = float(v)

    V, C, H, F, netin = [], [], [], [], []
    c = h = n = 0.0
    for d in days:
        c += cashd.get(d, 0.0)
        if d in hv:
            h = hv[d]
        n += ext.get(d, 0.0)
        C.append(c); H.append(h); F.append(ext.get(d, 0.0)); netin.append(n); V.append(h + c)
    cash_gap = C[-1] - live_cash
    rebuilt_total = V[-1]
    V[-1] = live_total                                 # today: Trading 212's own account total
    print(f"  cash replay £{C[-1]:.2f} vs Trading 212 £{live_cash:.2f} (diff £{cash_gap:.2f}); "
          f"rebuilt account £{rebuilt_total:.2f} vs live £{live_total:.2f}")

    # time-weighted daily returns (deposits land at the start of the day)
    R = [0.0]
    for i in range(1, len(days)):
        base = V[i - 1] + F[i]
        R.append(V[i] / base - 1 if base > 1 else 0.0)

    def idx(d):
        return max(0, min(len(days) - 1, (d - start).days))

    def period(d0, d1, label):
        """profit and returns between the end of d0 (exclusive) and d1 (inclusive)."""
        i0, i1 = (idx(d0) if d0 >= start else -1), idx(d1)
        v0 = V[i0] if i0 >= 0 else 0.0
        flows = sum(F[i0 + 1:i1 + 1])
        profit = V[i1] - v0 - flows
        g = 1.0
        for r in R[i0 + 1:i1 + 1]:
            g *= 1 + r
        avg_cap = v0 + sum(F[i] * (i1 - i) / max(i1 - i0, 1) for i in range(i0 + 1, i1 + 1))   # Modified Dietz base
        return {"label": label, "from": (d0 + timedelta(1)).isoformat() if i0 >= 0 else start.isoformat(), "to": d1.isoformat(),
                "start_value": r2(v0), "end_value": r2(V[i1]), "net_added": r2(flows), "profit": r2(profit),
                "twr_pct": pct(g - 1), "dietz_pct": pct(profit / avg_cap) if avg_cap > 1 else None}

    def ago(**k):
        return today - timedelta(**k)

    ytd0 = date(today.year, 1, 1) - timedelta(1)
    periods = [period(ago(days=7), today, "1W"), period(ago(days=30), today, "1M"), period(ago(days=91), today, "3M"),
               period(ytd0, today, "YTD"), period(ago(days=365), today, "1Y"), period(start - timedelta(1), today, "All")]

    total_profit = V[-1] - netin[-1]
    years_held = max((today - start).days / 365.25, 1e-9)
    twr_all = math.prod(1 + r for r in R) - 1
    twr_ann = (1 + twr_all) ** (1 / years_held) - 1 if years_held >= 1 else None
    flows = [(d, -a) for d, a in sorted(ext.items())] + [(today, V[-1])]
    x = xirr(flows)

    def sum_in(m, d0, d1):
        return sum(v for d, v in m.items() if d0 <= d <= d1)

    yearly, monthly = {}, {}
    for y in range(start.year, today.year + 1):
        a, b = date(y, 1, 1), min(date(y, 12, 31), today)
        p = period(a - timedelta(1), b, str(y))
        p.update({"deposited": r2(sum_in(dep, a, b)), "withdrawn": r2(-sum_in(wdr, a, b)), "realised": r2(sum_in(real, a, b)),
                  "dividends": r2(sum_in(divd, a, b)), "interest": r2(sum_in(intr, a, b))})
        yearly[str(y)] = p
    m = date(today.year, today.month, 1)
    for _ in range(24):
        if m < date(start.year, start.month, 1):
            break
        nxt = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
        p = period(m - timedelta(1), min(nxt - timedelta(1), today), m.strftime("%Y-%m"))
        monthly[m.strftime("%Y-%m")] = p
        m = date(m.year - (m.month == 1), (m.month - 2) % 12 + 1, 1)

    # value vs money put in — weekly points (+ today) for the chart
    series = {"dates": [], "value": [], "net_in": []}
    for i, d in enumerate(days):
        if i % 7 == 0 or i == len(days) - 1:
            series["dates"].append(d.isoformat()); series["value"].append(r2(V[i])); series["net_in"].append(r2(netin[i]))

    realised = sum(real.values()); dividends = sum(divd.values()); interest = sum(intr.values()); others = sum(other.values())
    explained = unrealised + realised + dividends + interest + others
    details = {
        "as_of": datetime.now(timezone.utc).isoformat(), "since": start.isoformat(), "years": round(years_held, 2),
        "account_value": r2(V[-1]), "holdings_value": r2(V[-1] - live_cash), "cash": r2(live_cash),
        "money_in": {"deposited": r2(sum(dep.values())), "withdrawn": r2(-sum(wdr.values())), "net": r2(netin[-1]),
                     "deposits": sum(1 for v in dep.values() if v), "first": start.isoformat()},
        "profit": {"total": r2(total_profit), "pct_of_net_in": pct(total_profit / netin[-1]) if netin[-1] > 0 else None,
                   "unrealised": r2(unrealised), "realised": r2(realised), "dividends": r2(dividends), "interest": r2(interest),
                   "other": r2(others), "costs": r2(total_profit - explained)},
        "xirr_pct": pct(x), "twr_pct": pct(twr_all), "twr_annual_pct": pct(twr_ann),
        "periods": periods, "series": series,
        "check": {"cash_rebuilt": r2(C[-1]), "cash_t212": r2(live_cash), "account_rebuilt": r2(rebuilt_total), "account_t212": r2(live_total)},
    }
    row = {"xirr_pct": pct(x), "annualised_pct": pct(x), "total_return_pct": details["profit"]["pct_of_net_in"],
           "yearly_breakdown": yearly, "monthly_breakdown": monthly, "details": details,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    if sb("POST", "returns_summary", [row]) is None:
        raise SystemExit("could not save returns_summary")
    sb("DELETE", f"returns_summary?updated_at=lt.{urllib.parse.quote(row['updated_at'])}")
    print(f"  net put in £{netin[-1]:.2f} · value £{V[-1]:.2f} · profit £{total_profit:.2f} ({details['profit']['pct_of_net_in']}%)")
    print(f"  XIRR {pct(x)}%/yr · time-weighted {pct(twr_all)}% total, {pct(twr_ann)}%/yr · since {start}")
    print(f"  breakdown: unrealised £{unrealised:.2f} · realised £{realised:.2f} · dividends £{dividends:.2f} · "
          f"interest £{interest:.2f} · other £{others:.2f} · costs £{total_profit - explained:.2f}")
    for p in periods:
        print(f"    {p['label']:<4} profit £{p['profit']} · TWR {p['twr_pct']}% · net added £{p['net_added']}")
    print("[returns] done")


if __name__ == "__main__":
    run()
