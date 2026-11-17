#!/usr/bin/env python3
"""
Pie History Service — your real day-by-day holdings, value and profit, rebuilt from Trading 212 trades.

Source of truth: t212_orders (every fill synced from Trading 212 — see t212_sync_service).
  1. Replay fills in order → exact quantity held of every instrument on every day
     (fill quantities are converted to today's share basis across stock splits).
  2. Net invested (£) per day = Σ buy amounts − Σ sell proceeds (T212 walletImpact.netValue, already in £).
  3. Value (£) per day = quantity × that day's close (Yahoo Finance), converted with that day's FX rate
     (sub-units like GBX pence handled).
  4. Profit (£) = value − net invested. It includes realised gains and is unaffected by deposits.
  5. Verify against live Trading 212: rebuilt quantity and value today must match each holding;
     mismatches are recorded in `verification` and shown on the dashboard.

Writes pie_history rows: one per current pie, '__ALL__' (whole account incl. sold holdings) and
'__SOLD__' (instruments no longer held). Intraday (1D) comes from portfolio snapshots on the dashboard.

Run via: python -m services.pie_history_service
"""

import os
import json
import math
import urllib.request
import urllib.error
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone, date

import pandas as pd
import yfinance as yf

from services.value_buy_service import t212_to_yahoo

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
SUBUNIT = {"GBX": ("GBP", 0.01), "GBp": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}
QTY_TOL, VALUE_TOL = 0.005, 0.06        # 0.5% quantity, 6% value (close vs live price) before flagging


def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(data, default=float).encode() if data is not None else None,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
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


def exchange_of(t):
    if t.endswith("_US_EQ"): return "NASDAQ/NYSE"
    if t.endswith("l_EQ"):   return "LSE"
    if t.endswith("d_EQ"):   return "XETRA"
    if t.endswith("a_EQ"):   return "AMS"
    return ""


def r2(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), 2)


def run():
    print(f"[pie_history] {datetime.now(timezone.utc).isoformat()}")
    snap = (sb("GET", "portfolio_snapshots?select=id,raw&order=id.desc&limit=1") or [None])[0]
    if not snap:
        print("  no snapshot"); return
    raw = snap.get("raw") or {}
    live_pos = {p["ticker"]: p for p in (sb("GET", f"positions?snapshot_id=eq.{snap['id']}&select=ticker,exchange,quantity") or [])}

    # live T212 numbers per holding and pie membership (pies own the instruments)
    live, pie_of, pie_live = {}, {}, {}
    for p in raw.get("pies") or []:
        tv = ti = tr = 0.0
        for inst in p.get("instruments") or []:
            r = inst.get("result") or {}
            v, i, res = (float(r.get(k) or 0) for k in ("priceAvgValue", "priceAvgInvestedValue", "priceAvgResult"))
            if v <= 0 and float(inst.get("qty") or 0) <= 0:
                continue
            live[inst["ticker"]] = {"value": v, "invested": i, "result": res, "qty": float(inst.get("qty") or 0)}
            pie_of[inst["ticker"]] = p["name"]
            tv += v; ti += i; tr += res
        if tv > 0:
            pie_live[p["name"]] = {"value": round(tv, 2), "invested": round(ti, 2), "result": round(tr, 2)}

    fills = sb_all("t212_orders?select=ticker,side,status,filled_at,quantity,net_value&status=in.(FILLED,PARTIALLY_FILLED)&order=filled_at.asc,id.asc")
    fills = [f for f in fills if f["ticker"] and f["filled_at"] and (f["quantity"] or 0) > 0]
    if not fills:
        print("  no fills synced yet — run the T212 sync first"); return
    tickers = sorted({f["ticker"] for f in fills} | set(live))
    first_day = min(f["filled_at"][:10] for f in fills)
    print(f"  {len(fills)} fills, {len(tickers)} instruments, since {first_day}")

    ccy_of = {r["ticker"]: r["currency"] for r in sb_all(
        "instruments?select=ticker,currency&ticker=in.(" + ",".join(urllib.parse.quote(f'"{t}"', safe="") for t in tickers) + ")")}
    sym_of = {t: t212_to_yahoo(t, (live_pos.get(t) or {}).get("exchange") or exchange_of(t))[0] for t in tickers}

    # prices + splits
    syms = sorted(set(sym_of.values()))
    px = yf.download(syms, start=first_day, interval="1d", auto_adjust=False, actions=True, progress=False,
                     group_by="ticker", threads=True)
    days = pd.bdate_range(first_day, date.today()).date
    dkeys = [d.isoformat() for d in days]

    fx_cache = {}
    def fx(ccy):           # Series: units of ccy per £, indexed by day (ffilled)
        if ccy == "GBP": return None
        if ccy not in fx_cache:
            try:
                h = yf.Ticker(f"GBP{ccy}=X").history(start=first_day, interval="1d")["Close"].dropna()
                h.index = h.index.date
                fx_cache[ccy] = h.reindex(days).ffill().bfill()
            except Exception:
                fx_cache[ccy] = None
        return fx_cache[ccy]

    by_t = defaultdict(list)
    for f in fills:
        by_t[f["ticker"]].append(f)

    T, excluded, verification = {}, [], []
    for t in tickers:
        sym = sym_of[t]
        try:
            frame = px[sym] if len(syms) > 1 else px
            closes = frame["Close"].dropna()
            splits = frame["Stock Splits"] if "Stock Splits" in frame else pd.Series(dtype=float)
        except Exception:
            closes, splits = pd.Series(dtype=float), pd.Series(dtype=float)
        splits = splits[splits > 0] if len(splits) else splits
        split_list = [(i.date(), float(v)) for i, v in splits.items()]
        # daily qty (today's share basis) and net invested
        dq, di = defaultdict(float), defaultdict(float)
        for f in by_t.get(t, []):
            d = f["filled_at"][:10]
            factor = 1.0
            for sd, ratio in split_list:
                if sd.isoformat() > d:
                    factor *= ratio
            sign = 1 if f["side"] == "BUY" else -1
            dq[d] += sign * float(f["quantity"]) * factor
            di[d] += sign * abs(float(f["net_value"] or 0))
        qty, inv, q, iv = [], [], 0.0, 0.0
        for k in dkeys:
            q += dq.get(k, 0.0); iv += di.get(k, 0.0)
            qty.append(q if abs(q) > 1e-9 else 0.0); inv.append(iv)
        q_ccy = ccy_of.get(t) or (raw.get("instrument_meta") or {}).get(t, {}).get("ccy") or "GBP"
        ccy, unit = SUBUNIT.get(q_ccy, (q_ccy, 1.0))
        if closes.empty:
            if any(qty):
                excluded.append({"ticker": t, "reason": f"no price history for {sym}"})
            T[t] = {"qty": qty, "invested": inv, "value": None}
            continue
        c = closes.copy(); c.index = c.index.date
        c = c.reindex(days).ffill()
        fxs = fx(ccy)
        if fxs is None and ccy != "GBP":
            excluded.append({"ticker": t, "reason": f"no FX history for {ccy}"})
            T[t] = {"qty": qty, "invested": inv, "value": None}
            continue
        vals = []
        for i, k in enumerate(dkeys):
            p = c.iloc[i]
            if qty[i] == 0: vals.append(0.0); continue
            if pd.isna(p): vals.append(None); continue
            v = qty[i] * float(p) * unit
            if fxs is not None:
                v /= float(fxs.iloc[i])
            vals.append(v)
        # Yahoo sometimes quotes London lines in £ while T212 uses pence (or vice versa): calibrate by 100×
        if t in live and live[t]["value"] > 0 and vals[-1]:
            for k in (1, 100, 0.01):
                if abs(vals[-1] * k / live[t]["value"] - 1) <= VALUE_TOL * 2:
                    if k != 1:
                        vals = [v * k if v is not None else None for v in vals]
                    break
        T[t] = {"qty": qty, "invested": inv, "value": vals}

        # verification vs live T212
        if t in live:
            lq, rq = live[t]["qty"], qty[-1]
            lv, rv = live[t]["value"], vals[-1] or 0
            ok_q = (abs(rq / lq - 1) <= QTY_TOL) if lq > 0 else (abs(rq) < 1e-6)
            ok_v = (abs(rv / lv - 1) <= VALUE_TOL) if lv > 0 else True
            verification.append({"ticker": t, "qty_rebuilt": round(rq, 6), "qty_t212": round(lq, 6),
                                 "value_rebuilt": r2(rv), "value_t212": r2(lv), "ok": bool(ok_q and ok_v),
                                 "issue": None if ok_q and ok_v else ("quantity differs" if not ok_q else "value differs")})
        elif abs(qty[-1]) > 1e-6:
            verification.append({"ticker": t, "qty_rebuilt": round(qty[-1], 6), "qty_t212": 0, "ok": False,
                                 "issue": "rebuilt as still held, but not in your T212 portfolio"})

    def series(name, members, live_now, per_ticker=True):
        vals, invs, profs = [], [], []
        for i in range(len(dkeys)):
            v = iv = 0.0; ok = True
            for t in members:
                tv = T[t]["value"]
                iv += T[t]["invested"][i]
                if tv is None:
                    if T[t]["qty"][i]: ok = False
                    continue
                if tv[i] is None: ok = False
                else: v += tv[i]
            vals.append(r2(v) if ok else None); invs.append(r2(iv)); profs.append(r2(v - iv) if ok else None)
        # trim leading days before the first holding in this group
        start = next((i for i, v in enumerate(vals) if (v or 0) > 0 or invs[i]), len(vals) - 1)
        s = {"source": "orders", "dates": dkeys[start:], "value": vals[start:], "invested": invs[start:],
             "profit": profs[start:], "current": live_now,
             "verification": [x for x in verification if x["ticker"] in members],
             "excluded": [x for x in excluded if x["ticker"] in members]}
        if per_ticker:
            s["tickers"] = {t: {"qty": [round(x, 6) for x in T[t]["qty"][start:]],
                                "value": [r2(x) for x in T[t]["value"][start:]] if T[t]["value"] else None,
                                "invested": [r2(x) for x in T[t]["invested"][start:]]} for t in members}
        return s

    rows = []
    for pie, cur in pie_live.items():
        members = [t for t in tickers if pie_of.get(t) == pie]
        rows.append({"pie": pie, "series": series(pie, members, cur)})
    sold = [t for t in tickers if t not in pie_of]
    if sold:
        rows.append({"pie": "__SOLD__", "series": series("__SOLD__", sold, None)})
    tot = {k: round(sum(c[k] for c in pie_live.values()), 2) for k in ("value", "invested", "result")}
    rows.append({"pie": "__ALL__", "series": series("__ALL__", tickers, tot, per_ticker=False)})

    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["updated_at"] = now
    sb("POST", "pie_history?on_conflict=pie", rows, prefer="resolution=merge-duplicates,return=minimal")
    keep = ",".join(f'"{r["pie"]}"' for r in rows)
    sb("DELETE", f"pie_history?pie=not.in.({urllib.parse.quote(keep, safe=',()')})")   # derived rows for pies you no longer have

    bad = [v for v in verification if not v["ok"]]
    print(f"  verification: {len(verification) - len(bad)}/{len(verification)} holdings match Trading 212")
    for v in bad:
        print(f"    ✗ {v['ticker']}: {v['issue']} (rebuilt qty {v['qty_rebuilt']} vs T212 {v['qty_t212']}, "
              f"£{v.get('value_rebuilt')} vs £{v.get('value_t212')})")
    for e in excluded:
        print(f"    ✗ {e['ticker']}: {e['reason']}")
    for r in rows:
        s = r["series"]
        last = next((v for v in reversed(s["value"]) if v is not None), None)
        print(f"  ✓ {r['pie']:<18} {len(s['dates'])} days · rebuilt value today £{last} · live £{(s['current'] or {}).get('value')}")
    print("[pie_history] done")


if __name__ == "__main__":
    run()
