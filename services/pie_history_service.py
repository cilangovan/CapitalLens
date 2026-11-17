#!/usr/bin/env python3
"""
Pie History Service — daily value & return series for the positions drill-down.

Trading 212's API only reports *current* values, so history comes from two places:

  recorded  (rec_*)  end-of-day values from your own portfolio snapshots — actual T212 numbers:
                     value, invested and return (£) per pie and per holding. Deposits don't distort
                     returns because return = value − invested.
  estimate  (est)    for days before recording began: today's quantities × each day's close,
                     converted to £ with that day's FX rate. Answers "how have the holdings I have
                     now performed?" — not what your account actually did. Each holding's estimate
                     is calibrated to its live T212 value and dropped if it can't be matched (±15%).

Writes one row per pie (plus '__ALL__') to pie_history.series:
  { dates, est, rec_value, rec_invested, rec_result, current: {value, invested, result},
    tickers: {T: {est, rec_value, rec_result}}, excluded: [{ticker, reason}], first_recorded }

Run via: python -m services.pie_history_service
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone

import yfinance as yf

from services.value_buy_service import t212_to_yahoo

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
SUBUNIT = {"GBX": ("GBP", 0.01), "GBp": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}
CAL_TOL = 0.15          # estimate must be within ±15% of the live T212 value to be used


def sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}", method=method,
        data=json.dumps(data, default=float).encode() if data is not None else None,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json", "Prefer": prefer})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path[:70]} → {e.code}: {e.read().decode()[:300]}")
        return None


def inst_numbers(inst):
    r = inst.get("result") or {}
    f = lambda k: float(r.get(k) or 0)
    return f("priceAvgValue"), f("priceAvgInvestedValue"), f("priceAvgResult")


# ── recorded: last snapshot of each day ───────────────────────────────────────
def recorded_daily():
    idx = sb("GET", "portfolio_snapshots_all?select=id,created_at&order=created_at.asc") or []
    last_of_day = {}
    for s in idx:
        last_of_day[s["created_at"][:10]] = s["id"]
    days = sorted(last_of_day)
    out = {}
    ids = [last_of_day[d] for d in days]
    for i in range(0, len(ids), 40):
        chunk = ids[i:i + 40]
        rows = sb("GET", f"portfolio_snapshots_all?select=id,created_at,pies:raw->pies&id=in.({','.join(map(str, chunk))})") or []
        for r in rows:
            day = r["created_at"][:10]
            pies, tick = {}, {}
            for p in r.get("pies") or []:
                pv = pi = pr = 0.0
                for inst in p.get("instruments") or []:
                    v, inv, res = inst_numbers(inst)
                    pv += v; pi += inv; pr += res
                    tick[inst["ticker"]] = (v, inv, res)
                pies[p["name"]] = (pv, pi, pr)
            out[day] = {"pies": pies, "tickers": tick}
    print(f"  recorded days: {len(out)} ({days[0] if days else '—'} → {days[-1] if days else '—'})")
    return out


# ── estimate: today's quantities × daily closes × FX ──────────────────────────
def estimate(holdings, meta, positions_by_ticker):
    """holdings: {ticker: current_value_gbp}. Returns (dates, {ticker: [value]}, excluded)."""
    excluded, series = [], {}
    sym_of = {}
    for t in holdings:
        pos = positions_by_ticker.get(t) or {}
        sym_of[t] = t212_to_yahoo(t, pos.get("exchange", ""))[0]
    syms = sorted(set(sym_of.values()))
    if not syms:
        return [], {}, excluded
    data = yf.download(syms, period="1y", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    fx_cache = {}

    def fx_series(ccy):            # units of ccy per 1 GBP, by date
        if ccy == "GBP":
            return None
        if ccy not in fx_cache:
            try:
                h = yf.Ticker(f"GBP{ccy}=X").history(period="1y", interval="1d")["Close"].dropna()
                fx_cache[ccy] = {i.date().isoformat(): float(v) for i, v in h.items()}
            except Exception:
                fx_cache[ccy] = {}
        return fx_cache[ccy]

    all_dates = set()
    for t, cur_val in holdings.items():
        pos = positions_by_ticker.get(t) or {}
        qty = float(pos.get("quantity") or 0)
        sym = sym_of[t]
        try:
            closes = (data[sym]["Close"] if len(syms) > 1 else data["Close"]).dropna()
        except Exception:
            excluded.append({"ticker": t, "reason": "no price history"}); continue
        if closes.empty or qty <= 0:
            excluded.append({"ticker": t, "reason": "no price history" if closes.empty else "no quantity"}); continue
        q_ccy = (meta.get(t) or {}).get("ccy") or "GBP"
        ccy, unit = SUBUNIT.get(q_ccy, (q_ccy, 1.0))
        fx = fx_series(ccy)
        vals, last_fx = {}, None
        for i, c in closes.items():
            d = i.date().isoformat()
            if fx is not None:
                last_fx = fx.get(d, last_fx)
                if not last_fx:
                    continue
                vals[d] = qty * float(c) * unit / last_fx
            else:
                vals[d] = qty * float(c) * unit
        if not vals:
            excluded.append({"ticker": t, "reason": "no FX history"}); continue
        latest = vals[max(vals)]
        # Yahoo can quote a London line in £ while T212 uses pence (or vice versa) — try both before giving up
        for k in (1, 100, 0.01):
            if cur_val > 0 and abs(latest * k / cur_val - 1) <= CAL_TOL:
                cal = cur_val / latest
                series[t] = {d: v * cal for d, v in vals.items()}
                all_dates |= set(vals)
                break
        else:
            excluded.append({"ticker": t, "reason": f"estimate £{latest:,.2f} doesn't match T212 £{cur_val:,.2f}"})
    dates = sorted(all_dates)
    # forward-fill each ticker across the common calendar (markets have different holidays)
    out = {}
    for t, vals in series.items():
        arr, last = [], None
        for d in dates:
            last = vals.get(d, last)
            arr.append(round(last, 2) if last is not None else None)
        out[t] = arr
    return dates, out, excluded


def build_row(name, tickers, current, rec, est_dates, est_by_ticker, excluded):
    dates = sorted(set(est_dates) | set(rec))
    di = {d: i for i, d in enumerate(est_dates)}
    def est_at(t, d):
        i = di.get(d)
        if i is None:   # recorded-only day after the last close: carry last estimate
            prev = [x for x in est_dates if x <= d]
            i = di[prev[-1]] if prev else None
        return est_by_ticker[t][i] if (i is not None and t in est_by_ticker) else None
    s = {"dates": dates, "est": [], "rec_value": [], "rec_invested": [], "rec_result": [],
         "current": current, "tickers": {}, "excluded": [e for e in excluded if e["ticker"] in tickers],
         "first_recorded": min(rec) if rec else None}
    usable = [t for t in tickers if t in est_by_ticker]
    for d in dates:
        vals = [est_at(t, d) for t in usable]
        s["est"].append(round(sum(v for v in vals if v is not None), 2) if usable and all(v is not None for v in vals) else None)
        r = rec.get(d)
        if r and name == "__ALL__":
            tot = [sum(x[k] for x in r["pies"].values()) for k in range(3)]
        elif r and name in r["pies"]:
            tot = r["pies"][name]
        else:
            tot = None
        for k, key in enumerate(("rec_value", "rec_invested", "rec_result")):
            s[key].append(round(tot[k], 2) if tot else None)
    for t in tickers:
        s["tickers"][t] = {
            "est": [est_at(t, d) for d in dates] if t in est_by_ticker else None,
            "rec_value": [round(rec[d]["tickers"][t][0], 2) if d in rec and t in rec[d]["tickers"] else None for d in dates],
            "rec_result": [round(rec[d]["tickers"][t][2], 2) if d in rec and t in rec[d]["tickers"] else None for d in dates],
        }
    return s


def run():
    print(f"[pie_history] {datetime.now(timezone.utc).isoformat()}")
    snap = (sb("GET", "portfolio_snapshots?select=id,raw&order=id.desc&limit=1") or [None])[0]
    if not snap:
        print("  no snapshot"); return
    raw = snap.get("raw") or {}
    meta = raw.get("instrument_meta") or {}
    positions = {p["ticker"]: p for p in (sb("GET", f"positions?snapshot_id=eq.{snap['id']}&select=ticker,exchange,quantity") or [])}
    pies = [p for p in raw.get("pies") or [] if p.get("instruments")]
    holdings, pie_tickers, pie_current = {}, {}, {}
    for p in pies:
        pv = pi = pr = 0.0
        pie_tickers[p["name"]] = []
        for inst in p["instruments"]:
            v, inv, res = inst_numbers(inst)
            pv += v; pi += inv; pr += res
            if v > 0:
                holdings[inst["ticker"]] = holdings.get(inst["ticker"], 0) + v
                pie_tickers[p["name"]].append(inst["ticker"])
        pie_current[p["name"]] = {"value": round(pv, 2), "invested": round(pi, 2), "result": round(pr, 2)}

    rec = recorded_daily()
    est_dates, est_by_ticker, excluded = estimate(holdings, meta, positions)
    print(f"  estimate: {len(est_by_ticker)}/{len(holdings)} holdings over {len(est_dates)} days; excluded {len(excluded)}")
    for e in excluded:
        print(f"    ✗ {e['ticker']}: {e['reason']}")

    rows = []
    for name, tick in pie_tickers.items():
        if not tick: continue
        rows.append({"pie": name, "series": build_row(name, tick, pie_current[name], rec, est_dates, est_by_ticker, excluded)})
    all_t = sorted({t for ts in pie_tickers.values() for t in ts})
    tot = {k: round(sum(c[k] for c in pie_current.values()), 2) for k in ("value", "invested", "result")}
    rows.append({"pie": "__ALL__", "series": build_row("__ALL__", all_t, tot, rec, est_dates, est_by_ticker, excluded)})
    now = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["updated_at"] = now
    sb("POST", "pie_history?on_conflict=pie", rows, prefer="resolution=merge-duplicates,return=minimal")
    keep = ",".join(f'"{r["pie"]}"' for r in rows)
    sb("DELETE", f"pie_history?pie=not.in.({urllib.parse.quote(keep, safe=',()')})")   # pies you no longer have
    for r in rows:
        s = r["series"]
        print(f"  ✓ {r['pie']:<20} {len(s['dates'])} days, now £{s['current']['value']:,.2f}, "
              f"return £{s['current']['result']:,.2f}")
    print("[pie_history] done")


if __name__ == "__main__":
    run()
