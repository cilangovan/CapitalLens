#!/usr/bin/env python3
"""
Alert Service — scans portfolio positions for dip/buy/sell signals,
writes to Supabase alerts table, and pushes ntfy notifications.
Runs daily after strategy_service.

Signals:
  - DIP ALERT:   position dipped ≥8% from its recent high
  - BUY SIGNAL:  analyst ≥4★ + buy%≥60% + dip ≥5% (confirmed dip-buy opportunity)
  - SELL SIGNAL: analyst ≤2★ OR sell%≥50% AND gain%≥20% (take profit)
  - REBALANCE:   any pie weight drifted >10% from target
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
NTFY_TOPIC   = os.environ.get("NTFY_TOPIC", "")  # e.g. "hoop-t212-alerts"

DIP_THRESHOLD      = 8.0   # % dip from high to trigger dip alert
BUY_DIP_MIN        = 5.0   # % dip needed to confirm a buy signal
BUY_STAR_MIN       = 4     # min star rating for buy signal
BUY_BUY_PCT_MIN    = 60.0  # min analyst buy% for buy signal
SELL_STAR_MAX      = 2     # max star rating for sell signal
SELL_SELL_PCT_MIN  = 50.0  # min sell% for sell signal
SELL_GAIN_MIN      = 20.0  # min gain% before triggering sell (take profit)
REBALANCE_DRIFT    = 10.0  # % weight drift from target to flag rebalance


def supabase_get(path):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  Supabase GET {path} → {e.code}: {e.read().decode()}")
        return []


def supabase_post(path, data):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return True
    except urllib.error.HTTPError as e:
        print(f"  Supabase POST {path} → {e.code}: {e.read().decode()}")
        return False


def ntfy_push(title, body, priority="default", tags=""):
    """Send push notification via ntfy.sh."""
    if not NTFY_TOPIC:
        print(f"  [ntfy] NTFY_TOPIC not set — skipping push")
        return
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Tags": tags,
        "Content-Type": "text/plain",
    }
    body_bytes = body.encode()
    req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"  [ntfy] ✓ pushed: {title}")
    except Exception as e:
        print(f"  [ntfy] ✗ push failed: {e}")


def get_latest_snapshot_positions():
    """Get positions from the most recent snapshot."""
    snaps = supabase_get("portfolio_snapshots?select=id,created_at,total_value&order=created_at.desc&limit=1")
    if not snaps:
        return None, []
    snap = snaps[0]
    positions = supabase_get(f"positions?snapshot_id=eq.{snap['id']}&select=*")
    return snap, positions


def get_analyst_map():
    """Get analyst ratings keyed by ticker."""
    rows = supabase_get("analyst_ratings?select=ticker,star_rating,recommendation,buy_pct,sell_pct,pie")
    return {r["ticker"]: r for r in rows}


def get_recent_alert_keys(hours=24):
    """Get alert dedup keys from last N hours to avoid spam."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    rows = supabase_get(f"alerts?select=dedup_key&created_at=gte.{cutoff}")
    return {r["dedup_key"] for r in rows if r.get("dedup_key")}


def save_alert(alert_type, title, body, ticker=None, pie=None, dedup_key=None):
    """Save alert to Supabase and push via ntfy."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "alert_type": alert_type,
        "title": title,
        "body": body,
        "ticker": ticker,
        "pie": pie,
        "dedup_key": dedup_key or f"{alert_type}:{ticker or pie}:{datetime.now(timezone.utc).date()}",
        "created_at": now,
    }
    ok = supabase_post("alerts", row)
    if ok:
        print(f"  ✓ Alert saved: {title}")

    # Push notification
    priority_map = {"dip": "high", "buy": "high", "sell": "urgent", "rebalance": "default"}
    tags_map = {"dip": "chart_with_downwards_trend", "buy": "moneybag", "sell": "warning", "rebalance": "scales"}
    ntfy_push(
        title=title,
        body=body,
        priority=priority_map.get(alert_type, "default"),
        tags=tags_map.get(alert_type, "bell"),
    )
    return ok


def run():
    print(f"[alert_service] Starting at {datetime.now(timezone.utc).isoformat()}")

    snap, positions = get_latest_snapshot_positions()
    if not positions:
        print("  No positions found — skipping")
        return

    print(f"  Loaded {len(positions)} positions from snapshot {snap['id']}")

    analyst_map = get_analyst_map()
    seen_keys = get_recent_alert_keys(hours=23)  # dedupe within 23h

    alerts_fired = 0
    total_value = float(snap.get("total_value") or 0)

    for p in positions:
        ticker = p.get("ticker", "")
        display = p.get("display") or ticker
        pie = p.get("pie", "")
        gain_pct = float(p.get("gain_pct") or 0)
        dip_from_high = float(p.get("dip_from_high") or 0)
        ppl = float(p.get("ppl") or 0)
        value = float(p.get("value") or 0)

        analyst = analyst_map.get(ticker, {})  # analyst_ratings keyed by T212 ticker
        star = analyst.get("star_rating", 0) or 0
        buy_pct = float(analyst.get("buy_pct") or 0)
        sell_pct_a = float(analyst.get("sell_pct") or 0)

        # ── DIP ALERT ──────────────────────────────────────────
        if dip_from_high <= -DIP_THRESHOLD:
            key = f"dip:{ticker}:{datetime.now(timezone.utc).date()}"
            if key not in seen_keys:
                title = f"⬇️ Dip Alert: {display}"
                body = f"{display} ({pie}) is down {abs(dip_from_high):.1f}% from recent high\nCurrent P&L: £{ppl:+.2f} ({gain_pct:+.1f}%)"
                save_alert("dip", title, body, ticker=ticker, pie=pie, dedup_key=key)
                seen_keys.add(key)
                alerts_fired += 1

        # ── BUY SIGNAL (dip + strong analyst backing) ──────────
        if (dip_from_high <= -BUY_DIP_MIN
                and star >= BUY_STAR_MIN
                and buy_pct >= BUY_BUY_PCT_MIN):
            key = f"buy:{ticker}:{datetime.now(timezone.utc).date()}"
            if key not in seen_keys:
                title = f"🟢 Buy Signal: {display}"
                body = (f"{display} ({pie}) dipped {abs(dip_from_high):.1f}% but analysts are bullish\n"
                        f"⭐{star} | Buy: {buy_pct:.0f}% | P&L: £{ppl:+.2f} ({gain_pct:+.1f}%)")
                save_alert("buy", title, body, ticker=ticker, pie=pie, dedup_key=key)
                seen_keys.add(key)
                alerts_fired += 1

        # ── SELL SIGNAL (weak analyst + decent gain) ───────────
        if (star > 0 and star <= SELL_STAR_MAX
                and sell_pct_a >= SELL_SELL_PCT_MIN
                and gain_pct >= SELL_GAIN_MIN):
            key = f"sell:{ticker}:{datetime.now(timezone.utc).date()}"
            if key not in seen_keys:
                title = f"🔴 Sell Signal: {display}"
                body = (f"{display} ({pie}) has weak analyst outlook — consider taking profit\n"
                        f"⭐{star} | Sell: {sell_pct_a:.0f}% | Gain: {gain_pct:+.1f}% | P&L: £{ppl:+.2f}")
                save_alert("sell", title, body, ticker=ticker, pie=pie, dedup_key=key)
                seen_keys.add(key)
                alerts_fired += 1

    # ── REBALANCE CHECK (pie weight drift) ─────────────────────
    # Group positions by pie, compare weight vs equal-weight target
    pie_values = {}
    for p in positions:
        pie = p.get("pie") or "Unknown"
        pie_values[pie] = pie_values.get(pie, 0) + float(p.get("value") or 0)

    if total_value > 0 and pie_values:
        num_pies = len(pie_values)
        target_pct = 100.0 / num_pies
        for pie_name, pie_val in pie_values.items():
            actual_pct = pie_val / total_value * 100
            drift = actual_pct - target_pct
            if abs(drift) >= REBALANCE_DRIFT:
                key = f"rebalance:{pie_name}:{datetime.now(timezone.utc).date()}"
                if key not in seen_keys:
                    direction = "overweight" if drift > 0 else "underweight"
                    title = f"⚖️ Rebalance: {pie_name}"
                    body = (f"{pie_name} is {direction} by {abs(drift):.1f}%\n"
                            f"Current: {actual_pct:.1f}% | Target: {target_pct:.1f}% | Value: £{pie_val:.0f}")
                    save_alert("rebalance", title, body, pie=pie_name, dedup_key=key)
                    seen_keys.add(key)
                    alerts_fired += 1

    if alerts_fired == 0:
        print("  No new alerts to fire today")
        # Still push a daily digest if nothing alarming
        # (optional — comment out if too noisy)
        # ntfy_push("📊 T212 Daily Check", f"All clear — {len(positions)} positions checked, no alerts.", priority="min", tags="white_check_mark")
    else:
        print(f"  Fired {alerts_fired} alert(s)")

    print(f"[alert_service] Done.")


if __name__ == "__main__":
    run()
