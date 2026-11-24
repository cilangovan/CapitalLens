"""Run: python tests/regression_history_test.py
Guards for bugs fixed BEFORE the regression register existed (found by scripts/regression_sync.py from git history). Each guard names the commit that fixed
the bug (H01..). Offline: reads source, or calls the pure functions with fixed inputs. Rows for these are in tests/regression_register.json."""
import datetime as dt, os, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; sys.path.insert(0, str(ROOT))
for _k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_KEY"): os.environ.setdefault(_k, "http://localhost" if _k == "SUPABASE_URL" else "x")   # the services read these at import; nothing is called
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {extra}" if extra and not cond else "")); bad += 0 if cond else 1
def src(f): return (ROOT / f).read_text(encoding="utf-8")
PAGES = ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html")

# H01 762729a — two scripts declared the same top-level name (_esc) and the page failed to load: scripts share one global scope
seen = {}
for p in sorted((ROOT / "docs/js").glob("*.js")):
    for m in re.finditer(r"^(?:const|let|class)\s+([A-Za-z_$][\w$]*)", p.read_text(encoding="utf-8"), re.M): seen.setdefault(m.group(1), []).append(p.name)
check("H01 no top-level const/let/class name is declared in two dashboard scripts (they share one scope; a clash stops the page loading)", not {k: v for k, v in seen.items() if len(v) > 1}, str({k: v for k, v in seen.items() if len(v) > 1}))

# H02 5282a13, 1c4f522 — CORS: upstream CORS headers stripped before ours are added; pre-check reply carries Allow-Headers
w = src("cloudflare-worker/worker.js")
check("H02 worker strips upstream CORS headers and answers the browser pre-check with Allow-Headers + Allow-Methods",
      "h.delete(k)" in w and "'Access-Control-Allow-Headers': 'Content-Type,Authorization'" in w and "Access-Control-Allow-Methods" in w and "request.method === 'OPTIONS'" in w)
# H03 d523d18 — PBKDF2 rounds sized to the Workers CPU limit (100k made every sign-in 'Failed to fetch')
m = re.search(r"const PBKDF2_ITER = (\d+)", w)
check("H03 worker PBKDF2 iterations stay within the Workers CPU budget (<= 50,000; 100,000 broke sign-in)", bool(m) and int(m.group(1)) <= 50000, m.group(0) if m else "constant missing")
# H04 820083c — worker falls back to SUPABASE_KEY when the service key is not set
check("H04 worker falls back to SUPABASE_KEY when SUPABASE_SERVICE_KEY is not set", w.count("env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY") >= 2)
# H05 08f35af — crypto mood needs api.alternative.me in connect-src on EVERY page
check("H05 every dashboard CSP lets Market Mood reach api.alternative.me", all("api.alternative.me" in re.search(r"connect-src[^;\"]*", src(f)).group(0) for f in PAGES), str([f for f in PAGES if "api.alternative.me" not in re.search(r"connect-src[^;\"]*", src(f)).group(0)]))
# H06 03d0a02 — Profit tab always fetches ^GSPC fresh, never the hours-old Overview cache
pr = src("docs/js/profit.js")
check("H06 Profit tab fetches ^GSPC fresh (never reads the Overview market cache _ovMk)", "pbFetchPtsOrdered('^GSPC')" in pr and not re.search(r"_ovMk\s*[\.\[]", re.sub(r"//[^\n]*", "", pr)))
# H07 496cf9e, c837e06 — Overview labels: Last 24H card exists and all-positions P&L is labelled all-time
ov = src("docs/js/overview.js")
check("H07 Overview stats strip has the Last 24H card; the Positions all-positions return is labelled 'all-time' (not confused with 24h change)",
      "const last24Card" in ov and 'class="label">Last ' in ov and "% all-time" in src("docs/js/positions.js"))
# H09 a1d1204 — pie value comes from Trading 212's result.priceAvgValue (handles fractional shares)
check("H09 pie value uses priceAvgValue in pie history, profit booking and the browser monitor",
      all("priceAvgValue" in src(f) for f in ("services/pie_history_service.py", "services/profit_booking_service.py", "docs/zk/profitbooking.js", "docs/zk/monitor.js")))
# H10 f28a6b0 — yfinance must be new enough for Yahoo's auth change
yf = re.search(r"yfinance>=(\d+)\.(\d+)\.(\d+)", src("requirements.txt"))
check("H10 requirements pin yfinance >= 0.2.65 (older versions fail Yahoo auth)", bool(yf) and tuple(map(int, yf.groups())) >= (0, 2, 65))
# H11 6a8cdc8 — analyst writes fall back to DELETE+INSERT when the upsert answers 409
check("H11 analyst service falls back to delete+insert on a 409 duplicate-key reply", "e.code == 409" in src("services/analyst_service.py") and "DELETE" in src("services/analyst_service.py"))
# H12 13ccc4a — holding decisions score each ticker once
hd = src("services/holding_decision_service.py")
check("H12 holding decisions deduplicate positions by ticker before scoring", "seen.add(p[\"ticker\"])" in hd)

# H13 584f6bf — T212 LSE tickers carry a trailing lowercase l (SSLNl -> SSLN.L); US tickers get no suffix
try:
    for _m in ("yfinance", "numpy"):                    # the service exits if these are missing; yf_symbol itself needs neither
        try: __import__(_m)
        except Exception:
            import types; sys.modules[_m] = types.ModuleType(_m)
    import services.holding_decision_service as hds
    check("H13 yfinance symbol conversion: SSLNl/LSE -> SSLN.L, IAEXl/LSE -> IAEX.L, AAPL/NASDAQ unchanged",
          hds.yf_symbol("SSLNl", "LSE") == "SSLN.L" and hds.yf_symbol("IAEXl", "LSE") == "IAEX.L" and hds.yf_symbol("AAPL", "NASDAQ/NYSE") == "AAPL",
          str([hds.yf_symbol("SSLNl", "LSE"), hds.yf_symbol("AAPL", "NASDAQ/NYSE")]))
except Exception as e: check("H13 yfinance symbol conversion", False, f"could not import the service: {e}")

# H14 fe1cbb1 — XIRR must not diverge: no sign change -> None; absurd flows stay inside the solver's bounds; a plain 10% year gives 10%
try:
    from services.returns_service import xirr
    d0 = dt.date(2025, 1, 1)
    ten = xirr([(d0, -100.0), (d0 + dt.timedelta(days=365), 110.0)])
    wild = xirr([(d0, -1.0), (d0 + dt.timedelta(days=3), 1e9)])
    check("H14 xirr: 10% over a year = 10%; all-positive flows = None; an absurd 3-day gain is None or bounded (never diverges)",
          ten is not None and abs(ten - 0.10) < 1e-4 and xirr([(d0, 5.0), (d0 + dt.timedelta(days=9), 7.0)]) is None and (wild is None or -0.99 <= wild <= 10.0), str((ten, wild)))
except Exception as e: check("H14 xirr guard", False, f"could not import the service: {e}")
# H15 16cdf5b, d64ba80 — history sync writes with the service key (bypasses RLS) and Trading 212 Basic auth uses key:secret
hs = src("services/history_service.py")
check("H15 history sync upserts with on_conflict, writes with the service-key secret (workflow maps SUPABASE_SERVICE_KEY to SUPABASE_KEY), and signs Trading 212 calls with Basic key:secret",
      "on_conflict=" in hs and "SUPABASE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}" in src(".github/workflows/daily_services.yml") and "Basic" in hs and "T212_API_SECRET" in hs)
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
