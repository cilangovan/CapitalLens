#!/usr/bin/env python3
"""
Alert Service — daily per-pie review report, in one house style.

For every funded pie it writes ONE report to the alerts table (dashboard) and
pushes it to the phone only when something needs attention.

Per holding:
  1. Portfolio position — live T212 weight vs the pie's strategic target.
     Flag when outside ±WEIGHT_BAND_PP percentage points.
  2. Price thresholds — from verified daily closes:
       latest close, daily change, 20-day closing high, drawdown.
     Thresholds: drawdown ≤ −8% (dip), ≤ −12% (deep dip), daily ≤ −3% (sharp fall),
     gain vs your average cost ≥ +40% (profit booking).
  3. Review flag — what to do, combining weight + price + analyst view.
  4. Data coverage — a holding whose price data can't be verified is listed here
     and gets NO price alert and is NOT marked clear.

Price data counts as verified only when ALL hold:
  - ≥ 20 daily closes, latest close not older than the last weekday session
  - currency known (GBp/GBX converted to GBP)
  - no unit jumps inside the 20-session window (max/min < 1.5)
  - latest close within 6% of Trading 212's own live price (unit-matched)

Run via: python -m services.alert_service
"""

import os
import json
import hashlib
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta, date

from services.alert_format import (
    Section, render_text, render_push, friendly, short_name, base_symbol,
    pct, pp, money, day_month, full_date, signed,
)

try:
    import yfinance as yf
except ImportError:
    yf = None

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]
NTFY_TOPIC   = os.environ.get("NTFY_TOPIC", "")

WEIGHT_BAND_PP   = 5.0    # ± percentage points from target before flagging
DIP_DRAWDOWN     = -8.0   # % from 20-day closing high
DEEP_DRAWDOWN    = -12.0
SHARP_DAILY_DROP = -3.0   # % daily change
PROFIT_GAIN      = 40.0   # % vs your average cost
SESSIONS         = 20
PRICE_TOLERANCE  = 0.06   # Yahoo close vs T212 live price
STALE_SNAPSHOT_H = 24


# ── Supabase ──────────────────────────────────────────────────────────────────
def _sb(method, path, data=None, prefer="return=minimal"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "Content-Type": "application/json", "Accept": "application/json",
                 "Prefer": prefer},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        print(f"  Supabase {method} {path} → {e.code}: {e.read().decode()[:300]}")
        return None


def sb_get(path):
    return _sb("GET", path) or []


# ── ntfy ──────────────────────────────────────────────────────────────────────
def ntfy_push(title, body, priority="default", tags="bell"):
    if not NTFY_TOPIC:
        print("  [ntfy] NTFY_TOPIC not set — skipping push"); return
    import base64
    req = urllib.request.Request(
        f"https://ntfy.sh/{NTFY_TOPIC}", data=body.encode(), method="POST",
        headers={"Title": "=?UTF-8?B?" + base64.b64encode(title.encode()).decode() + "?=",
                 "Priority": priority, "Tags": tags, "Content-Type": "text/plain"})
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"  [ntfy] ✓ pushed: {title}")
    except Exception as e:
        print(f"  [ntfy] ✗ push failed: {e}")


# ── Price data ────────────────────────────────────────────────────────────────
def yahoo_symbol(t212_ticker, exchange):
    from services.value_buy_service import t212_to_yahoo
    return t212_to_yahoo(t212_ticker, exchange)[0]


def last_weekday_session(today):
    d = today - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def fetch_verified_prices(sym, t212_price, today):
    """Return (data, None) when verified, else (None, reason)."""
    if yf is None:
        return None, "price library unavailable"
    try:
        t = yf.Ticker(sym)
        h = t.history(period="3mo", interval="1d", auto_adjust=False)
        meta = getattr(t, "history_metadata", None) or {}
    except Exception as e:
        return None, f"price feed error ({type(e).__name__})"
    if h is None or h.empty or "Close" not in h:
        return None, "no daily price history"
    closes = [(idx.date(), float(c)) for idx, c in h["Close"].dropna().items()]
    if len(closes) < SESSIONS:
        return None, f"only {len(closes)} sessions of history (need {SESSIONS})"
    last_date = closes[-1][0]
    if last_date < last_weekday_session(today):
        return None, f"latest close is stale ({day_month(last_date)})"

    ccy = (meta.get("currency") or "").strip()
    if not ccy:
        return None, "listing currency unknown"
    scale, ccy_out = (0.01, "GBP") if ccy in ("GBp", "GBX") else (1.0, ccy.upper())

    window = [c for _, c in closes[-SESSIONS:]]
    jumps = [b / a for a, b in zip(window, window[1:]) if a > 0]
    if min(window) <= 0 or any(j > 8 or j < 1 / 8 for j in jumps):   # pence↔pound style 100× jumps
        return None, "inconsistent price units in history"

    native_last = closes[-1][1]
    if t212_price and t212_price > 0:
        ok = any(abs(native_last / cand - 1) <= PRICE_TOLERANCE
                 for cand in (t212_price, t212_price / 100, t212_price * 100))
        if not ok:
            return None, "price does not match Trading 212's live quote"

    last = native_last * scale
    prev = closes[-2][1] * scale
    high = max(window) * scale
    return {
        "symbol": sym, "ccy": ccy_out, "last": last, "last_date": last_date,
        "daily": (last / prev - 1) * 100, "high20": high,
        "drawdown": (last / high - 1) * 100,
    }, None


_FX = {}
def gbp_rate(ccy):
    """Units of ccy per 1 GBP (e.g. 1.32 for USD), or None if unavailable."""
    if ccy == "GBP" or yf is None:
        return None
    if ccy not in _FX:
        try:
            h = yf.Ticker(f"GBP{ccy}=X").history(period="5d", interval="1d")
            _FX[ccy] = float(h["Close"].dropna().iloc[-1]) if not h.empty else None
        except Exception:
            _FX[ccy] = None
    return _FX[ccy]


def money_gbp(v, ccy):
    s = money(v, ccy)
    r = gbp_rate(ccy)
    return f"{s} (≈ {money(v / r, 'GBP')})" if r else s


# ── Report building ───────────────────────────────────────────────────────────
def review_flag(name, weight_state, price, gain, analyst):
    dip = price and price["drawdown"] <= DIP_DRAWDOWN
    deep = price and price["drawdown"] <= DEEP_DRAWDOWN
    sharp = price and price["daily"] <= SHARP_DAILY_DROP
    falling = dip or sharp
    star = (analyst or {}).get("star_rating") or 0

    if weight_state == "overweight":
        msg = f"Keep regular {name} additions paused while it remains overweight."
        if falling:
            msg += " A large fall does not automatically make it a good entry."
        else:
            msg += " Let new contributions to the other holdings bring it back to target."
        return msg
    if weight_state == "underweight":
        if deep:
            return (f"{name} is underweight and well below its 20-day high. New contributions "
                    f"can go here first, but check why it fell before adding a lump sum.")
        return f"{name} is underweight. Direct new contributions here first until it is back near target."
    if falling:
        base = f"{name} is on target weight but has fallen."
        if star >= 4:
            return base + f" Analysts still rate it ⭐{star}. Review the news before adding; a fall alone is not a buy signal."
        return base + " Review the news and analyst view before adding; a fall alone is not a buy signal."
    if gain is not None and gain >= PROFIT_GAIN:
        return (f"Up {pct(gain, 1)} on your average cost. Consider booking part of the profit "
                f"(see the Profit Booking tab).")
    return None


def build_pie_report(pie, positions_by_ticker, meta, analyst_map, snap_time, today):
    sections, flags, coverage = [], [], []
    insts = sorted(pie.get("instruments") or [],
                   key=lambda i: -(abs(float(i.get("current") or 0) - float(i.get("expected") or 0))))
    snap_age_h = (datetime.now(timezone.utc) - snap_time).total_seconds() / 3600
    weight_src = (f"Source: Trading 212 API pie data, {day_month(snap_time)} "
                  f"{snap_time.strftime('%H:%M')} UTC.")
    if snap_age_h > STALE_SNAPSHOT_H:
        weight_src += f" The holding weight is not live-verified (snapshot {snap_age_h:.0f}h old)."

    flagged, clear = [], []
    for inst in insts:
        ticker = inst.get("ticker", "")
        pos = positions_by_ticker.get(ticker, {})
        mname = (meta.get(ticker) or {}).get("name")
        label, name = friendly(ticker, mname), short_name(ticker, mname)
        cur_w = float(inst.get("current") or 0) * 100
        tgt_w = float(inst.get("expected") or 0) * 100
        diff = cur_w - tgt_w
        weight_state = ("overweight" if diff >= WEIGHT_BAND_PP else
                        "underweight" if diff <= -WEIGHT_BAND_PP else None)

        t212_price = float(pos.get("current_price") or 0)
        avg = float(pos.get("avg_price") or 0)
        gain = ((t212_price / avg - 1) * 100) if t212_price and avg else None

        sym = yahoo_symbol(ticker, pos.get("exchange", ""))
        price, reason = fetch_verified_prices(sym, t212_price, today)
        if reason:
            coverage.append((name, reason))

        crossed = []
        if price:
            if price["drawdown"] <= DEEP_DRAWDOWN:   crossed.append("deep dip")
            elif price["drawdown"] <= DIP_DRAWDOWN:  crossed.append("dip")
            if price["daily"] <= SHARP_DAILY_DROP:   crossed.append("sharp daily fall")
        if gain is not None and gain >= PROFIT_GAIN:
            crossed.append("profit target")

        status = []
        if weight_state: status.append(weight_state)
        status += crossed
        if not status and not price:
            continue  # nothing verified to say — listed under Data coverage only

        s = Section(f"{label} — {', '.join(status) if status else 'no threshold crossed'}")
        if weight_state:
            s.table("Measure", "Weight", [
                (f"Last reported {name} holding ({day_month(snap_time)})", f"{cur_w:.2f}%"),
                ("Strategic target", f"{tgt_w:.2f}%"),
                ("Difference", pp(diff)),
            ])
            s.line(weight_src)
        if price:
            rows = [
                (f"Latest {price['ccy']} price", money_gbp(price["last"], price["ccy"])),
                ("Daily change", pct(price["daily"])),
                ("20-day closing high", money_gbp(price["high20"], price["ccy"])),
                ("Drawdown", pct(price["drawdown"])),
            ]
            if not weight_state:
                rows.append(("Weight vs target", f"{cur_w:.2f}% vs {tgt_w:.2f}% ({signed(diff)} pp)"))
            if gain is not None:
                rows.append(("Gain vs your average cost", pct(gain)))
            a = analyst_map.get(ticker) or {}
            if a.get("star_rating"):
                rows.append(("Analyst view", f"⭐{a['star_rating']} · {float(a.get('buy_pct') or 0):.0f}% buy"))
            s.table("Measure", "Result", rows)
            s.line(f"Source: Yahoo Finance daily closes ({price['symbol']}), "
                   f"{full_date(price['last_date'])}; cross-checked against the Trading 212 live price.")
        flag = review_flag(name, weight_state, price, gain, analyst_map.get(ticker))
        if flag:
            s.line(f"Review flag: {flag}")
        (flagged if status else clear).append(s)
        flags += [f"{base_symbol(ticker)}:{x}" for x in status]

    sections = flagged + clear
    if coverage:
        names = [n for n, _ in coverage]
        joined = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        s = Section("Data coverage")
        s.line(f"Could not reliably verify today's price and full {SESSIONS}-session history for "
               f"{joined}. They are not marked clear and no price alerts were generated for them "
               f"without evidence.")
        for n, r in coverage:
            s.line(f"• {n}: {r}")
        sections.append(s)
    return sections, flags, coverage


def title_for(pie_name, flags, coverage, positions_count):
    if flags:
        uniq = sorted(set(f.split(":", 1)[1] for f in flags))
        return f"⚠️ {pie_name} — {len(flags)} flag{'s' if len(flags) != 1 else ''} ({', '.join(uniq)})"
    if coverage and len(coverage) >= positions_count:
        return f"❔ {pie_name} — data unverified"
    return f"✅ {pie_name} — no threshold crossed"


def run():
    print(f"[alert_service] Starting at {datetime.now(timezone.utc).isoformat()}")
    snaps = sb_get("portfolio_snapshots?select=id,created_at,raw&order=created_at.desc&limit=1")
    if not snaps:
        print("  No snapshot — skipping"); return
    snap = snaps[0]
    snap_time = datetime.fromisoformat(snap["created_at"].replace("Z", "+00:00"))
    raw = snap.get("raw") or {}
    pies = raw.get("pies") or []
    meta = raw.get("instrument_meta") or {}
    positions = sb_get(f"positions?snapshot_id=eq.{snap['id']}&select=*")
    pos_by_ticker = {p["ticker"]: p for p in positions}
    analyst_map = {r["ticker"]: r for r in
                   sb_get("analyst_ratings?select=ticker,star_rating,buy_pct,sell_pct")}
    today = datetime.now(timezone.utc).date()
    day_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    todays = sb_get("alerts?select=id,pie,dedup_key,archived_at,dismissed_at&alert_type=eq.report"
                    f"&created_at=gte.{urllib.parse.quote(day_start)}")

    pushed = 0
    for pie in pies:
        if float(pie.get("value") or 0) <= 0:
            print(f"  {pie.get('name')}: unfunded — skipped"); continue
        name = pie["name"]
        sections, flags, coverage = build_pie_report(pie, pos_by_ticker, meta, analyst_map, snap_time, today)
        if not sections:
            continue
        sig = hashlib.sha1("|".join(sorted(flags)).encode()).hexdigest()[:10]
        key = f"report:{name}:{today}:{sig}"
        title = title_for(name, flags, coverage, len(pie.get("instruments") or []))
        already_pushed = any(r.get("dedup_key") == key for r in todays)

        # One report per pie per day. Respect inbox state set on the dashboard:
        #  - same flags as a report you archived/dismissed today → leave it alone
        #  - same flags as a report still in the inbox → refresh it in place (keeps read state)
        #  - new flags → replace today's inbox report with a fresh (unread) one
        same = [r for r in todays if r.get("dedup_key") == key]
        body = render_text(sections)
        if any(r.get("archived_at") or r.get("dismissed_at") for r in same):
            print(f"  · {title} (unchanged; you archived/cleared it)")
        elif same:
            _sb("PATCH", f"alerts?id=eq.{same[0]['id']}", {"title": title, "body": body})
            print(f"  ↻ {title}")
        else:
            for r in todays:
                if r.get("pie") == name and not (r.get("archived_at") or r.get("dismissed_at")):
                    _sb("DELETE", f"alerts?id=eq.{r['id']}")
            _sb("POST", "alerts", {
                "alert_type": "report", "type": "report", "pie": name, "ticker": None,
                "title": title, "body": body, "dedup_key": key,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"  ✓ {title}")

        if flags and not already_pushed:
            prio = "high" if any(("dip" in f or "fall" in f) for f in flags) else "default"
            ntfy_push(title, render_push(sections), priority=prio,
                      tags="warning" if prio == "high" else "scales")
            pushed += 1

    print(f"[alert_service] Done — {pushed} push(es).")


if __name__ == "__main__":
    run()
