#!/usr/bin/env python3
"""
Pie History Service — your real day-by-day holdings, value and profit, rebuilt from Trading 212 trades.

Source of truth: t212_orders (every fill synced from Trading 212 — see t212_sync_service).
  1. Replay fills in order → exact quantity held of every instrument on every day
     (T212 stores SELL quantities as negative numbers; fills are converted to today's share basis
     across stock splits).
  2. Split by channel: order.initiatedFrom = AUTOINVEST → pie; anything else (app, system) → direct holding.
     If shares were moved between a pie and direct holdings (no order is recorded for that), the split
     can't be replayed — that instrument's daily pie/direct split uses today's proportion and is flagged.
  3. Net invested (£) per day = Σ buy amounts − Σ sell proceeds (T212 walletImpact.netValue, already £).
  4. Value (£) per day = quantity × that day's close (Yahoo Finance) × FX (sub-units like GBX pence handled),
     calibrated to T212's own price per share today. Delisted instruments with no prices: valued at cost.
  5. Profit (£) = value − net invested (includes realised gains; deposits don't distort it).
  6. Verification against live Trading 212: account quantity per instrument, and whether the pie/direct
     split replays exactly.

Writes pie_history rows: one per current pie, '__DIRECT__' (holdings outside pies), '__ALL__' (whole
account), '__SOLD__' (instruments no longer held). Intraday (1D) comes from snapshots on the dashboard.

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
QTY_EPS = 1e-4


def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(data, default=float, allow_nan=False).encode() if data is not None else None,
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
    return None if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else round(float(v), 2)


def run():
    print(f"[pie_history] {datetime.now(timezone.utc).isoformat()}")
    snap = (sb("GET", "portfolio_snapshots?select=id,raw,total_value,cash,total_ppl&order=id.desc&limit=1") or [None])[0]
    if not snap:
        print("  no snapshot"); return
    raw = snap.get("raw") or {}
    positions = {p["ticker"]: p for p in (sb("GET", f"positions?snapshot_id=eq.{snap['id']}&select=ticker,exchange,quantity") or [])}

    # live T212: per-pie instrument numbers and pie membership
    pie_inst, pie_of, pie_live = {}, {}, {}
    for p in raw.get("pies") or []:
        tv = ti = tr = 0.0
        for inst in p.get("instruments") or []:
            r = inst.get("result") or {}
            v, i, res = (float(r.get(k) or 0) for k in ("priceAvgValue", "priceAvgInvestedValue", "priceAvgResult"))
            q = float(inst.get("qty") or 0)
            if v <= 0 and q <= 0:
                continue
            pie_inst[inst["ticker"]] = {"value": v, "invested": i, "result": res, "qty": q, "pie": p["name"]}
            pie_of[inst["ticker"]] = p["name"]
            tv += v; ti += i; tr += res
        if tv > 0:
            pie_live[p["name"]] = {"value": round(tv, 2), "invested": round(ti, 2), "result": round(tr, 2)}

    fills = sb_all("t212_orders?select=ticker,side,status,filled_at,quantity,net_value,channel:raw->order->>initiatedFrom"
                   "&status=in.(FILLED,PARTIALLY_FILLED)&order=filled_at.asc,id.asc")
    # T212 records SELL quantities as negative numbers — keep every non-zero fill; the side decides the sign
    fills = [f for f in fills if f["ticker"] and f["filled_at"] and float(f["quantity"] or 0) != 0]
    if not fills:
        print("  no fills synced yet — run the T212 sync first"); return
    tickers = sorted({f["ticker"] for f in fills} | set(positions))
    first_day = min(f["filled_at"][:10] for f in fills)
    print(f"  {len(fills)} fills, {len(tickers)} instruments, since {first_day}")

    ccy_of = {r["ticker"]: r["currency"] for r in sb_all(
        "instruments?select=ticker,currency&ticker=in.(" + ",".join(urllib.parse.quote(f'"{t}"', safe="") for t in tickers) + ")")}
    sym_of = {t: t212_to_yahoo(t, (positions.get(t) or {}).get("exchange") or exchange_of(t))[0] for t in tickers}
    syms = sorted(set(sym_of.values()))
    px = yf.download(syms, start=first_day, interval="1d", auto_adjust=False, actions=True, progress=False,
                     group_by="ticker", threads=True)
    days = pd.bdate_range(first_day, date.today()).date
    dkeys = [d.isoformat() for d in days]
    N = len(dkeys)

    fx_cache = {}
    def fx(ccy):           # Series: units of ccy per £, by day (ffilled)
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

    def cumulate(daily):
        out, acc = [], 0.0
        for k in dkeys:
            acc += daily.get(k, 0.0); out.append(acc if abs(acc) > 1e-9 else 0.0)
        return out

    T, excluded, verification = {}, [], []
    for t in tickers:
        sym = sym_of[t]
        try:
            frame = px[sym] if len(syms) > 1 else px
            closes = frame["Close"].dropna()
            splits = frame["Stock Splits"] if "Stock Splits" in frame else pd.Series(dtype=float)
        except Exception:
            closes, splits = pd.Series(dtype=float), pd.Series(dtype=float)
        split_list = [(i.date().isoformat(), float(v)) for i, v in splits.items() if v and v > 0] if len(splits) else []

        q = {"pie": defaultdict(float), "direct": defaultdict(float)}
        iv = {"pie": defaultdict(float), "direct": defaultdict(float)}
        for f in by_t.get(t, []):
            d = f["filled_at"][:10]
            factor = math.prod(r for sd, r in split_list if sd > d) if split_list else 1.0
            ch = "pie" if f.get("channel") == "AUTOINVEST" else "direct"
            sign = 1 if f["side"] == "BUY" else -1
            q[ch][d] += sign * abs(float(f["quantity"])) * factor
            iv[ch][d] += sign * abs(float(f["net_value"] or 0))
        qp, qd = cumulate(q["pie"]), cumulate(q["direct"])
        ip, idr = cumulate(iv["pie"]), cumulate(iv["direct"])
        qt = [a + b for a, b in zip(qp, qd)]
        it = [a + b for a, b in zip(ip, idr)]

        # live T212 quantities
        live_total = float((positions.get(t) or {}).get("quantity") or 0)
        live_pie = (pie_inst.get(t) or {}).get("qty", 0.0)
        live_dir = max(live_total - live_pie, 0.0)
        split_ok = abs(qp[-1] - live_pie) < QTY_EPS and abs(qd[-1] - live_dir) < QTY_EPS
        if not split_ok and live_total > 0:
            # shares moved between pie and direct (not an order) → apportion every day by today's split
            fp = live_pie / live_total
            qp = [x * fp for x in qt]; qd = [x * (1 - fp) for x in qt]
            ip = [x * fp for x in it]; idr = [x * (1 - fp) for x in it]

        # price per share in £ for each day
        q_ccy = ccy_of.get(t) or (raw.get("instrument_meta") or {}).get(t, {}).get("ccy") or "GBP"
        ccy, unit = SUBUNIT.get(q_ccy, (q_ccy, 1.0))
        pps = None
        if not closes.empty:
            c = closes.copy(); c.index = c.index.date
            c = c.reindex(days).ffill()
            fxs = fx(ccy)
            if fxs is not None or ccy == "GBP":
                pps = [None if pd.isna(c.iloc[i]) else float(c.iloc[i]) * unit / (float(fxs.iloc[i]) if fxs is not None else 1.0)
                       for i in range(N)]
                # calibrate to T212's own £ price per share (catches Yahoo £ vs pence lines)
                if t in pie_inst and pie_inst[t]["qty"] > 0 and pps[-1]:
                    live_pps = pie_inst[t]["value"] / pie_inst[t]["qty"]
                    for k in (1, 100, 0.01):
                        if abs(pps[-1] * k / live_pps - 1) <= 0.12:
                            if k != 1:
                                pps = [p * k if p is not None else None for p in pps]
                            break
                    else:
                        excluded.append({"ticker": t, "reason": f"market price £{pps[-1]:.4f} doesn't match Trading 212's £{live_pps:.4f} — valued at cost"})
                        pps = None
            else:
                excluded.append({"ticker": t, "reason": f"no FX history for {ccy} — valued at cost while held"})
        elif any(qt):
            excluded.append({"ticker": t, "reason": f"no price data for {sym} (likely delisted) — valued at cost while held"})
        at_cost = pps is None

        def value(qa, ia):
            if at_cost:
                return [max(i, 0.0) if abs(x) > 1e-9 else 0.0 for x, i in zip(qa, ia)]
            return [0.0 if abs(x) <= 1e-9 else (None if pps[i] is None else x * pps[i]) for i, x in enumerate(qa)]

        T[t] = {"pie": {"qty": qp, "invested": ip, "value": value(qp, ip)},
                "direct": {"qty": qd, "invested": idr, "value": value(qd, idr)},
                "total": {"qty": qt, "invested": it, "value": value(qt, it)}}

        if live_total > 0 or abs(qt[-1]) > QTY_EPS:
            ok_total = abs(qt[-1] - live_total) < max(QTY_EPS, live_total * 0.001)
            verification.append({
                "ticker": t, "pie": pie_of.get(t), "qty_rebuilt": round(qt[-1], 6), "qty_t212": round(live_total, 6),
                "pie_qty_t212": round(live_pie, 6), "direct_qty_t212": round(live_dir, 6),
                "ok": bool(ok_total), "split": "exact" if split_ok else "apportioned",
                "issue": None if ok_total else ("quantity differs from Trading 212" if live_total else "rebuilt as still held, but not in your Trading 212 account"),
                "note": None if split_ok or not live_total else "shares were moved between pie and direct holdings — daily split uses today's proportion",
            })

    def series(members, channel, live_now, per_ticker=True):
        vals, invs = [], []
        for i in range(N):
            v = ivt = 0.0; ok = True
            for t in members:
                d = T[t][channel]
                ivt += d["invested"][i]
                if d["value"][i] is None: ok = False
                else: v += d["value"][i]
            vals.append(r2(v) if ok else None); invs.append(r2(ivt))
        start = next((i for i in range(N) if (vals[i] or 0) > 0 or abs(invs[i] or 0) > 0), N - 1)
        s = {"source": "orders", "channel": channel, "dates": dkeys[start:], "value": vals[start:],
             "invested": invs[start:], "current": live_now,
             "verification": [x for x in verification if x["ticker"] in members],
             "excluded": [x for x in excluded if x["ticker"] in members]}
        if per_ticker:
            s["tickers"] = {t: {"qty": [round(x, 6) for x in T[t][channel]["qty"][start:]],
                                "value": [r2(x) for x in T[t][channel]["value"][start:]],
                                "invested": [r2(x) for x in T[t][channel]["invested"][start:]]} for t in members}
        return s

    # live account totals (value = total − cash; return = T212 unrealised P&L on open positions)
    acc_value = float(snap.get("total_value") or 0) - float(snap.get("cash") or 0)
    acc_result = float(snap.get("total_ppl") or 0)
    acc = {"value": round(acc_value, 2), "invested": round(acc_value - acc_result, 2), "result": round(acc_result, 2)}
    pies_tot = {k: sum(c[k] for c in pie_live.values()) for k in ("value", "invested", "result")}
    direct_live = {k: round(acc[k] - pies_tot[k], 2) for k in ("value", "invested", "result")}

    rows = []
    for pie, cur in pie_live.items():
        rows.append({"pie": pie, "series": series([t for t in tickers if pie_of.get(t) == pie], "pie", cur)})
    held_direct = [t for t in tickers if positions.get(t) and T[t]["direct"]["qty"][-1] > 1e-9]
    if held_direct:
        rows.append({"pie": "__DIRECT__", "series": series(held_direct, "direct", direct_live)})
    sold = [t for t in tickers if not positions.get(t)]
    if sold:
        rows.append({"pie": "__SOLD__", "series": series(sold, "total", None, per_ticker=False)})
    rows.append({"pie": "__ALL__", "series": series(tickers, "total", acc, per_ticker=False)})

    now = datetime.now(timezone.utc).isoformat()
    saved = 0
    for r in rows:   # one row per request — keeps each statement small
        r["updated_at"] = now
        if sb("POST", "pie_history?on_conflict=pie", [r], prefer="resolution=merge-duplicates,return=minimal") is not None:
            saved += 1
    if saved == len(rows):
        keep = ",".join(f'"{r["pie"]}"' for r in rows)
        sb("DELETE", f"pie_history?pie=not.in.({urllib.parse.quote(keep, safe=',()')})")   # derived rows only

    held = [v for v in verification if v["qty_t212"] > 0]
    print(f"  verification: {sum(v['ok'] for v in held)}/{len(held)} held instruments match Trading 212 quantities; "
          f"{sum(v['split'] == 'exact' for v in held)} with an exact pie/direct split")
    for v in verification:
        if not v["ok"] or v["note"]:
            print(f"    {'✗' if not v['ok'] else '•'} {v['ticker']}: {v['issue'] or v['note']} (rebuilt {v['qty_rebuilt']} vs T212 {v['qty_t212']})")
    for e in excluded:
        if positions.get(e["ticker"]):
            print(f"    ✗ {e['ticker']}: {e['reason']}")
    print(f"  {sum(1 for e in excluded if not positions.get(e['ticker']))} sold/delisted instruments valued at cost while held")
    for r in rows:
        s = r["series"]
        last = next((v for v in reversed(s["value"]) if v is not None), None)
        print(f"  ✓ {r['pie']:<18} {len(s['dates'])} days · rebuilt today £{last} · live £{(s['current'] or {}).get('value')}")
    if saved != len(rows):
        raise SystemExit(f"saved {saved}/{len(rows)} pie_history rows — see errors above")
    print("[pie_history] done")


if __name__ == "__main__":
    run()
