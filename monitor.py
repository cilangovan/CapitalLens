"""
Trading 212 Portfolio Monitor v2
Monitors pies + individual positions, tags positions to their pie
"""

import os
import json
import time
import smtplib
import urllib.request
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

DIP_FROM_HIGH_PCT   = 8.0
BUY_SIGNAL_PCT      = 12.0
TRIM_GAIN_PCT       = 40.0
REBALANCE_DRIFT_PCT = 5.0
ANNUAL_GROWTH_PCT   = 15.0

T212_BASE  = "https://live.trading212.com"
STATE_FILE = "portfolio_state.json"

# ── API ───────────────────────────────────────────────────────────────────────

def t212_get(path):
    import base64
    creds = base64.b64encode(f"{T212_API_KEY}:{T212_API_SECRET}".encode()).decode()
    req = urllib.request.Request(
        f"{T212_BASE}{path}",
        headers={"Authorization": f"Basic {creds}", "Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[T212] HTTP {e.code} on {path}: {e.read().decode()}")
        return None
    except Exception as e:
        print(f"[T212] Error on {path}: {e}")
        return None

def rl():
    time.sleep(2)

# ── Fetchers ──────────────────────────────────────────────────────────────────

def fetch_account():
    d = t212_get("/api/v0/equity/account/cash"); rl(); return d

def fetch_positions():
    d = t212_get("/api/v0/equity/portfolio"); rl(); return d or []

def fetch_pies_with_instruments():
    """
    Returns:
      pies       — list of pie summary dicts
      pie_map    — {ticker: pie_name} for every instrument in every pie
    """
    raw = t212_get("/api/v0/equity/pies"); rl()
    if not raw:
        print("[warn] No pies returned — check pies:read scope on API key")
        return [], {}

    pies     = []
    pie_map  = {}   # ticker -> pie name

    for p in raw:
        pie_id = p.get("id")
        detail = t212_get(f"/api/v0/equity/pies/{pie_id}"); rl()
        if not detail:
            continue

        name        = detail.get("settings", {}).get("name", f"Pie {pie_id}")
        instruments = detail.get("instruments", [])
        total_val   = sum(float(i.get("currentValue", 0)) for i in instruments)
        pie_result  = detail.get("result", {})
        gain_pct    = float(pie_result.get("priceAvgReturnPercentage", 0))

        # Tag every instrument ticker to this pie
        for inst in instruments:
            t = inst.get("ticker", "")
            if t:
                pie_map[t] = name

        # Drift check per instrument
        drifts = []
        for inst in instruments:
            t           = inst.get("ticker", "")
            cur_val     = float(inst.get("currentValue", 0))
            actual_pct  = (cur_val / total_val * 100) if total_val > 0 else 0
            target_pct  = float(inst.get("expectedShare", inst.get("ownedQuantity", actual_pct)))
            drift       = abs(actual_pct - target_pct)
            if drift >= REBALANCE_DRIFT_PCT:
                drifts.append(f"{t}: {drift:.1f}%")

        pies.append({
            "id":       pie_id,
            "name":     name,
            "value":    round(total_val, 2),
            "gain_pct": round(gain_pct, 2),
            "holdings": len(instruments),
            "drifts":   drifts,
            "instruments": [
                {
                    "ticker":    inst.get("ticker", ""),
                    "value":     round(float(inst.get("currentValue", 0)), 2),
                    "shares":    float(inst.get("ownedQuantity", 0)),
                }
                for inst in instruments
            ],
        })

    print(f"[fetch] {len(pies)} pies, {len(pie_map)} tickers mapped to pies")
    return pies, pie_map

# ── State ─────────────────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"highs": {}, "last_alerts": {}, "run_count": 0, "first_run_date": None}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def update_highs(state, positions):
    for pos in positions:
        t = pos.get("ticker", "")
        c = float(pos.get("currentPrice", 0))
        if c > 0:
            state["highs"][t] = max(state["highs"].get(t, 0), c)
    return state

def cooldown(state, key, hours=4):
    return (time.time() - state["last_alerts"].get(key, 0)) < (hours * 3600)

def mark(state, key):
    state["last_alerts"][key] = time.time()

# ── Analysis ──────────────────────────────────────────────────────────────────

def analyse(positions, pies, pie_map, state):
    alerts      = []
    summary     = []

    for pos in positions:
        ticker    = pos.get("ticker", "UNKNOWN")
        avg       = float(pos.get("averagePrice", 0))
        current   = float(pos.get("currentPrice", 0))
        ppl       = float(pos.get("ppl", 0))

        if current == 0 or avg == 0:
            continue

        gain_pct      = ((current - avg) / avg) * 100
        high          = state["highs"].get(ticker, current)
        dip_from_high = ((high - current) / high) * 100 if high > 0 else 0

        # Resolve pie membership — try direct ticker match first,
        # then strip Trading 212 suffixes (_US_EQ, l_EQ, d_EQ …)
        pie_name = pie_map.get(ticker)
        if not pie_name:
            # strip suffix variants
            for suffix in ("_US_EQ", "l_EQ", "d_EQ", "_EQ"):
                if ticker.endswith(suffix) or suffix in ticker:
                    base = ticker.split(suffix)[0]
                    pie_name = pie_map.get(base)
                    if pie_name:
                        break
        # Also try matching the base ticker against pie_map keys
        if not pie_name:
            base = ticker.split("_")[0]
            for k, v in pie_map.items():
                if k.startswith(base):
                    pie_name = v
                    break

        summary.append({
            "ticker":        ticker,
            "display":       ticker.split("_")[0],  # clean display name
            "current":       current,
            "avg":           avg,
            "gain_pct":      round(gain_pct, 2),
            "dip_from_high": round(dip_from_high, 2),
            "ppl":           round(ppl, 2),
            "pie":           pie_name or "Solo holdings",
        })

        # Dip alert
        if dip_from_high >= DIP_FROM_HIGH_PCT:
            key = f"dip_{ticker}"
            if not cooldown(state, key, 6):
                sev = "🔴 STRONG DIP" if dip_from_high >= BUY_SIGNAL_PCT else "🟡 DIP"
                alerts.append({"type":"dip","ticker":ticker,"key":key,"priority":"high" if dip_from_high>=BUY_SIGNAL_PCT else "default",
                    "title":f"{sev} — {ticker.split('_')[0]}",
                    "body":f"Down {dip_from_high:.1f}% from recent high · now £{current:.2f} · avg £{avg:.2f}"})
            if dip_from_high >= BUY_SIGNAL_PCT:
                key2 = f"buy_{ticker}"
                if not cooldown(state, key2, 6):
                    alerts.append({"type":"buy","ticker":ticker,"key":key2,"priority":"high",
                        "title":f"💡 BUY — {ticker.split('_')[0]}",
                        "body":f"Dip of {dip_from_high:.1f}% from high — potential entry at £{current:.2f}"})

        # Trim
        if gain_pct >= TRIM_GAIN_PCT:
            key = f"trim_{ticker}"
            if not cooldown(state, key, 24):
                alerts.append({"type":"trim","ticker":ticker,"key":key,"priority":"default",
                    "title":f"💰 TRIM — {ticker.split('_')[0]}",
                    "body":f"Up {gain_pct:.1f}% from avg · £{avg:.2f} → £{current:.2f} · consider partial sell"})

    # Pie rebalance alerts
    for pie in pies:
        if pie["drifts"]:
            key = f"rebalance_{pie['name']}"
            if not cooldown(state, key, 12):
                alerts.append({"type":"rebalance","ticker":pie["name"],"key":key,"priority":"default",
                    "title":f"⚖️ REBALANCE — {pie['name']}",
                    "body":f"Drift detected: {', '.join(pie['drifts'])}. Rebalance in Trading 212."})

    return alerts, summary

# ── Notifications ─────────────────────────────────────────────────────────────

def send_ntfy(title, body, priority="default"):
    pm = {"high":"urgent","default":"default","low":"low"}
    req = urllib.request.Request(NTFY_URL, data=body.encode(),
        headers={"Title":title,"Priority":pm.get(priority,"default"),"Tags":"chart_with_upwards_trend"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"[ntfy] {title}")
    except Exception as e:
        print(f"[ntfy] Error: {e}")

def send_email(subject, html):
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject; msg["From"] = GMAIL_USER; msg["To"] = GMAIL_USER
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(GMAIL_USER, GMAIL_APP_PASS)
            s.sendmail(GMAIL_USER, GMAIL_USER, msg.as_string())
        print(f"[email] {subject}")
    except Exception as e:
        print(f"[email] Error: {e}")

def build_email(summary, pies, alerts, account):
    now   = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    cash  = float((account or {}).get("free", 0))
    total = float((account or {}).get("total", 0))

    # Group positions by pie
    groups = {}
    for r in summary:
        groups.setdefault(r["pie"], []).append(r)

    groups_html = ""
    for grp_name, rows in sorted(groups.items()):
        grp_total = sum(r["ppl"] for r in rows)
        gc = "#16a34a" if grp_total >= 0 else "#dc2626"
        rows_html = ""
        for r in sorted(rows, key=lambda x: x["gain_pct"], reverse=True):
            c = "#16a34a" if r["gain_pct"] >= 0 else "#dc2626"
            dc = "#dc2626" if r["dip_from_high"] >= DIP_FROM_HIGH_PCT else "#6b7280"
            rows_html += f"""<tr>
              <td style="padding:7px 12px;font-weight:600">{r['display']}</td>
              <td style="padding:7px 12px">£{r['current']:.2f}</td>
              <td style="padding:7px 12px;color:{c}">{r['gain_pct']:+.1f}%</td>
              <td style="padding:7px 12px;color:{c}">£{r['ppl']:+.2f}</td>
              <td style="padding:7px 12px;color:{dc}">{r['dip_from_high']:.1f}%↓</td>
            </tr>"""
        groups_html += f"""
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#1e293b;border-radius:6px 6px 0 0">
            <span style="font-weight:700;color:#f1f5f9">{grp_name}</span>
            <span style="font-weight:700;color:{gc}">P&L {'+' if grp_total>=0 else ''}£{grp_total:.2f}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#0f172a">
            <thead><tr style="background:#1a2744">
              <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:500">Ticker</th>
              <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:500">Price</th>
              <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:500">Gain</th>
              <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:500">P&L</th>
              <th style="padding:6px 12px;text-align:left;color:#64748b;font-weight:500">From High</th>
            </tr></thead>
            <tbody>{rows_html}</tbody>
          </table>
        </div>"""

    alerts_html = ""
    for a in alerts:
        alerts_html += f'<div style="margin:6px 0;padding:10px 14px;background:#1e293b;border-left:3px solid #f59e0b;border-radius:4px;color:#f1f5f9"><strong>{a["title"]}</strong><br><span style="font-size:12px;color:#94a3b8">{a["body"]}</span></div>'
    if not alerts_html:
        alerts_html = '<div style="color:#64748b;font-size:13px">No alerts — all positions within thresholds.</div>'

    return f"""<html><body style="background:#060a14;font-family:system-ui,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#f1f5f9">
    <div style="background:#0f172a;border:1px solid #1a2744;border-radius:10px;padding:20px 24px;margin-bottom:20px">
      <h2 style="margin:0 0 4px;font-size:17px">📊 T212 Portfolio Monitor</h2>
      <p style="margin:0;font-size:12px;color:#64748b">{now} · Cash £{cash:.2f} · Total £{total:.2f}</p>
    </div>
    <div style="margin-bottom:20px">
      <h3 style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px">Alerts</h3>
      {alerts_html}
    </div>
    <div>
      <h3 style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px">Positions by pie</h3>
      {groups_html}
    </div>
    <div style="margin-top:16px;font-size:11px;color:#334155;border-top:1px solid #1a2744;padding-top:12px">
      Dip {DIP_FROM_HIGH_PCT}% · Buy {BUY_SIGNAL_PCT}% · Trim {TRIM_GAIN_PCT}% · Rebalance {REBALANCE_DRIFT_PCT}% · Target {ANNUAL_GROWTH_PCT}%pa
    </div>
    </body></html>"""

def save_docs(summary, pies, alerts, account, state):
    data = {
        "updated":          datetime.now(timezone.utc).isoformat(),
        "account":          account,
        "positions":        summary,
        "pies":             pies,
        "alerts":           [{"type":a["type"],"title":a["title"],"body":a["body"]} for a in alerts],
        "highs":            state["highs"],
        "run_count":        state.get("run_count", 0),
        "target_annual_pct": ANNUAL_GROWTH_PCT,
    }
    os.makedirs("docs", exist_ok=True)
    with open("docs/data.json", "w") as f:
        json.dump(data, f, indent=2)
    print("[docs] data.json written")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*55}\nT212 Monitor — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n{'='*55}")

    state = load_state()
    state["run_count"] = state.get("run_count", 0) + 1

    account   = fetch_account()
    positions = fetch_positions()
    pies, pie_map = fetch_pies_with_instruments()

    if not positions:
        print("[warn] No positions — check API key scopes"); return

    state = update_highs(state, positions)

    alerts, summary = analyse(positions, pies, pie_map, state)

    print(f"[done] {len(alerts)} alerts · {len(summary)} positions · {len(pies)} pies")

    for a in alerts:
        if not cooldown(state, a["key"]):
            send_ntfy(a["title"], a["body"], a.get("priority","default"))
            mark(state, a["key"])
            time.sleep(1)

    send_mail = (state["run_count"] == 1) or (state["run_count"] % 6 == 0) or len(alerts) > 0
    if send_mail:
        subj = f"T212 · {len(alerts)} alert(s) · {datetime.now(timezone.utc).strftime('%d %b %H:%M')}"
        send_email(subj, build_email(summary, pies, alerts, account))

    save_docs(summary, pies, alerts, account, state)
    save_state(state)

if __name__ == "__main__":
    main()
