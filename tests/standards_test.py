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

print("\nstandards: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)

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
      all(x in _sl for x in ["source_name text not null", "as_of", "create table if not exists public.demo_support_levels", "seed_demo_support_levels", "perform public.seed_demo_support_levels(t)"])
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
      and not re.search(r"insert into public\.(market_cache|ipo_calendar|institutional_flow_reports)\b", _mk + _ins + _ret))
