"""Run: python tests/legacy_interrupt_test.py
The legacy page's server-side pipeline (GitHub Actions: monitor.py + services/t212_sync_service.py) can be cancelled or time out part-way.
Same guarantees as the private app (tests/zk_interrupt_test.mjs): a snapshot is saved together with its positions in ONE database call, and a cut-off
Trading 212 history catch-up carries on next time instead of skipping the older new orders. Network is faked; nothing is contacted."""
import os, sys, pathlib, importlib
os.environ.update({"T212_API_KEY": "k", "T212_API_SECRET": "s", "SUPABASE_URL": "https://x.test", "SUPABASE_KEY": "k", "NTFY_TOPIC": "t", "GMAIL_USER": "u", "GMAIL_APP_PASS": "p"})
ROOT = pathlib.Path(__file__).resolve().parent.parent; sys.path.insert(0, str(ROOT))
res = []; ok = lambda n, c: (print(("  ✓ " if c else "  ✗ ") + n), res.append(bool(c)))

# ── 1. monitor.py: one transactional call, falls back to the old steps only if the function is not deployed ──
import monitor
summary = [{"ticker": f"T{i}_US_EQ", "display": f"T{i}", "pie": "P", "exchange": "NYSE", "current": 11.0, "avg": 10.0, "gain_pct": 10.0, "dip_from_high": 1.0, "ppl": 2.0, "qty": 3.0, "key": "k"} for i in range(12)]
alerts = [{"type": "dip", "ticker": "T1", "title": "t", "body": "b", "key": "x"}]; acct = {"total": 5000, "free": 100, "invested": 4000, "ppl": 400}
calls = []
def fake(deployed):
    def f(method, table, data=None, params=None):
        calls.append((method, table, data))
        if table == "rpc/save_snapshot": return 77 if deployed else None
        if table == "portfolio_snapshots": return [{"id": 5}]
        return [{}]
    return f
monitor.sb_request = fake(True); monitor.save_snapshot_to_supabase(summary, [], alerts, acct, {"run_count": 3, "highs": {}})
ok("deployed: exactly one database call saves snapshot + positions + alerts", [c[1] for c in calls] == ["rpc/save_snapshot"])
body = calls[0][2]
ok("  …it carries all 12 positions and the alert, in Trading 212's own split (invested = cost basis + unrealised)", len(body["p_positions"]) == 12 and len(body["p_alerts"]) == 1 and body["p_snapshot"]["invested"] == 4400 and body["p_snapshot"]["total_ppl"] == 400)
ok("  …no separate snapshot insert happens first (that is what could be left without positions)", not any(c[1] == "portfolio_snapshots" for c in calls))
calls.clear(); monitor.sb_request = fake(False); monitor.save_snapshot_to_supabase(summary, [], alerts, acct, {"run_count": 3, "highs": {}})
ok("not deployed yet: falls back to the old three inserts so a refresh still works", [c[1] for c in calls] == ["rpc/save_snapshot", "portfolio_snapshots", "positions", "alerts"])
ok("  …and the fallback positions carry the snapshot id", all(r["snapshot_id"] == 5 for r in calls[2][2]))

# ── 2. t212_sync_service.py: killed between pages, the next run still fetches the pages that were missed ──
S = importlib.import_module("services.t212_sync_service")
STORE, STATE = {}, {}; ORDERS = []; KILL = {"cursor": None}
def order(i):
    t = f"2026-01-{1 + i // 24:02d}T{i % 24:02d}:00:00Z"
    return {"order": {"id": 9000 + i, "ticker": "NVDA_US_EQ", "side": "BUY", "status": "FILLED", "createdAt": t},
            "fill": {"id": 5000 + i, "quantity": 1, "price": 100 + i, "filledAt": t, "walletImpact": {"netValue": -100, "realisedProfitLoss": 0, "fxRate": 1}}}
def t212(path):
    cur = int(path.split("cursor=")[1]) if "cursor=" in path else 0
    if KILL["cursor"] == cur: raise RuntimeError("killed: run cancelled")
    if "/equity/history/orders" not in path: return {"items": [], "nextPagePath": None}
    items = ORDERS[cur:cur + 50]
    return {"items": items, "nextPagePath": f"/api/v0/equity/history/orders?limit=50&cursor={cur + 50}" if cur + 50 < len(ORDERS) else None}
def sb(method, path, data=None, prefer=None):
    if path.startswith("t212_sync_state?endpoint=eq."): n = path.split("eq.")[1].split("&")[0]; return [STATE[n]] if n in STATE else []
    return []
def upsert(table, rows, key):
    for r in rows:
        if table == "t212_sync_state": STATE.setdefault(r["endpoint"], {}).update(r)
        else: STORE.setdefault(table, {})[r[key]] = r
S.t212, S.sb, S.upsert = t212, sb, upsert
S.existing_keys = lambda table, key, keys: {k for k in keys if k in STORE.get(table, {})}
S.count_rows = lambda table: len(STORE.get(table, {}))
S.FORCE_FULL = False
def go(kill=None):
    KILL["cursor"] = kill
    try: S.sync("orders", "/api/v0/equity/history/orders?limit=50", "t212_orders", "id", S.map_order); return True
    except RuntimeError: return False

ORDERS = [order(i) for i in range(119, -1, -1)]; go()                       # 120 stored by an earlier full walk
ok("baseline: 120 orders stored", len(STORE["t212_orders"]) == 120 and STATE["orders"].get("last_full"))
ORDERS = [order(i) for i in range(179, 119, -1)] + ORDERS                    # 60 new orders: page 1 all new, page 2 part new
ok("killed after page 1: the run stops (not silently complete)", go(kill=50) is False)
ok("  …a resume marker was saved", bool(STATE["orders"].get("resume")))
go()
ok("next run fetches the missed page: all 180 orders stored", len(STORE["t212_orders"]) == 180)
ok("  …and the resume marker is cleared", not STATE["orders"].get("resume"))
go(); ok("a further run changes nothing (idempotent)", len(STORE["t212_orders"]) == 180)

# ── 3. Issue #53: a refused key / missing data must fail the run loudly (and never save a zero-value snapshot) ──
import io, contextlib
pushes, saved = [], []
monitor.send_ntfy = lambda t, b, p="default": pushes.append((t, b))
monitor.save_snapshot_to_supabase = lambda *a, **k: saved.append(1)
monitor.load_state = lambda: {}
monitor.fetch_pies_with_instruments = lambda: ([], {})
monitor.rl = lambda secs=5: None
def run_main(account, positions, errors):
    pushes.clear(); saved.clear(); monitor.T212_ERRORS.clear(); monitor.T212_ERRORS.update(errors)
    monitor.fetch_account = lambda: account; monitor.fetch_positions = lambda: positions
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf): monitor.main()
        return None, buf.getvalue()
    except SystemExit as e: return e.code, buf.getvalue()
code, out = run_main({"total": 1, "free": 1}, [], {"/api/v0/equity/portfolio": "HTTP 403"})
ok("positions refused (HTTP 403): run exits non-zero, nothing saved", code == 1 and not saved)
ok("  …the reason names the key permissions and a push is sent", "refused the key for your open positions" in out and "Portfolio and Account data permissions" in out and pushes and pushes[0][0] == "CapitalLens refresh failed")
code, out = run_main(None, [{"ticker": "A"}], {"/api/v0/equity/account/cash": "HTTP 500"})
ok("account balance missing: run exits non-zero and does NOT save a zero-value snapshot", code == 1 and not saved and "account balance" in out)
code, out = run_main({"total": 1, "free": 1}, [], {"/api/v0/equity/portfolio": "HTTP 429 rate limit, gave up after retries"})
ok("rate limited: tells the owner to wait and run again", code == 1 and "rate-limiting" in out)
code, out = run_main({"total": 1, "free": 1}, [], {})
ok("no positions and no error: says Trading 212 returned nothing (not a silent success)", code == 1 and "returned nothing for your open positions" in out)
print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed"); sys.exit(0 if all(res) else 1)
