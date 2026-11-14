"""
Trading 212 Portfolio Monitor
Monitors pies + individual positions, fires alerts via ntfy + Gmail
"""

import os
import json
import time
import smtplib
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ── Config ────────────────────────────────────────────────────────────────────
T212_API_KEY    = os.environ["T212_API_KEY"]
T212_API_SECRET = os.environ["T212_API_SECRET"]
GMAIL_USER      = os.environ["GMAIL_USER"]
GMAIL_APP_PASS  = os.environ["GMAIL_APP_PASS"]
NTFY_TOPIC      = os.environ.get("NTFY_TOPIC", "hoop-t212-x7k29")
NTFY_URL        = f"https://ntfy.sh/{NTFY_TOPIC}"

# Alert thresholds
DIP_FROM_HIGH_PCT   = 8.0   # alert if position drops 8% from its recent high
BUY_SIGNAL_PCT      = 12.0  # strong buy signal threshold
TRIM_GAIN_PCT       = 40.0  # trim / take profit signal
REBALANCE_DRIFT_PCT = 5.0   # pie weight drift trigger
ANNUAL_GROWTH_PCT   = 15.0  # target annual growth rate

T212_BASE = "https://live.trading212.com"

# State file — persisted as GitHub Actions artifact between runs
STATE_FILE = "portfolio_state.json"

# ── API helpers ───────────────────────────────────────────────────────────────

def t212_get(path):
    """Make authenticated GET request to Trading 212 API."""
    import base64
    creds = base64.b64encode(f"{T212_API_KEY}:{T212_API_SECRET}".encode()).decode()
    req = urllib.request.Request(
        f"{T212_BASE}{path}",
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[T212] HTTP {e.code} on {path}: {body}")
        return None
    except Exception as e:
        print(f"[T212] Error on {path}: {e}")
        return None


def rate_limit():
    """Respect T212 rate limits — 1 req per 2s to be safe."""
    time.sleep(2)


# ── Data fetchers ─────────────────────────────────────────────────────────────

def fetch_account():
    data = t212_get("/api/v0/equity/account/cash")
    rate_limit()
    return data


def fetch_positions():
    """All open positions (individual stocks + pie holdings)."""
    data = t212_get("/api/v0/equity/portfolio")
    rate_limit()
    return data or []


def fetch_pies():
    """All pies with their allocations."""
    data = t212_get("/api/v0/equity/pies")
    rate_limit()
    if not data:
        return []
    pies = []
    for pie in data:
        pie_id = pie.get("id")
        detail = t212_get(f"/api/v0/equity/pies/{pie_id}")
        rate_limit()
        if detail:
            pies.append(detail)
    return pies


def fetch_orders_history():
    """Recent order history for context."""
    data = t212_get("/api/v0/equity/history/orders?limit=50")
    rate_limit()
    return data or []


# ── State management ──────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"highs": {}, "last_alerts": {}, "baseline_weights": {}, "run_count": 0, "first_run_date": None}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def update_highs(state, positions):
    """Track rolling highs per ticker."""
    for pos in positions:
        ticker = pos.get("ticker", "")
        current = float(pos.get("currentPrice", 0))
        if current > 0:
            prev_high = state["highs"].get(ticker, 0)
            state["highs"][ticker] = max(prev_high, current)
    return state


def alert_cooldown(state, key, hours=4):
    """Prevent repeated alerts — cooldown per key."""
    last = state["last_alerts"].get(key, 0)
    return (time.time() - last) < (hours * 3600)


def mark_alerted(state, key):
    state["last_alerts"][key] = time.time()


# ── Alert rules ───────────────────────────────────────────────────────────────

def analyse_positions(positions, state):
    alerts = []
    summary_rows = []

    for pos in positions:
        ticker   = pos.get("ticker", "UNKNOWN")
        qty      = float(pos.get("quantity", 0))
        avg_price = float(pos.get("averagePrice", 0))
        current   = float(pos.get("currentPrice", 0))
        invested  = float(pos.get("initialFillDate") and avg_price * qty or pos.get("investment", 0))
        ppl       = float(pos.get("ppl", 0))  # profit/loss in cash
        in_pie    = bool(pos.get("pieSlices"))

        if current == 0 or avg_price == 0:
            continue

        gain_pct = ((current - avg_price) / avg_price) * 100
        high     = state["highs"].get(ticker, current)
        dip_from_high = ((high - current) / high) * 100 if high > 0 else 0

        label = f"[PIE] {ticker}" if in_pie else f"[SOLO] {ticker}"

        summary_rows.append({
            "ticker": ticker,
            "current": current,
            "avg": avg_price,
            "gain_pct": round(gain_pct, 2),
            "dip_from_high": round(dip_from_high, 2),
            "ppl": round(ppl, 2),
            "in_pie": in_pie,
        })

        # Dip alert
        if dip_from_high >= DIP_FROM_HIGH_PCT:
            key = f"dip_{ticker}"
            if not alert_cooldown(state, key, hours=6):
                severity = "🔴 STRONG DIP" if dip_from_high >= BUY_SIGNAL_PCT else "🟡 DIP"
                alerts.append({
                    "type": "dip",
                    "ticker": ticker,
                    "title": f"{severity} — {ticker}",
                    "body": f"{label} down {dip_from_high:.1f}% from recent high (now £{current:.2f}, high was £{high:.2f}). Avg cost £{avg_price:.2f}.",
                    "priority": "high" if dip_from_high >= BUY_SIGNAL_PCT else "default",
                    "key": key,
                })
                if dip_from_high >= BUY_SIGNAL_PCT:
                    alerts.append({
                        "type": "buy",
                        "ticker": ticker,
                        "title": f"💡 BUY SIGNAL — {ticker}",
                        "body": f"{label} dip of {dip_from_high:.1f}% from high — potential buy opportunity at £{current:.2f}.",
                        "priority": "high",
                        "key": f"buy_{ticker}",
                    })

        # Trim / take profit
        if gain_pct >= TRIM_GAIN_PCT:
            key = f"trim_{ticker}"
            if not alert_cooldown(state, key, hours=24):
                alerts.append({
                    "type": "trim",
                    "ticker": ticker,
                    "title": f"💰 TRIM SIGNAL — {ticker}",
                    "body": f"{label} up {gain_pct:.1f}% from avg cost (£{avg_price:.2f} → £{current:.2f}). Consider taking some profit.",
                    "priority": "default",
                    "key": key,
                })

    return alerts, summary_rows


def analyse_pies(pies, state):
    alerts = []
    pie_summaries = []

    for pie in pies:
        name         = pie.get("settings", {}).get("name", "Unknown Pie")
        instruments  = pie.get("instruments", [])
        total_value  = sum(float(i.get("currentValue", 0)) for i in instruments)

        if total_value == 0:
            continue

        pie_result   = pie.get("result", {})
        pie_gain_pct = float(pie_result.get("priceAvgReturnPercentage", 0))

        drifts = []
        for inst in instruments:
            ticker       = inst.get("ticker", "")
            target_pct   = float(inst.get("ownedQuantity", 0))  # T212 target share
            current_val  = float(inst.get("currentValue", 0))
            actual_pct   = (current_val / total_value * 100) if total_value > 0 else 0
            # Store baseline on first run
            baseline_key = f"{name}_{ticker}"
            if baseline_key not in state["baseline_weights"]:
                state["baseline_weights"][baseline_key] = actual_pct

            baseline = state["baseline_weights"][baseline_key]
            drift    = abs(actual_pct - baseline)
            if drift >= REBALANCE_DRIFT_PCT:
                drifts.append(f"{ticker}: {drift:.1f}% drift")

        pie_summaries.append({
            "name": name,
            "value": round(total_value, 2),
            "gain_pct": round(pie_gain_pct, 2),
            "holdings": len(instruments),
        })

        if drifts:
            key = f"rebalance_{name}"
            if not alert_cooldown(state, key, hours=12):
                alerts.append({
                    "type": "rebalance",
                    "ticker": name,
                    "title": f"⚖️ REBALANCE — {name}",
                    "body": f"Pie drifted: {', '.join(drifts)}. Consider rebalancing in Trading 212.",
                    "priority": "default",
                    "key": key,
                })

    return alerts, pie_summaries, state


def check_annual_growth(account, summary_rows, state):
    """Compare portfolio return vs 15% annual target."""
    alerts = []
    if not state.get("first_run_date"):
        state["first_run_date"] = datetime.now(timezone.utc).isoformat()
        return alerts, state

    first = datetime.fromisoformat(state["first_run_date"])
    days  = (datetime.now(timezone.utc) - first).days
    if days < 7:
        return alerts, state

    total_ppl = sum(r["ppl"] for r in summary_rows)
    total_inv = sum(abs(r["ppl"]) / (abs(r["gain_pct"]) / 100) for r in summary_rows if r["gain_pct"] != 0) or 1
    actual_annual = (total_ppl / total_inv) * (365 / days) * 100

    key = "growth_check"
    if actual_annual < (ANNUAL_GROWTH_PCT * 0.5) and not alert_cooldown(state, key, hours=168):
        alerts.append({
            "type": "growth",
            "ticker": "PORTFOLIO",
            "title": "📉 GROWTH LAGGING TARGET",
            "body": f"Annualised return: {actual_annual:.1f}% vs {ANNUAL_GROWTH_PCT}% target. Review allocations.",
            "priority": "default",
            "key": key,
        })

    return alerts, state


# ── Notification senders ──────────────────────────────────────────────────────

def send_ntfy(title, body, priority="default"):
    """Send push notification via ntfy.sh."""
    priority_map = {"high": "urgent", "default": "default", "low": "low"}
    data = body.encode("utf-8")
    req = urllib.request.Request(
        NTFY_URL,
        data=data,
        headers={
            "Title": title,
            "Priority": priority_map.get(priority, "default"),
            "Tags": "chart_with_upwards_trend",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[ntfy] Sent: {title}")
    except Exception as e:
        print(f"[ntfy] Error: {e}")


def send_email(subject, html_body):
    """Send email summary via Gmail SMTP."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = GMAIL_USER
        msg["To"]      = GMAIL_USER
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(GMAIL_USER, GMAIL_APP_PASS)
            server.sendmail(GMAIL_USER, GMAIL_USER, msg.as_string())
        print(f"[email] Sent: {subject}")
    except Exception as e:
        print(f"[email] Error: {e}")


def build_email_html(summary_rows, pie_summaries, alerts, account):
    now = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    cash = float(account.get("free", 0)) if account else 0
    total = float(account.get("total", 0)) if account else 0

    rows_html = ""
    for r in sorted(summary_rows, key=lambda x: x["gain_pct"], reverse=True):
        color = "#16a34a" if r["gain_pct"] >= 0 else "#dc2626"
        dip_color = "#dc2626" if r["dip_from_high"] >= DIP_FROM_HIGH_PCT else "#374151"
        rows_html += f"""
        <tr>
          <td style="padding:8px 12px;font-weight:600">{r['ticker']}</td>
          <td style="padding:8px 12px">£{r['current']:.2f}</td>
          <td style="padding:8px 12px;color:{color}">{r['gain_pct']:+.1f}%</td>
          <td style="padding:8px 12px;color:{dip_color}">{r['dip_from_high']:.1f}%↓</td>
          <td style="padding:8px 12px;color:{color}">£{r['ppl']:+.2f}</td>
          <td style="padding:8px 12px;font-size:11px;color:#6b7280">{'Pie' if r['in_pie'] else 'Solo'}</td>
        </tr>"""

    pies_html = ""
    for p in pie_summaries:
        color = "#16a34a" if p["gain_pct"] >= 0 else "#dc2626"
        pies_html += f"""
        <tr>
          <td style="padding:8px 12px;font-weight:600">{p['name']}</td>
          <td style="padding:8px 12px">£{p['value']:.2f}</td>
          <td style="padding:8px 12px;color:{color}">{p['gain_pct']:+.1f}%</td>
          <td style="padding:8px 12px">{p['holdings']} holdings</td>
        </tr>"""

    alerts_html = ""
    for a in alerts:
        icon = {"dip":"🔴","buy":"💡","trim":"💰","rebalance":"⚖️","growth":"📉"}.get(a["type"],"📌")
        alerts_html += f'<div style="margin:8px 0;padding:10px 14px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:4px"><strong>{icon} {a["title"]}</strong><br><span style="font-size:13px;color:#374151">{a["body"]}</span></div>'

    if not alerts_html:
        alerts_html = '<div style="color:#6b7280;font-size:13px">No alerts this run — all positions within thresholds.</div>'

    return f"""
    <html><body style="font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;color:#111">
    <div style="background:#0f172a;color:#f8fafc;padding:20px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0;font-size:18px">📊 T212 Portfolio Monitor</h2>
      <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">{now} · Cash: £{cash:.2f} · Total: £{total:.2f}</p>
    </div>

    <div style="padding:20px 0">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 10px">Alerts</h3>
      {alerts_html}
    </div>

    <div style="padding:20px 0">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 10px">Pies</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left">Pie</th>
          <th style="padding:8px 12px;text-align:left">Value</th>
          <th style="padding:8px 12px;text-align:left">Return</th>
          <th style="padding:8px 12px;text-align:left">Holdings</th>
        </tr></thead>
        <tbody>{pies_html}</tbody>
      </table>
    </div>

    <div style="padding:20px 0">
      <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 10px">All Positions</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px 12px;text-align:left">Ticker</th>
          <th style="padding:8px 12px;text-align:left">Price</th>
          <th style="padding:8px 12px;text-align:left">Gain</th>
          <th style="padding:8px 12px;text-align:left">From High</th>
          <th style="padding:8px 12px;text-align:left">P&L</th>
          <th style="padding:8px 12px;text-align:left">Type</th>
        </tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
    </div>

    <div style="padding:12px 0;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb">
      Thresholds: Dip {DIP_FROM_HIGH_PCT}% · Buy {BUY_SIGNAL_PCT}% · Trim {TRIM_GAIN_PCT}% · Rebalance {REBALANCE_DRIFT_PCT}% · Target {ANNUAL_GROWTH_PCT}%pa
    </div>
    </body></html>"""


def save_docs_data(summary_rows, pie_summaries, alerts, account, state):
    """Write JSON for the docs page to consume."""
    now = datetime.now(timezone.utc).isoformat()
    data = {
        "updated": now,
        "account": account,
        "positions": summary_rows,
        "pies": pie_summaries,
        "alerts": [{"type": a["type"], "title": a["title"], "body": a["body"]} for a in alerts],
        "highs": state["highs"],
        "run_count": state.get("run_count", 0),
        "target_annual_pct": ANNUAL_GROWTH_PCT,
    }
    os.makedirs("docs", exist_ok=True)
    with open("docs/data.json", "w") as f:
        json.dump(data, f, indent=2)
    print("[docs] data.json updated")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*60}")
    print(f"T212 Monitor — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print('='*60)

    state = load_state()
    state["run_count"] = state.get("run_count", 0) + 1
    run_count = state["run_count"]

    # Fetch data
    print("[fetch] account...")
    account = fetch_account()
    print("[fetch] positions...")
    positions = fetch_positions()
    print("[fetch] pies...")
    pies = fetch_pies()

    if not positions and not pies:
        print("[warn] No data returned — check API key scopes")
        return

    # Update rolling highs
    state = update_highs(state, positions)

    # Run analysis
    pos_alerts, summary_rows = analyse_positions(positions, state)
    pie_alerts, pie_summaries, state = analyse_pies(pies, state)
    growth_alerts, state = check_annual_growth(account, summary_rows, state)

    all_alerts = pos_alerts + pie_alerts + growth_alerts
    print(f"[analysis] {len(all_alerts)} alerts | {len(summary_rows)} positions | {len(pie_summaries)} pies")

    # Fire ntfy push for each alert
    for alert in all_alerts:
        if not alert_cooldown(state, alert["key"]):
            send_ntfy(alert["title"], alert["body"], alert.get("priority", "default"))
            mark_alerted(state, alert["key"])
            time.sleep(1)

    # Email — always on first run, then every 6 runs (every ~90 min if 15min schedule)
    # or when there are alerts
    send_mail = (run_count == 1) or (run_count % 6 == 0) or len(all_alerts) > 0
    if send_mail:
        subject = f"T212 Monitor — {len(all_alerts)} alert(s) · {datetime.now(timezone.utc).strftime('%d %b %H:%M')}"
        html = build_email_html(summary_rows, pie_summaries, all_alerts, account)
        send_email(subject, html)

    # Save docs data
    save_docs_data(summary_rows, pie_summaries, all_alerts, account, state)

    # Persist state
    save_state(state)
    print("[done] State saved.")


if __name__ == "__main__":
    main()
