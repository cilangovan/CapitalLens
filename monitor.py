"""
Trading 212 Portfolio Monitor v6
- Supabase backend (no data.json with sensitive data)
- Full history stored per run
- ntfy + Gmail alerts
- Local dev: uses .env file
- GitHub Actions: uses secrets
"""

import os, json, time, smtplib, urllib.request, urllib.error, base64
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import html as _html
from services.alert_format import Section, render_text, render_push, friendly, pct, money, day_month

# Load .env for local dev (ignored in GitHub Actions where secrets are set directly)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Config ────────────────────────────────────────────────────────────────────
T212_API_KEY    = os.environ["T212_API_KEY"]
T212_API_SECRET = os.environ["T212_API_SECRET"]
GMAIL_USER      = os.environ["GMAIL_USER"]
GMAIL_APP_PASS  = os.environ["GMAIL_APP_PASS"]
NTFY_TOPIC      = os.environ.get("NTFY_TOPIC", "hoop-t212-x7k29")
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]
NTFY_URL        = f"https://ntfy.sh/{NTFY_TOPIC}"

DIP_FROM_HIGH_PCT   = 8.0
BUY_SIGNAL_PCT      = 12.0
TRIM_GAIN_PCT       = 40.0
REBALANCE_DRIFT_PCT = 5.0
ANNUAL_GROWTH_PCT   = 15.0

T212_BASE  = "https://live.trading212.com"
STATE_FILE = "portfolio_state.json"

# ── Supabase helpers ──────────────────────────────────────────────────────────

def sb_request(method, table, data=None, params=None):
    """Generic Supabase REST API call."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "return=representation",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result
    except urllib.error.HTTPError as e:
        print(f"[supabase] HTTP {e.code} on {table}: {e.read().decode()}")
        return None
    except Exception as ex:
        print(f"[supabase] Error on {table}: {ex}")
        return None

def sb_insert(table, data):
    return sb_request("POST", table, data)

def sb_select(table, params=None):
    return sb_request("GET", table, params=params)

def save_snapshot_to_supabase(summary, pies, alerts, account, state):
    """Save full portfolio snapshot to Supabase."""
    acc       = account or {}
    total     = float(acc.get("total", 0))
    cash      = float(acc.get("free", 0))
    # Trading 212's own split: investments value = cost basis + unrealised result
    # (total - free cash would also count cash reserved for pending orders and pie cash)
    if acc.get("invested") is not None:
        invested  = float(acc["invested"]) + float(acc.get("ppl") or 0)
        total_ppl = float(acc.get("ppl") or 0)
    else:
        invested  = total - cash
        total_ppl = sum(p["ppl"] for p in summary)

    snap_row = {
        "total_value": round(total, 2),
        "cash":        round(cash, 2),
        "invested":    round(invested, 2),
        "total_ppl":   round(total_ppl, 2),
        "run_count":   state.get("run_count", 0),
        "raw": {
            "pies":    pies,
            "account": acc,
            "highs":   state.get("highs", {}),
            "instrument_meta": state.get("held_meta", {}),
        }
    }
    pos_fields = [{
        "ticker":       p["ticker"],
        "display":      p["display"],
        "pie":          p["pie"],
        "exchange":     p.get("exchange", "LSE"),
        "current_price": p["current"],
        "avg_price":    p["avg"],
        "gain_pct":     p["gain_pct"],
        "dip_from_high": p["dip_from_high"],
        "ppl":          p["ppl"],
        "quantity":     p.get("qty"),
    } for p in summary]
    alert_fields = [{
        "type":   a["type"],
        "alert_type": a["type"],
        "ticker": a.get("ticker", ""),
        "title":  a["title"],
        "body":   a["body"],
    } for a in alerts]

    # Preferred: snapshot + positions + alerts in ONE database transaction (db/tenant/25_refresh_safety.sql). The dashboards read positions by the
    # latest snapshot id, so a run killed between separate inserts must never leave a snapshot without its positions.
    sid = sb_request("POST", "rpc/save_snapshot", {"p_snapshot": snap_row, "p_positions": pos_fields, "p_alerts": alert_fields})
    if isinstance(sid, int) and not isinstance(sid, bool):
        print(f"[supabase] Snapshot saved id={sid} with {len(pos_fields)} positions and {len(alert_fields)} alerts (one transaction)")
        return
    print("[supabase] save_snapshot() not available - falling back to separate inserts")

    # Fallback (function not deployed yet): the old three-step save
    # 1. Insert snapshot
    snap = sb_insert("portfolio_snapshots", snap_row)

    if not snap:
        print("[supabase] Failed to insert snapshot"); return

    snapshot_id = snap[0]["id"] if isinstance(snap, list) else snap.get("id")
    print(f"[supabase] Snapshot saved id={snapshot_id}")

    # 2. Insert positions (batch)
    if summary and snapshot_id:
        pos_rows = [{
            "snapshot_id":  snapshot_id,
            "ticker":       p["ticker"],
            "display":      p["display"],
            "pie":          p["pie"],
            "exchange":     p.get("exchange", "LSE"),
            "current_price": p["current"],
            "avg_price":    p["avg"],
            "gain_pct":     p["gain_pct"],
            "dip_from_high": p["dip_from_high"],
            "ppl":          p["ppl"],
            "quantity":     p.get("qty"),
        } for p in summary]
        sb_insert("positions", pos_rows)
        print(f"[supabase] {len(pos_rows)} positions saved")

    # 3. Insert alerts
    if alerts:
        alert_rows = [{
            "type":   a["type"],
            "alert_type": a["type"],
            "ticker": a.get("ticker", ""),
            "title":  a["title"],
            "body":   a["body"],
        } for a in alerts]
        sb_insert("alerts", alert_rows)
        print(f"[supabase] {len(alert_rows)} alerts saved")

def fetch_latest_snapshot():
    """Fetch most recent snapshot for dashboard."""
    return sb_select("portfolio_snapshots", {
        "select": "*",
        "order":  "created_at.desc",
        "limit":  "1",
    })

def fetch_latest_positions(snapshot_id):
    """Fetch positions for a snapshot."""
    return sb_select("positions", {
        "snapshot_id": f"eq.{snapshot_id}",
        "select":      "*",
    })

def fetch_recent_alerts(limit=20):
    """Fetch recent alerts."""
    return sb_select("alerts", {
        "select": "*",
        "order":  "created_at.desc",
        "limit":  str(limit),
    })

def fetch_history(limit=30):
    """Fetch portfolio value history for chart."""
    return sb_select("portfolio_snapshots", {
        "select": "created_at,total_value,cash,total_ppl",
        "order":  "created_at.desc",
        "limit":  str(limit),
    })

# ── T212 API ──────────────────────────────────────────────────────────────────

def t212_get(path, retries=4, base_wait=12):
    creds = base64.b64encode(f"{T212_API_KEY}:{T212_API_SECRET}".encode()).decode()
    for attempt in range(retries):
        req = urllib.request.Request(
            f"{T212_BASE}{path}",
            headers={"Authorization": f"Basic {creds}", "Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code == 429:
                wait = base_wait * (2 ** attempt)
                print(f"[T212] 429 on {path} — waiting {wait}s (attempt {attempt+1}/{retries})")
                time.sleep(wait)
            else:
                print(f"[T212] HTTP {e.code} on {path}: {body}")
                return None
        except Exception as ex:
            print(f"[T212] Error on {path}: {ex}")
            return None
    print(f"[T212] Gave up on {path} after {retries} retries")
    return None

def rl(secs=5): time.sleep(secs)

def fetch_account():
    d = t212_get("/api/v0/equity/account/cash"); rl(); return d

def fetch_positions():
    d = t212_get("/api/v0/equity/portfolio"); rl(); return d or []

def fetch_instrument_meta(state, held):
    """Currency + name per held ticker (T212 metadata, cached 7 days in state)."""
    cache = state.get("instrument_meta_cache") or {}
    fresh = (time.time() - cache.get("ts", 0) < 7 * 86400) and state.get("instruments_synced_ts")
    missing = [t for t in held if t not in cache.get("data", {})]
    if not fresh or missing:
        rows = t212_get("/api/v0/equity/metadata/instruments", retries=3, base_wait=55); rl(5)
        if rows:
            cache = {"ts": time.time(), "data": {
                r["ticker"]: {"ccy": r.get("currencyCode"), "name": r.get("shortName") or r.get("name")}
                for r in rows if r.get("ticker")}}
            state["instrument_meta_cache"] = cache
            print(f"[fetch] instrument metadata: {len(cache['data'])} instruments")
            sync_instruments(rows, state)
    data = cache.get("data", {})
    state["held_meta"] = {t: data[t] for t in held if t in data}
    return state["held_meta"]

def exchange_of(ticker):
    t = ticker or ""
    if t.endswith("_US_EQ"): return "NASDAQ/NYSE"
    if t.endswith("l_EQ"):   return "LSE"
    if t.endswith("d_EQ"):   return "XETRA"
    if t.endswith("a_EQ"):   return "AMS"
    return None

def sync_instruments(rows, state):
    """Searchable universe for the dashboard watchlist: stocks + ETFs on the exchanges you use."""
    out = []
    for r in rows or []:
        ex = exchange_of(r.get("ticker"))
        if not ex or r.get("type") not in ("STOCK", "ETF"): continue
        out.append({"ticker": r["ticker"], "name": r.get("name"), "short_name": r.get("shortName"),
                    "currency": r.get("currencyCode"), "type": r.get("type"), "isin": r.get("isin"),
                    "exchange": ex, "synced_at": datetime.now(timezone.utc).isoformat()})
    ok = 0
    for i in range(0, len(out), 1000):
        req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/instruments?on_conflict=ticker",
            data=json.dumps(out[i:i+1000]).encode(), method="POST",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                     "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
        try:
            urllib.request.urlopen(req, timeout=60); ok += len(out[i:i+1000])
        except urllib.error.HTTPError as e:
            print(f"[instruments] HTTP {e.code}: {e.read().decode()[:200]}")
    if ok:
        state["instruments_synced_ts"] = time.time()
    print(f"[instruments] synced {ok}/{len(out)} searchable instruments")

def unit_price(price, ccy):
    """T212 quotes some LSE lines in pence (GBX). Returns (value, currency)."""
    if ccy in ("GBX", "GBp"): return price / 100, "GBP"
    return price, (ccy or "GBP")

def fetch_pies_with_instruments():
    raw = t212_get("/api/v0/equity/pies"); rl(5)
    if not raw:
        print("[warn] No pies — check pies:read scope"); return [], {}
    pies, pie_map = [], {}
    for i, p in enumerate(raw):
        pie_id = p.get("id")
        print(f"[fetch] pie {i+1}/{len(raw)} id={pie_id}")
        detail = t212_get(f"/api/v0/equity/pies/{pie_id}", retries=5, base_wait=15)
        rl(8)
        if not detail:
            print(f"[warn] Skipping pie {pie_id}"); continue
        name        = (detail.get("settings", {}).get("name") or f"Pie {pie_id}").strip()
        instruments = detail.get("instruments", [])
        def _inst_val(inst):
            # T212 pie detail: value lives in result.priceAvgValue (no currentValue field)
            r = inst.get("result") or {}
            return float(r.get("priceAvgValue", inst.get("currentValue", 0)) or 0)
        total_val   = sum(_inst_val(inst) for inst in instruments)
        invested    = sum(float((inst.get("result") or {}).get("priceAvgInvestedValue", 0) or 0) for inst in instruments)
        gain_pct    = ((total_val - invested) / invested * 100) if invested > 0 else 0.0
        for inst in instruments:
            t = inst.get("ticker", "")
            if t: pie_map[t] = name
        drifts = []
        for inst in (instruments if total_val > 0 else []):   # unfunded pie → no drift
            cur_val    = _inst_val(inst)
            actual_pct = (cur_val / total_val * 100) if total_val > 0 else 0
            exp        = inst.get("expectedShare")
            # expectedShare is a 0–1 fraction
            target_pct = float(exp) * 100 if exp is not None else actual_pct
            if abs(actual_pct - target_pct) >= REBALANCE_DRIFT_PCT:
                drifts.append(f"{inst.get('ticker','')}: {abs(actual_pct-target_pct):.1f}%")
        targets = [{
            "ticker":   inst.get("ticker", ""),
            "expected": inst.get("expectedShare"),
            "current":  inst.get("currentShare"),
            "qty":      inst.get("ownedQuantity"),
            "result":   inst.get("result"),
        } for inst in instruments]
        pies.append({
            "id": pie_id, "name": name, "value": round(total_val, 2), "instruments": targets,
            "gain_pct": round(gain_pct, 2), "holdings": len(instruments), "drifts": drifts,
        })
    print(f"[fetch] {len(pies)} pies, {len(pie_map)} tickers mapped")
    return pies, pie_map

# ── State ─────────────────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f: return json.load(f)
    return {"highs":{}, "last_alerts":{}, "run_count":0}

def save_state(state):
    with open(STATE_FILE,"w") as f: json.dump(state, f, indent=2)

def update_highs(state, positions):
    for pos in positions:
        t = pos.get("ticker",""); c = float(pos.get("currentPrice",0))
        if c > 0: state["highs"][t] = max(state["highs"].get(t,0), c)
    return state

def cooldown(state, key, hours=4):
    return (time.time() - state["last_alerts"].get(key,0)) < (hours*3600)

def mark(state, key):
    state["last_alerts"][key] = time.time()

def resolve_pie(ticker, pie_map):
    if ticker in pie_map: return pie_map[ticker]
    base = ticker.split("_")[0]
    for k, v in pie_map.items():
        if k.startswith(base) or k.split("_")[0] == base: return v
    return "Solo holdings"

def resolve_exchange(ticker):
    """Infer exchange from T212 ticker suffix.
    _US_EQ  → NASDAQ/NYSE  (14:30–21:00 UTC)
    l_EQ    → LSE           (08:00–16:30 UTC)
    d_EQ    → XETRA         (08:00–16:30 UTC)
    a_EQ    → Euronext AMS  (08:00–16:30 UTC)
    """
    t = ticker.upper()
    if "_US_EQ" in t:                   return "NASDAQ/NYSE"
    if t.endswith("L_EQ"):              return "LSE"
    if t.endswith("D_EQ"):              return "XETRA"
    if t.endswith("A_EQ"):              return "AMS"
    return "LSE"  # safe default for UK-listed ETFs

# ── Analysis ──────────────────────────────────────────────────────────────────

def _price_section(title, ticker, meta, cur, avg, high, gain_pct, dip, pie_name, exchange, note):
    m = meta.get(ticker) or {}
    ccy = m.get("ccy")
    s = Section(title)
    if ccy:
        c, u = unit_price(cur, ccy); h, _ = unit_price(high, ccy); a, _ = unit_price(avg, ccy)
        rows = [(f"Live {u} price", money(c, u)), ("Tracked high", money(h, u)),
                ("Drawdown from tracked high", pct(-dip)), ("Your average cost", money(a, u)),
                ("Gain vs your average cost", pct(gain_pct))]
    else:
        rows = [("Drawdown from tracked high", pct(-dip)), ("Gain vs your average cost", pct(gain_pct))]
    s.table("Measure", "Result", rows + [("Pie", pie_name), ("Exchange", exchange)])
    now = datetime.now(timezone.utc)
    src = f"Source: Trading 212 live quote, {day_month(now)} {now.strftime('%H:%M')} UTC."
    if not ccy:
        src += " Quote currency not verified, so prices are not shown."
    s.line(src)
    s.line(f"Review flag: {note}")
    return s

def analyse(positions, pies, pie_map, state):
    alerts, summary = [], []
    meta = state.get("held_meta", {})
    for pos in positions:
        ticker = pos.get("ticker","UNKNOWN")
        avg    = float(pos.get("averagePrice",0))
        cur    = float(pos.get("currentPrice",0))
        ppl    = float(pos.get("ppl",0))
        if cur == 0 or avg == 0: continue
        gain_pct      = ((cur - avg) / avg) * 100
        high          = state["highs"].get(ticker, cur)
        dip_from_high = ((high - cur) / high) * 100 if high > 0 else 0
        pie_name      = resolve_pie(ticker, pie_map)
        exchange      = resolve_exchange(ticker)
        display       = ticker.split("_")[0]
        label         = friendly(ticker, (meta.get(ticker) or {}).get("name"))
        summary.append({"ticker":ticker,"display":display,"current":cur,"avg":avg,
            "qty":float(pos.get("quantity",0) or 0),
            "gain_pct":round(gain_pct,2),"dip_from_high":round(dip_from_high,2),
            "ppl":round(ppl,2),"pie":pie_name,"exchange":exchange})
        args = (ticker, meta, cur, avg, high, gain_pct, dip_from_high, pie_name, exchange)
        if dip_from_high >= BUY_SIGNAL_PCT:
            key = f"buy_{ticker}"
            if not cooldown(state, key, 6):
                sec = _price_section(f"{label} — deep-dip threshold crossed", *args,
                    note="Check the daily report for its weight vs target first. "
                         "A large fall does not automatically make it a good entry.")
                alerts.append({"type":"buy","ticker":display,"key":key,"priority":"high",
                    "title":f"🔴 {label} — down {dip_from_high:.1f}% from tracked high",
                    "body":render_text([sec]), "push":render_push([sec])})
        elif dip_from_high >= DIP_FROM_HIGH_PCT:
            key = f"dip_{ticker}"
            if not cooldown(state, key, 6):
                sec = _price_section(f"{label} — dip threshold crossed", *args,
                    note="Watch only for now; review the news and analyst view before adding.")
                alerts.append({"type":"dip","ticker":display,"key":key,"priority":"default",
                    "title":f"🟡 {label} — down {dip_from_high:.1f}% from tracked high",
                    "body":render_text([sec]), "push":render_push([sec])})
        if gain_pct >= TRIM_GAIN_PCT:
            key = f"trim_{ticker}"
            if not cooldown(state, key, 24):
                sec = _price_section(f"{label} — profit target crossed", *args,
                    note=f"Up {gain_pct:.1f}% on your average cost. Consider booking part of the profit "
                         f"(see the Profit Booking tab).")
                alerts.append({"type":"trim","ticker":display,"key":key,"priority":"default",
                    "title":f"💰 {label} — up {gain_pct:.1f}% on your cost",
                    "body":render_text([sec]), "push":render_push([sec])})
    # Weight vs target is reported once a day by services/alert_service (no intraday spam)
    return alerts, summary

# ── Notifications ─────────────────────────────────────────────────────────────

def send_ntfy(title, body, priority="default"):
    pm = {"high":"urgent","default":"default","low":"low"}
    req = urllib.request.Request(NTFY_URL, data=body.encode(),
        headers={"Title":"=?UTF-8?B?"+base64.b64encode(title.encode()).decode()+"?=","Priority":pm.get(priority,"default"),"Tags":"chart_with_upwards_trend"},
        method="POST")
    try:
        urllib.request.urlopen(req, timeout=10)
        print(f"[ntfy] {title}")
    except Exception as e: print(f"[ntfy] Error: {e}")

def send_email(subject, html):
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject; msg["From"] = GMAIL_USER; msg["To"] = GMAIL_USER
        msg.attach(MIMEText(html,"html"))
        with smtplib.SMTP_SSL("smtp.gmail.com",465) as s:
            s.login(GMAIL_USER, GMAIL_APP_PASS)
            s.sendmail(GMAIL_USER, GMAIL_USER, msg.as_string())
        print(f"[email] {subject}")
    except Exception as e: print(f"[email] Error: {e}")

def build_email(summary, pies, alerts, account):
    now   = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    cash  = float((account or {}).get("free",0))
    total = float((account or {}).get("total",0))
    groups = {}
    for r in summary: groups.setdefault(r["pie"], []).append(r)
    groups_html = ""
    for grp_name, rows in sorted(groups.items(), key=lambda x: (x[0]=="Solo holdings", x[0])):
        grp_pl = sum(r["ppl"] for r in rows)
        gc = "#00d084" if grp_pl >= 0 else "#ff4757"
        rows_html = "".join(f"""<tr>
          <td style="padding:7px 12px;font-weight:600;color:#e8edf5">{r['display']}</td>
          <td style="padding:7px 12px;color:#94a3b8">£{r['current']:.2f}</td>
          <td style="padding:7px 12px;color:{'#00d084' if r['gain_pct']>=0 else '#ff4757'}">{r['gain_pct']:+.1f}%</td>
          <td style="padding:7px 12px;color:{'#00d084' if r['ppl']>=0 else '#ff4757'}">£{r['ppl']:+.2f}</td>
          <td style="padding:7px 12px;color:{'#ff4757' if r['dip_from_high']>=8 else '#64748b'}">{r['dip_from_high']:.1f}%↓</td>
        </tr>""" for r in sorted(rows, key=lambda x: x["gain_pct"], reverse=True))
        groups_html += f"""<div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;padding:10px 14px;background:#1a2744;border-radius:6px 6px 0 0;border-left:3px solid {gc}">
            <span style="font-weight:700;color:#e8edf5">{grp_name}</span>
            <span style="font-weight:700;color:{gc}">{'+' if grp_pl>=0 else ''}£{grp_pl:.2f}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#0d1526">
              <th style="padding:6px 12px;text-align:left;color:#4a6080;font-size:10px">TICKER</th>
              <th style="padding:6px 12px;text-align:left;color:#4a6080;font-size:10px">PRICE</th>
              <th style="padding:6px 12px;text-align:left;color:#4a6080;font-size:10px">GAIN</th>
              <th style="padding:6px 12px;text-align:left;color:#4a6080;font-size:10px">P&L</th>
              <th style="padding:6px 12px;text-align:left;color:#4a6080;font-size:10px">FROM HIGH</th>
            </tr></thead><tbody>{rows_html}</tbody>
          </table></div>"""
    alerts_html = "".join(
        f'<div style="margin:6px 0;padding:10px 14px;background:#1a2744;border-left:3px solid #ffa502;border-radius:4px">'
        f'<strong style="color:#e8edf5">{a["title"]}</strong><br>'
        f'<pre style="font-size:12px;color:#9fb3cf;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;margin:6px 0 0">{_html.escape(a["body"])}</pre></div>' for a in alerts
    ) or '<div style="color:#4a6080;font-size:13px">No alerts — all within thresholds.</div>'
    return f"""<html><body style="background:#060a14;font-family:system-ui,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#e8edf5">
    <div style="background:#0d1526;border:1px solid #1a2744;border-radius:10px;padding:18px 22px;margin-bottom:20px">
      <h2 style="margin:0 0 4px;font-size:17px">📊 CapitalLens</h2>
      <p style="margin:0;font-size:12px;color:#4a6080">{now} · Cash £{cash:.2f} · Total £{total:.2f}</p>
    </div>
    <div style="margin-bottom:20px"><h3 style="font-size:11px;color:#4a6080;text-transform:uppercase;letter-spacing:.06em;margin:0 0 10px">Alerts</h3>{alerts_html}</div>
    <div><h3 style="font-size:11px;color:#4a6080;text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px">Positions by pie</h3>{groups_html}</div>
    <div style="margin-top:16px;font-size:11px;color:#334155;border-top:1px solid #1a2744;padding-top:12px">
      Dip {DIP_FROM_HIGH_PCT}% · Buy {BUY_SIGNAL_PCT}% · Trim {TRIM_GAIN_PCT}% · Rebalance {REBALANCE_DRIFT_PCT}% · Target {ANNUAL_GROWTH_PCT}%pa
    </div></body></html>"""

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*55}\nCapitalLens v6 — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n{'='*55}")
    state = load_state()
    state["run_count"] = state.get("run_count",0) + 1

    account   = fetch_account()
    positions = fetch_positions()
    pies, pie_map = fetch_pies_with_instruments()

    if not positions:
        print("[warn] No positions returned"); return

    state = update_highs(state, positions)
    fetch_instrument_meta(state, [p.get("ticker") for p in positions if p.get("ticker")])
    alerts, summary = analyse(positions, pies, pie_map, state)

    print(f"[done] {len(alerts)} alerts · {len(summary)} positions · {len(pies)} pies")

    # Save to Supabase
    save_snapshot_to_supabase(summary, pies, alerts, account, state)

    # Fire ntfy alerts
    for a in alerts:
        if not cooldown(state, a["key"]):
            send_ntfy(a["title"], a.get("push") or a["body"], a.get("priority","default"))
            mark(state, a["key"]); time.sleep(1)

    # Send email
    if state["run_count"] == 1 or state["run_count"] % 6 == 0 or alerts:
        subj = f"T212 · {len(alerts)} alert(s) · {datetime.now(timezone.utc).strftime('%d %b %H:%M')}"
        send_email(subj, build_email(summary, pies, alerts, account))

    save_state(state)

if __name__ == "__main__":
    main()
