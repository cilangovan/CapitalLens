"""Run: python tests/standards_test.py — the machine-checkable part of CLAUDE.md (the owner's standing rules).
1. CLAUDE.md exists and still carries every section.  2. No Claude/Anthropic/Co-Authored-By in commit messages.
3. Every dashboard gets every module (legacy page and demo page load the same scripts).
4. Every table the dashboards read is served: by the legacy worker, the private app's shim, or is a documented private-app-only route.
5. No inline <script> blocks or javascript: URLs (strict CSP) in the source pages.  6. Generated pages exist for every dashboard.
7. Documentation (documentation/ + docs/help portal): every menu, table and workflow documented, portal not stale, footer link on every dashboard."""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bad = 0
def check(name, cond, detail=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {detail}" if detail and not cond else "")); bad += 0 if cond else 1

doc = (ROOT / "CLAUDE.md").read_text() if (ROOT / "CLAUDE.md").exists() else ""
need = ["How to work", "UI rules", "Data and security rules", "Product rules", "Adding a new standing rule", "Push straight to `main`", "regression test", "collapsible", "Zero-knowledge"]
check("CLAUDE.md exists and keeps every required section and rule", all(n in doc for n in need), str([n for n in need if n not in doc]))

log = subprocess.run(["git", "log", "--format=%H%x1f%B%x1e"], cwd=ROOT, capture_output=True, text=True).stdout
SIGNATURE = re.compile(r"co-authored-by|claude|anthropic", re.I)
def signed(msg): return bool(SIGNATURE.search(re.sub(r"CLAUDE\.md", "", msg, flags=re.I)))       # the standing-requirements FILE is named CLAUDE.md; mentioning it is fine
hits = [c.split("\x1f")[0][:8] for c in log.split("\x1e") if signed(c)]
check("signature check self-test: flags a real signature, allows the CLAUDE.md file name", signed("fix\n\nCo-Authored-By: Claude <x@y>") and signed("made by Claude") and not signed("CLAUDE.md: rules"))
check("no Claude / Anthropic / Co-Authored-By signature in any commit message", not hits, f"commits: {hits[:5]}")

def scripts(f): return {s.split("/")[-1] for s in re.findall(r'<script src="([^"?]+)', (ROOT / f).read_text())}
variant = {"auth.js", "demo-auth.js", "demo-shim.js", "demo-session.js"}
a, b = scripts("docs/index.html") - variant, scripts("docs/demo/index.html") - variant
check("legacy page and demo page load the same modules (features reach every dashboard)", a == b, f"only legacy: {sorted(a - b)} · only demo: {sorted(b - a)}")

used = set()
for f in (ROOT / "docs/js").glob("*.js"):
    t = f.read_text()
    used |= set(re.findall(r"api\(\s*'([a-z_]+)'", t)) | set(re.findall(r"\$\{PROXY\}/([a-z_]+)", t))
worker = (ROOT / "cloudflare-worker/worker.js").read_text()
readable = set(re.findall(r"'([a-z_]+)'", worker[worker.index("const READABLE"):worker.index("function json(")]))
shim = (ROOT / "docs/zk/shim.js").read_text()
zk = {"institutional_flow_reports"} | set(re.findall(r"\b([a-z_]+):\s*'[a-z_]+'", shim[shim.index("const ENCRYPTED"):shim.index("const SHARED")])) | set(re.findall(r"'([a-z_]+)'", shim[shim.index("const SHARED"):shim.index("const ACTIONS")]))
routes = {"auth", "chart", "search", "settings", "watchlist", "alerts", "ipo"}            # handled by worker/shim routes, not tables
private_only = {"ipo_watch"}                                                               # encrypted per-user table: private app only, buttons hidden elsewhere
missing_worker = sorted(t for t in used - routes - private_only if t not in readable)
missing_zk = sorted(t for t in used - routes if t not in zk)
check("every table the dashboards read is served by the legacy worker", not missing_worker, str(missing_worker))
check("every table the dashboards read is served by the private app", not missing_zk, str(missing_zk))

problems = []
for f in ("docs/index.html", "docs/demo/index.html"):
    t = (ROOT / f).read_text()
    problems += [f"{f}: inline <script>" for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", t)]
    problems += [f"{f}: javascript: URL" for _ in re.finditer(r"""(?:href|src)=["']\s*javascript:""", t, re.I)]
check("no inline scripts or javascript: URLs in the source pages (strict CSP)", not problems, str(problems[:3]))

# ── documentation is part of the product (CLAUDE.md: docs in git, linked from every footer) ─────────────────────
sys.path.insert(0, str(ROOT / "scripts"))
import build_docs
md_files = {str(p.relative_to(ROOT / "documentation")) for p in (ROOT / "documentation").rglob("*.md")}
check("every documentation/*.md page is in the portal navigation and every nav page exists", md_files == set(build_docs.PAGES), f"not in NAV: {sorted(md_files - set(build_docs.PAGES))} · missing file: {sorted(set(build_docs.PAGES) - md_files)}")
stale = build_docs.build(check=True)
check("generated references and the docs/help portal are up to date (run scripts/build_docs.py)", not stale, str(stale[:4]))
ops_links = [str(f.relative_to(ROOT)) for f in list((ROOT / "docs").rglob("*.html")) + list((ROOT / "docs").rglob("*.js")) if "docs/ops/" not in str(f) and "docs/help/" not in str(f) and re.search(r"""(?:href|src|location)[^>]{0,40}['\"](?:\.\./|/CapitalLens/)?ops/""", f.read_text(errors="ignore"))]
check("the internal ops page is not linked from any customer page", not ops_links, str(ops_links[:3]))
menus = re.findall(r"""onclick="showTab\('(\w+)',this\)""", (ROOT / "docs/index.html").read_text())
def broken_links():
    out = []
    for f in (ROOT / "docs/help").rglob("*.html"):
        for h in re.findall(r'href="([^"]+)"', f.read_text()):
            if re.match(r"[a-z]+:", h): continue
            path = (f.parent / h.split("#")[0]).resolve() if h.split("#")[0] else f
            if not path.exists() and not (path.is_dir() and (path / "index.html").exists()): out.append(f"{f.relative_to(ROOT)} -> {h}")
    return out
check("every internal link in the documentation portal resolves", not broken_links(), str(broken_links()[:4]))
check("every dashboard menu has its own documentation page", len(menus) >= 9 and "**missing**" not in (ROOT / "documentation/reference/menu-map.md").read_text(), "see documentation/reference/menu-map.md")
dbdoc = (ROOT / "documentation/database.md").read_text()
check("every database table is explained in documentation/database.md", all(t in dbdoc for t in build_docs.tables()), str([t for t in build_docs.tables() if t not in dbdoc]))
wfdoc = (ROOT / "documentation/workflows.md").read_text().lower()
check("every GitHub Actions workflow is explained in documentation/workflows.md",
      all(re.sub(r"\s*\(.*", "", w["name"]).lower() in wfdoc or w["file"].lower() in wfdoc for w in build_docs.workflows()), str([w["file"] for w in build_docs.workflows() if re.sub(r"\s*\(.*", "", w["name"]).lower() not in wfdoc and w["file"].lower() not in wfdoc]))
foot = [("docs/index.html", 'href="help/"'), ("docs/demo/index.html", 'href="../help/"'), ("docs/app/index.html", 'href="../help/"'), ("docs/zkapp/index.html", 'href="../help/"'),
        ("docs/zkapp-prod/index.html", 'href="../help/"'), ("docs/zk/index.html", 'href="../help/"'), ("docs/zk-prod/index.html", 'href="../help/"')]
nofoot = [f for f, h in foot if not ('class="app-footer"' in (ROOT / f).read_text() and h in (ROOT / f).read_text() and "📘 Documentation" in (ROOT / f).read_text())]
check("every dashboard footer links to the documentation portal", not nofoot, str(nofoot))
check("footer link is a 40px tap target", all("min-height:40px" in (ROOT / f).read_text().replace(" ", "") for f in ("docs/index.html", "docs/demo/index.html", "docs/zk/index.html")))
check("documentation portal has no script and a strict CSP", all("<script" not in p.read_text() and "default-src 'none'" in p.read_text() for p in (ROOT / "docs/help").rglob("*.html")))
check("loading never leaves a blank screen: private pages carry the boot splash, source pages have the spinner style",
      all('id="boot-splash"' in (ROOT / f).read_text() for f in ("docs/zkapp/index.html", "docs/zkapp-prod/index.html")) and all(".loading.busy::before" in (ROOT / f).read_text() for f in ("docs/index.html", "docs/demo/index.html")))
check("CLAUDE.md records the documentation rule", "documentation/" in doc and "Documentation" in doc)

check("generated pages exist for every dashboard", all((ROOT / p).exists() for p in ("docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html")))
# every graph's range selector offers 1D 1W 1M 3M 6M 9M 1Y (owner's standing rule)
src = lambda f: (ROOT / f).read_text()
check("every graph range selector offers 1D 1W 1M 3M 6M 9M 1Y",
      "['1D', 1], ['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['9M', 273], ['1Y', 365]" in src("docs/js/overview.js") and "key:'6M'" in src("docs/js/overview.js") and "key:'9M'" in src("docs/js/overview.js")
      and all('id="pf-6M"' in src(f) and 'id="pf-9M"' in src(f) for f in ("docs/index.html", "docs/demo/index.html"))
      and "['6m', '6M'], ['9m', '9M']" in src("docs/js/pie_drill.js") and "['3mo', '3M']" in src("docs/js/drilldown.js") and "['9mo', '9M']" in src("docs/js/drilldown.js")
      and "'1D', '1W', '1M', '3M', '6M', '9M'" in src("docs/js/returns.js"))
check("CLAUDE.md records the same-time-ranges rule", "1D · 1W · 1M · 3M · 6M · 9M · 1Y" in doc)
check("Recent purchases card (7 days, auto-expires, hidden when empty) is on every dashboard, documented, seeded in the demo and layout-tested",
      all("recent.js" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"])
      and "RecentBuys.show" in (ROOT / "docs/js/positions.js").read_text() and "seed_demo_recent_buys" in (ROOT / "db/tenant/27_demo_recent_buys.sql").read_text()
      and "Recent purchases" in (ROOT / "documentation/menus/positions.md").read_text() and (ROOT / "tests/recent_layout_test.py").exists() and (ROOT / "tests/zk_recent_test.mjs").exists())

check("Purchases outside pies card (per-buy return, 5%/10% stops, limit-sell levels; sold stocks hidden) is on every dashboard, documented, seeded in the demo and tested",
      all("lots.js" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"])
      and "Lots.show" in (ROOT / "docs/js/positions.js").read_text() and "seed_demo_lots" in (ROOT / "db/tenant/28_demo_lots.sql").read_text()
      and "Purchases outside pies" in (ROOT / "documentation/menus/positions.md").read_text() and (ROOT / "tests/lots_layout_test.py").exists() and (ROOT / "tests/zk_lots_test.mjs").exists())

check("Alerts market signals (Live / Pre / Post: 100 & 200 SMA crosses, 52-week highs; holdings + watchlist) are on every dashboard, documented, scan only when the tab is open, and tested",
      all("signals.js" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"])
      and "alertsShown" in (ROOT / "docs/js/router.js").read_text() and "Signals.scan" in (ROOT / "docs/js/alerts.js").read_text()
      and "52 Week High" in (ROOT / "docs/js/signals.js").read_text() and "Market signals" in (ROOT / "documentation/menus/alerts.md").read_text()
      and (ROOT / "tests/signals_layout_test.py").exists() and (ROOT / "tests/zk_signals_test.mjs").exists())

_ss = (ROOT / "services/strategy_service.py").read_text(); _zs = (ROOT / "docs/zk/strategy.js").read_text(); _js = (ROOT / "docs/js/strategy.js").read_text()
check("strategy still counts what was actually bought this week (issue #53): browser + legacy + demo, parity-tested (no longer shown against a budget on the Strategy tab)",
      "def contributions" in _ss and "function contributions" in _zs and "strategy_fill_invested" in (ROOT / "db/tenant/26_strategy_invested.sql").read_text()
      and "bought this week" in (ROOT / "tests/zk_strategy_test.mjs").read_text())



# ── demo credentials never live in the repo (epic #32) ──
import subprocess as _sp
_files = _sp.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
_bad = []
for _f in _files:
    if _f.endswith((".png", ".ico", ".woff2")) or _f == "tests/standards_test.py": continue
    try: _t = (ROOT / _f).read_text()
    except Exception: continue
    if re.search(r"demo@capitallens\.test[\"'`]?\s*[,:=]\s*[\"'`][^\"'`\s]{8,}", _t) or re.search(r"DEMO_(MASTER_)?PASSWORD\s*[=:]\s*[\"'][^\"']{6,}", _t): _bad.append(_f)
check("no demo account password committed to the repo", not _bad, f"files: {_bad[:3]}")
check("demo sign-in does not pre-fill the master demo email", 'value="demo@capitallens.test"' not in (ROOT / "docs/demo/index.html").read_text())

# demo must show Analyst / Profit Booking / Strategy data: the daily refresh has to seed them (pre-sales mock-up)
_ins = (ROOT / "db/tenant/19_demo_insights.sql").read_text() if (ROOT / "db/tenant/19_demo_insights.sql").exists() else ""
check("demo refresh seeds Analyst, Profit Booking and Strategy data", all(t in _ins for t in ["seed_demo_insights", "insert into public.profit_booking ", "insert into public.profit_booking_summary", "insert into public.value_buy_scores", "insert into public.strategy_recommendations", "insert into public.holding_decisions", "analyst_ratings", "institutional_flow_reports"]) and "public.seed_demo_insights(t)" in _ins)

# Support Levels (epic: Strategy > Entry Analysis > Support Levels): public shared table, demo-only copy, held-only rendering, rolled out to every dashboard
_sl = (ROOT / "db/tenant/23_support_levels.sql").read_text() if (ROOT / "db/tenant/23_support_levels.sql").exists() else ""
_slj = (ROOT / "docs/js/support.js").read_text() if (ROOT / "docs/js/support.js").exists() else ""
check("Support Levels: shared table names its source and capture date; demo gets a demo-only copy refreshed daily (never invented rows in the shared table)",
      re.search(r"source_name\s+text not null", _sl) and all(x in _sl for x in ["as_of", "create table if not exists public.demo_support_levels", "seed_demo_support_levels", "perform public.seed_demo_support_levels(t)"])
      and "including constraints including indexes" in _sl
      and "if sy is null then continue" in _sl and "|| '.L'" in _sl   # regression: demo ETFs such as CS1l_EQ broke the symbol check and failed the whole daily refresh; they now map to Yahoo keys (CS1.L)   # regression: without the primary key the demo refresh failed on ON CONFLICT (symbol)
      and not re.search(r"insert into public\.support_levels[^;]*Demo data", _sl) and "'/support_levels': '/demo_support_levels'" in (ROOT / "docs/demo/demo-shim.js").read_text())
check("Support Levels: shown for held stocks only, loaded on every dashboard (legacy, demo, app, zkapp, zkapp-prod)",
      "held.has(l.symbol)" in _slj and all("support.js" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"]))

# A refresh killed part-way (reload / closed tab) must not corrupt or hide data: snapshot written last, resume marker for the history catch-up, guard against leaving
_mon = (ROOT / "docs/js/../zk/monitor.js").read_text(); _t2 = (ROOT / "docs/zk/t212sync.js").read_text()
check("interrupted refresh is safe: snapshot written after its positions, history catch-up resumes, 'leave site?' guard, regression test exists",
      _mon.index("store.put('positions'") < _mon.index("store.put('portfolio_snapshots'") and "resume" in _t2 and "walking" in _t2
      and "beforeunload" in (ROOT / "docs/zkapp/zkapp-tools.js").read_text() and (ROOT / "tests/zk_interrupt_test.mjs").exists())
_mp = (ROOT / "monitor.py").read_text(); _sy = (ROOT / "services/t212_sync_service.py").read_text(); _m25 = (ROOT / "db/tenant/25_refresh_safety.sql").read_text()
check("legacy pipeline: snapshot + positions + alerts saved in one transaction (rpc save_snapshot), history catch-up resumable, regression test exists",
      "rpc/save_snapshot" in _mp and "function public.save_snapshot" in _m25 and "security invoker" in _m25 and "add column if not exists resume" in _m25
      and "resume" in _sy and (ROOT / "tests/legacy_interrupt_test.py").exists())
_mj = (ROOT / "docs/zk/monitor.js").read_text(); _pl = (ROOT / "docs/zk/pipeline.js").read_text(); _zt = (ROOT / "docs/zkapp/zkapp-tools.js").read_text()
check("refresh is honest (issue #53): failed Trading 212 calls are explained, no zero-value snapshot, 'what changed' is shown, legacy run fails loudly, e2e test exists",
      "refused the key" in _mj and "if (!account)" in _mj and "fetchSupportLevels" in _mj and "x.json()" not in _zt and "describeChanges" in _pl and "warnings" in _pl and "zkShowChanges" in _zt and "zk-changes" in (ROOT / "scripts/build_zkapp.py").read_text()
      and "sys.exit(1)" in _mp and "explain_t212" in _mp and (ROOT / "tests/zk_purchase_e2e_test.mjs").exists())
_dr = (ROOT / "db/tenant/18_demo_refresh.sql").read_text()
check("demo: daily refresh is one database function (atomic) run by pg_cron, never by a browser, so a page reload cannot cut it off",
      "function public.demo_refresh()" in _dr and "cron.schedule('demo-daily-refresh'" in _dr and "demo_refresh" not in (ROOT / "docs/demo/index.html").read_text())

# 5-check review box (Strategy > Holding Decisions + Entry Analysis): the owner's prompt, copied/opened per stock, on every dashboard
_fc = (ROOT / "docs/js/fivecheck.js").read_text(); _st = (ROOT / "docs/js/strategy.js").read_text(); _wlj0 = (ROOT / "docs/js/watchlist.js").read_text()
check("5-check review: owner's prompt verbatim, ChatGPT/Claude/Grok buttons, no inline handlers, honest 'not live data' note, in both Strategy lists + the Watchlist and on every dashboard",
      "If the price falls 30% tomorrow, would a long-term holder still hold it? Why, or why not?" in _fc and "Do not tell me to buy or sell. Only give me the facts, so I can decide." in _fc
      and "general knowledge, not live data" in _fc and not re.search(r"\bon(click|change|input)=", _fc)
      and "FiveCheck.html(h.display, h.ticker, 'hd')" in _st and "FiveCheck.html(v.display, v.ticker, 'ea')" in _st and "wlFiveCheck(i)" in _wlj0 and all(x in _fc for x in ["chatgpt.com/?q=", "claude.ai/new?q=", "grok.com/?q="])
      and all("fivecheck.js" in (ROOT / f).read_text() and ".fc-btn" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"]))

# Watchlist card order: arrangeable, saved per user, encrypted in the private app (UI-21)
_wlj = (ROOT / "docs/js/watchlist.js").read_text(); _wls = (ROOT / "docs/zk/shim.js").read_text(); _wlw = (ROOT / "cloudflare-worker/worker.js").read_text()
check("Watchlist order: ▲▼ arrange mode saves per user (encrypted sort_order in the private app, worker + column on legacy), never as plaintext prefs",
      all(x in _wlj for x in ["wlMove", "wlArrange", "/watchlist/order", "wlResetOrder"]) and "route === 'watchlist/order'" in _wls and "sort_order" in _wls
      and "/watchlist/order" in _wlw and "add column if not exists sort_order" in (ROOT / "db/tenant/24_watchlist_order.sql").read_text()
      and "route === 'ipo/order'" in _wls and all(x in (ROOT / "docs/js/ipo.js").read_text() for x in ["data-ipo-mv", "/ipo/order", "sort_order"]) and "user_ui_prefs" not in (ROOT / "docs/js/ipo.js").read_text()
      and all(("js/watchlist.js" in (ROOT / f).read_text() or "../js/watchlist.js" in (ROOT / f).read_text()) and ("ipo.js" in (ROOT / f).read_text()) for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"])   # rule 5: every dashboard loads the watchlist and IPO code
      and all(".ipo-grip" in (ROOT / f).read_text() and ".w-grip" in (ROOT / f).read_text() and "touch-action:none" in (ROOT / f).read_text() for f in ["docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"])   # ... and the drag handle styles
      and "data-ipo-grip" in (ROOT / "docs/js/ipo.js").read_text()
      and "w-grip" in _wlj and "touch-action:none" in (ROOT / "docs/index.html").read_text() and "touch-action:none" in (ROOT / "docs/demo/index.html").read_text()
      and "user_ui_prefs" not in _wlj and "min-width:40px; min-height:40px" in (ROOT / "docs/index.html").read_text() and "min-width:40px; min-height:40px" in (ROOT / "docs/demo/index.html").read_text())

_ret = (ROOT / "db/tenant/20_demo_returns.sql").read_text() if (ROOT / "db/tenant/20_demo_returns.sql").exists() else ""
check("demo refresh seeds the Returns dashboard (returns_summary + realised_pnl)", all(x in _ret for x in ["insert into public.returns_summary", "insert into public.realised_pnl", "public.seed_demo_returns(t)"]))

_mk = (ROOT / "db/tenant/21_demo_markets.sql").read_text() if (ROOT / "db/tenant/21_demo_markets.sql").exists() else ""
check("demo markets/watchlist/pie history/IPO are seeded, and only into demo-only tables (never the shared market_cache / ipo_calendar / institutional_flow_reports)",
      all(x in _mk for x in ["insert into public.demo_market_cache", "insert into public.demo_ipo_calendar", "insert into public.watchlist_analysis", "insert into public.pie_history", "public.seed_demo_markets(t)"])
      and not re.search(r"insert into public\.(market_cache|ipo_calendar|institutional_flow_reports)\b", _mk + _ret)
      and not re.search(r"insert into public\.(market_cache|ipo_calendar)\b", _ins)
      and "replace(d, 'public.institutional_flow_reports', 'public.demo_institutional_flow_reports')" in _mk)   # 19_demo_insights inserts the weekly flow report; 21 rewrites that function to the demo-only copy when applied

# Dip Planner (Strategy tab): no fixed budget, amount entered by the owner, every dashboard, signals saved by both engines, tested, documented
_dp = (ROOT / "docs/js/dipplan.js").read_text(); _vbj = (ROOT / "docs/zk/valuebuy.js").read_text(); _vbp = (ROOT / "services/value_buy_service.py").read_text()
check("Dip Planner: loaded by the live and demo pages (so by app, zkapp and zkapp-prod), mounted on the Strategy tab, no fixed budget on that tab",
      all("dipplan.js" in (ROOT / p).read_text() for p in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"))
      and "dip-planner-content" in _js and "loadDipPlanner" in _js and "300/month" not in re.sub(r"//[^\n]*", "", _js) and "MONTHLY_BUDGET" not in _dp and "£300" not in _dp)
check("Dip Planner signals (PE, volume ratio, 4w/1w momentum, T212 ticker) are saved by both the browser and the legacy value-buy engines and the demo seed",
      all(k in _vbj and k in _vbp for k in ("vol_ratio", "mom_4w", "mom_1w", "t212")) and "'fwd_pe'" in (ROOT / "db/tenant/19_demo_insights.sql").read_text() and "'mom_4w'" in (ROOT / "db/tenant/19_demo_insights.sql").read_text())
check("Dip Planner is tested (logic + phone layout, wired into CI) and documented on the Strategy menu page and in CLAUDE.md",
      (ROOT / "tests/zk_dipplan_test.mjs").exists() and (ROOT / "tests/dipplan_layout_test.py").exists() and "dipplan_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text()
      and "Dip Planner" in (ROOT / "documentation/menus/strategy.md").read_text() and "Dip Planner" in doc and "no fixed budget" in doc.lower())
check("Dip Planner handlers are only whitelisted calls (no inline code the CSP interpreter would refuse)", not re.search(r'on(?:click|change|input|keydown)="[^"]*(?:=>|===|function|\bif\b)', _dp))

# Swing tab: loaded on every dashboard, gated by a back-test, tested, documented
_sw = (ROOT / "docs/js/swing.js").read_text()
check("Swing tab: on every dashboard, shows no entries without a passing back-test (swValidated), says 'No entry today', no fixed £ budget",
      all("swing.js" in (ROOT / p).read_text() and "showTab('swing'" in (ROOT / p).read_text() for p in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"))
      and "swValidated" in _sw and "No entry today" in _sw and "swing_backtest.json" in _sw and "budget" not in _sw.lower())
check("Swing tab: unit tests, layout test (in CI) and back-test workflow exist, and the menu page is documented",
      (ROOT / "tests/zk_swing_test.mjs").exists() and "swing_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text()
      and "swing_backtest.mjs" in (ROOT / ".github/workflows/swing_backtest.yml").read_text() and (ROOT / "documentation/menus/swing.md").exists() and "Swing tab" in (ROOT / "CLAUDE.md").read_text())

check("bot commits (register sync, swing back-test) rebase before pushing, so two bot jobs finishing together cannot fail each other",
      all("git pull --rebase origin main" in (ROOT / ".github/workflows" / f).read_text() for f in ("regression.yml", "swing_backtest.yml")))

_pp = (ROOT / "docs/js/paper.js").read_text()
check("Paper trading: on every dashboard, fake money only (no order or key code), weekly amount typed by the user (no default), stored in user_ui_prefs __paper",
      all("paper.js" in (ROOT / p).read_text() and "paper-content" in (ROOT / p).read_text() for p in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"))
      and "__paper" in _pp and "paperInit(i ? i.value : 0" in _pp and "weekly: 30" not in _pp and "fetch(" not in _pp and "trading212" not in _pp.lower() and "api-key" not in _pp.lower())
check("Paper trading: unit tests, layout test (in CI) and the documentation exist",
      (ROOT / "tests/zk_paper_test.mjs").exists() and "paper_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text() and "Paper trading" in (ROOT / "documentation/menus/swing.md").read_text() and "never places real trades" in (ROOT / "CLAUDE.md").read_text())

_of = (ROOT / "docs/zk/orderflow.js").read_text(); _ofp = (ROOT / "services/orderflow.py").read_text()
check("Order flow: estimator exists in JS and Python, is labelled an estimate, uses relative (not fixed-lot) thresholds, golden test + docs exist",
      "estimated: true" in _of and '"estimated": True' in _ofp and "EVENT_RVOL" in _of and "EVENT_RVOL" in _ofp and "20k" not in _ofp.replace("20k lots", "")
      and (ROOT / "tests/zk_orderflow_test.mjs").exists() and (ROOT / "tests/data/orderflow_golden.json").exists() and "estimated" in (ROOT / "documentation/menus/watchlist.md").read_text())
_hb = (ROOT / "docs/js/helpbot.js").read_text(); _hw = (ROOT / "cloudflare-worker/help.js").read_text()
check("Help assistant: ❓ button on every dashboard, CSP allows only our help worker, chat never sends holdings/keys (client blocks secrets, no innerHTML)",
      all("helpbot.js" in (ROOT / p).read_text() and "capitallens-help.itsme-daf.workers.dev" in (ROOT / p).read_text() for p in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"))
      and "hbLooksSensitive" in _hb and "innerHTML" not in _hb and "ZKCTX" not in _hb and "enc_rows" not in _hb and "localStorage" not in _hb)
check("Help assistant: worker is docs-only (no database or service key), never logs question text, has a kill switch, tests + layout test (in CI) + docs exist",
      "SERVICE_KEY" not in _hw and "enc_rows" not in _hw and "HELP_BOT_ENABLED" in _hw and "console.log(JSON.stringify({ event: 'help_ask', found, ok, ms" in _hw.replace("\n", " ")
      and (ROOT / "tests/zk_help_worker_test.mjs").exists() and (ROOT / "tests/zk_helpbot_test.mjs").exists() and "help_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text()
      and "buy/sell/price advice" in (ROOT / "CLAUDE.md").read_text() and (ROOT / "documentation/menus/help-assistant.md").exists())

print("\nstandards: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)

# No fixed budget anywhere (owner decides the amount at decision time): engines, worker, shim, watchlist UI and demo seeds
_wl = (ROOT / "docs/js/watchlist.js").read_text(); _wk = (ROOT / "cloudflare-worker/worker.js").read_text(); _wlp = (ROOT / "services/watchlist_service.py").read_text(); _wlj = (ROOT / "docs/zk/watchlist.js").read_text()
check("no fixed budget: no £ budget in the strategy / watchlist engines (Python + browser), worker, shim or Watchlist UI; the user types the amount",
      "MONTHLY_BUDGET_MAX" not in _ss + _zs and "weekly_budget" not in _ss + _zs + _wlp + _wlj and "_weekly_budget" not in _wl + _wk + (ROOT / "docs/zk/shim.js").read_text()
      and "amount_gbp" not in _wlp + _wlj + _wl and "wlSetAmount" in _wl and 'id="w-amount"' in _wl and "/settings/set" not in _wk)
check("no fixed budget: demo seeds carry shares only (no £ amounts / budget objects)",
      "amount_gbp" not in (ROOT / "db/tenant/21_demo_markets.sql").read_text() and "'budget'" not in (ROOT / "db/tenant/21_demo_markets.sql").read_text() and "weekly_budget" not in (ROOT / "db/tenant/19_demo_insights.sql").read_text())
check("Watchlist amount box and Plan button are phone-sized (>=40px tap targets) on the live and demo pages",
      all(re.search(r"\.w-budget input \{[^}]*min-height:40px", (ROOT / f).read_text()) and re.search(r"\.w-budget button \{[^}]*min-height:40px", (ROOT / f).read_text()) for f in ("docs/index.html", "docs/demo/index.html")))
check("Watchlist amount box has a phone layout test wired into CI", (ROOT / "tests/watchlist_amount_layout_test.py").exists() and "watchlist_amount_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text())

# Appearance (themes/fonts/size): shared module on every dashboard, no hard-coded dark palette in dashboard scripts, tested, documented
_ap = (ROOT / "docs/js/appearance.js").read_text()
check("Appearance: loaded first by the live and demo pages (so by app, zkapp and zkapp-prod), 6 themes and 6 fonts, tested, documented",
      all("appearance.js" in (ROOT / f).read_text() for f in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html"))
      and _ap.count("{ id: '") >= 16 and (ROOT / "tests/zk_appearance_test.mjs").exists() and "appearance_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text()
      and "Appearance" in (ROOT / "documentation/menus/settings-and-account.md").read_text() and "never hard-code palette" in doc.lower())
_hard = [f.name for f in (ROOT / "docs/js").glob("*.js") if f.name != "appearance.js" and re.search(r"#(?:e2e8f0|8892a4|2d3353|1a1d27|0f1117|22263a)\b", f.read_text(), re.I)]
check("dashboard scripts use the theme variables, not the old dark palette hex codes (a hard-coded colour breaks the light themes): " + ", ".join(_hard), not _hard)

check("Profit tab: separate Pie profit check card, Profit to book explains a £0 total, guarded by a layout test wired into CI",
      "pbPieCard" in (ROOT / "docs/js/profit.js").read_text() and "pbClosest" in (ROOT / "docs/js/profit.js").read_text() and "gain_gbp" in (ROOT / "services/profit_booking_service.py").read_text()
      and "gain_gbp" in (ROOT / "docs/zk/profitbooking.js").read_text() and "profit_pies_layout_test.py" in (ROOT / ".github/workflows/ui_tests.yml").read_text())

# Alerts list lives only on the Alerts dashboard: no Active Alerts card on Overview (any dashboard), no leftover renderer
check("Overview has no Active Alerts card or renderer on any dashboard (alerts only on the Alerts tab)",
      all("active-alerts" not in (ROOT / f).read_text() for f in ("docs/index.html", "docs/demo/index.html", "docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html", "docs/js/overview.js")))

# Regression register + data quality: every fixed bug has a guard, one workflow runs them all, and the rule is written down
_rw = (ROOT / ".github/workflows/regression.yml").read_text() if (ROOT / ".github/workflows/regression.yml").exists() else ""
check("regression register, guards and data-quality checks exist, run in the Regression & data quality workflow, and CLAUDE.md names the rule",
      all(f in _rw for f in ("regression_run.py", "regression_sync.py", "data_quality_test.py", "table_inventory_test.py", "schedule:"))
      and (ROOT / "tests/regression_register.json").exists() and "regression_register.json" in doc and "regression-gap" in doc)
