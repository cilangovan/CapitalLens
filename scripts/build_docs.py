#!/usr/bin/env python3
"""Builds the documentation portal.

  documentation/**/*.md   hand-written product docs (the source; readable on GitHub as they are)
  documentation/reference/*.md   GENERATED here from the code, so they cannot drift:
        database-tables.md  every table + column, from db/schema.sql and db/tenant/*.sql
        workflows.md        every GitHub Actions workflow + its triggers, from .github/workflows/*.yml
        menu-map.md         every dashboard menu -> tab id -> loader, from docs/index.html + docs/js/router.js
  docs/help/**/*.html     the portal (GitHub Pages), rendered from the markdown, linked from every dashboard footer

Run:  python3 scripts/build_docs.py          rebuild
      python3 scripts/build_docs.py --check  exit 1 if anything on disk is stale (CI + tests/standards_test.py)
"""
import html, pathlib, re, sys
import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "documentation"
OUT = ROOT / "docs" / "help"
REPO = "https://github.com/cilangovan/CapitalLens"

# Portal navigation: (section, [(markdown path relative to documentation/, title)]).
# Every .md under documentation/ must appear here (tests/standards_test.py checks).
NAV = [
    ("Start here", [("README.md", "Documentation home"), ("product-overview.md", "Product overview")]),
    ("Menus", [
        ("menus/app-shell.md", "App shell: sign-in, header, footer"),
        ("menus/overview.md", "📊 Overview"), ("menus/pnl-bubbles.md", "🫧 P&L Bubbles"),
        ("menus/positions.md", "📋 Positions"), ("menus/analyst.md", "🔬 Analyst"),
        ("menus/strategy.md", "🎯 Strategy"), ("menus/profit-booking.md", "💰 Profit Booking"),
        ("menus/returns.md", "📈 Returns"), ("menus/watchlist.md", "⭐ Watchlist & IPO Watch"),
        ("menus/alerts.md", "🔔 Alerts"), ("menus/settings-and-account.md", "⚙ Settings & account"),
    ]),
    ("Requirements", [("requirements/README.md", "Requirements pack: index"), ("requirements/prd.md", "Product requirements"),
                      ("requirements/ui-requirements.md", "UI requirements and wireframes"), ("requirements/chart-requirements.md", "Chart requirements"),
                      ("requirements/data-requirements.md", "Data and database requirements"), ("requirements/security-requirements.md", "Security requirements"),
                      ("requirements/logging-requirements.md", "Logging and audit requirements"), ("requirements/traceability.md", "Traceability and gap register"),
                      ("requirements/epic-support-levels.md", "Epic: Support Levels")]),
    ("Design", [("ui-design-system.md", "UI & style guide")]),
    ("Data", [("database.md", "Database & data flows"), ("reference/database-tables.md", "Table reference (generated)")]),
    ("Operations", [("workflows.md", "Workflows & schedules"), ("reference/workflows.md", "Workflow reference (generated)"),
                    ("architecture-and-security.md", "Architecture & security"),
                    ("ops-dashboard.md", "Internal ops dashboard (planned)"),
                    ("demo.md", "Demo user (pre-sales)"),
                    ("demo-requirements.md", "Demo user: requirements and wireframes")]),
    ("Engineering", [("engineering-guide.md", "Engineering guide"), ("reference/menu-map.md", "Menu map (generated)")]),
]
PAGES = [p for _, items in NAV for p, _ in items]
TITLES = {p: t for _, items in NAV for p, t in items}

# ───────────────────────── generated reference pages ─────────────────────────
COL_SKIP = ("primary", "unique", "constraint", "foreign", "check", "exclude", "like")

def tables():
    """table name -> {cols: [(name, definition)], files: set}. Sources: db/schema.sql (prod rebuild) + db/tenant/*.sql."""
    out = {}
    files = [ROOT / "db/schema.sql"] + sorted((ROOT / "db/tenant").glob("*.sql"))
    for f in files:
        txt = f.read_text()
        for m in re.finditer(r"create table (?:if not exists )?public\.(\w+)\s*\((.*?)\n\)\s*;", txt, re.S | re.I):
            name, body = m.group(1), m.group(2)
            t = out.setdefault(name, {"cols": {}, "files": []})
            rel = str(f.relative_to(ROOT))
            if rel not in t["files"]:
                t["files"].append(rel)
            depth = 0; cur = ""; parts = []
            for ch in body:                                   # split on top-level commas only
                depth += ch == "("; depth -= ch == ")"
                if ch == "," and depth == 0: parts.append(cur); cur = ""
                else: cur += ch
            parts.append(cur)
            for p in parts:
                p = re.sub(r"--.*", "", p).strip()
                if not p or p.split()[0].lower().strip('"') in COL_SKIP: continue
                cname, _, rest = p.partition(" ")
                t["cols"].setdefault(cname.strip('"'), " ".join(rest.split()))
    return out

def table_comments():
    c = {}
    for f in [ROOT / "db/schema.sql"] + sorted((ROOT / "db/tenant").glob("*.sql")):
        for m in re.finditer(r"comment on table public\.(\w+) is\s*'((?:[^']|'')*)'", f.read_text(), re.I):
            c[m.group(1)] = m.group(2).replace("''", "'")
    return c

def gen_tables():
    t, cm = tables(), table_comments()
    lines = ["# Table reference", "",
             "> **Generated** by `scripts/build_docs.py` from `db/schema.sql` and `db/tenant/*.sql`. Do not edit by hand; change the SQL and rebuild.",
             "> Concepts, data flows and who writes each table are in [Database & data flows](../database.md).", "",
             f"{len(t)} tables in the `public` schema.", "",
             "| Table | Columns | Defined in |", "|---|---|---|"]
    for n in sorted(t):
        lines.append(f"| [`{n}`](#{n}) | {len(t[n]['cols'])} | {', '.join('`'+f+'`' for f in t[n]['files'])} |")
    for n in sorted(t):
        lines += ["", f"## {n}", ""]
        if n in cm: lines += [cm[n], ""]
        lines += ["| Column | Definition |", "|---|---|"]
        lines += [f"| `{c}` | `{d.replace('|', '/')}` |" for c, d in t[n]["cols"].items()]
    return "\n".join(lines) + "\n"

def workflows():
    out = []
    for f in sorted((ROOT / ".github/workflows").glob("*.yml")):
        txt = f.read_text()
        name = (re.search(r"^name:\s*(.+)$", txt, re.M) or [None, f.stem])[1].strip().strip("'\"")
        crons = [(m.group(1), (m.group(2) or "").strip()) for m in re.finditer(r"- cron:\s*['\"]([^'\"]+)['\"]\s*(?:#\s*(.*))?", txt)]
        commented = bool(re.search(r"^\s*#\s*- cron:", txt, re.M))
        on = []
        if re.search(r"^\s*push:", txt, re.M): on.append("push")
        if re.search(r"^\s*pull_request:", txt, re.M): on.append("pull request")
        if "workflow_dispatch" in txt: on.append("manual")
        if "repository_dispatch" in txt: on.append("repository_dispatch")
        if "workflow_run" in txt: on.append("after another workflow")
        cmds = []
        for m in re.finditer(r"run:\s*(?:\|\s*\n((?:\s+.+\n)+)|(.+))", txt):
            for l in (m.group(1) or m.group(2) or "").splitlines():
                l = l.strip()
                if re.match(r"(python3?|node|bash)\s", l) and "pip" not in l: cmds.append(l.split("#")[0].strip())
        out.append(dict(file=f.name, name=name, crons=crons, commented=commented, on=on, cmds=cmds[:8]))
    return out

def gen_workflows():
    w = workflows()
    lines = ["# Workflow reference", "",
             "> **Generated** by `scripts/build_docs.py` from `.github/workflows/*.yml`. Do not edit by hand.",
             "> What each pipeline is for, and the order data moves, is in [Workflows & schedules](../workflows.md).", "",
             f"{len(w)} workflows. Times are UTC. Per the standing rule, the owner's own morning Refresh is what runs analysis for the private app; these workflows cover shared/public data, the legacy dashboard, tests and maintenance.", "",
             "| Workflow | File | Runs when | Schedule (UTC) |", "|---|---|---|---|"]
    for x in w:
        sched = "<br>".join(f"`{c}`" + (f" {n}" if n else "") for c, n in x["crons"]) or ("(schedule disabled)" if x["commented"] else "—")
        lines.append(f"| {x['name']} | `{x['file']}` | {', '.join(x['on']) or '—'} | {sched} |")
    for x in w:
        if x["cmds"]:
            lines += ["", f"## {x['name']}", "", f"`.github/workflows/{x['file']}`", "", "```"] + x["cmds"] + ["```"]
    return "\n".join(lines) + "\n"

def gen_menu_map():
    idx = (ROOT / "docs/index.html").read_text()
    nav = re.findall(r"""<button[^>]*onclick="showTab\('(\w+)',this\)"[^>]*>(.*?)</button>""", idx)
    router = (ROOT / "docs/js/router.js").read_text()
    loaders = dict(re.findall(r"^\s+(\w+):\s+(?:async \(\) => \{.*?await )?(load\w+)", router, re.M))
    lines = ["# Menu map", "",
             "> **Generated** by `scripts/build_docs.py` from `docs/index.html` (nav) and `docs/js/router.js` (loaders). Do not edit by hand.", "",
             "| Menu | Tab id (`<div id=…>`) | Loader | Page |", "|---|---|---|---|"]
    for tab, label in nav:
        label = html.unescape(re.sub(r"<[^>]+>", "", label)).strip()
        page = next((p for p in PAGES if p.startswith("menus/") and p.split("/")[1].removesuffix(".md") in
                     {"overview": "overview", "heatmap": "pnl-bubbles", "positions": "positions", "analyst": "analyst", "strategy": "strategy",
                      "profit": "profit-booking", "returns": "returns", "watchlist": "watchlist", "alerts": "alerts"}.get(tab, "?")), None)
        lines.append(f"| {label} | `{tab}` | `{loaders.get(tab, '?')}()` | {('[' + TITLES[page] + '](../' + page + ')') if page else '**missing**'} |")
    return "\n".join(lines) + "\n"

GENERATED = {"reference/database-tables.md": gen_tables, "reference/workflows.md": gen_workflows, "reference/menu-map.md": gen_menu_map}

# ───────────────────────── HTML rendering ─────────────────────────
CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"

def render(page, md_text):
    depth = page.count("/")
    up = "../" * depth
    def fix(m):                                               # relative .md links -> .html
        h = m.group(1)
        if re.match(r"[a-z]+:|#|/", h): return m.group(0)
        return f'href="{re.sub(r"\.md(#|$)", r".html\1", h)}"'
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "toc", "sane_lists"], extension_configs={"toc": {"permalink": False}})
    body = re.sub(r'href="([^"]+)"', fix, body)
    body = re.sub(r"<table>", '<div class="tbl"><table>', body).replace("</table>", "</table></div>")
    body = re.sub(r"<pre>", '<div class="code"><pre>', body).replace("</pre>", "</pre></div>")
    home = "index.html"
    def href(p): return up + ("index.html" if p == "README.md" else p[:-3] + ".html")
    nav = "".join(
        f'<div class="nav-sec">{html.escape(sec)}</div>' + "".join(
            f'<a href="{href(p)}"{" class=cur" if p == page else ""}>{html.escape(t)}</a>' for p, t in items)
        for sec, items in NAV)
    title = TITLES.get(page, page)
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)} · CapitalLens documentation</title>
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="{up}help.css">
</head><body>
<!-- GENERATED by scripts/build_docs.py from documentation/{page}. Edit the markdown, not this file. -->
<header class="top"><a class="brand" href="{up}index.html">🌐 CapitalLens <span>documentation</span></a>
<a class="back" href="{up}../">← Open the app</a></header>
<div class="layout"><details class="side side-m"><summary>Contents</summary><nav>{nav}</nav></details><div class="side side-d"><nav>{nav}</nav></div>
<main><article>{body}</article>
<footer class="foot"><a href="{REPO}/blob/main/documentation/{page}">Edit this page on GitHub</a> · <a href="{up}../">Back to the dashboard</a> · <a href="{up}index.html">Documentation home</a></footer></main></div>
</body></html>
"""

def build(check=False):
    stale = []
    def put(path, text):
        if check:
            if not path.exists() or path.read_text() != text: stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)
    for rel, fn in GENERATED.items():
        put(SRC / rel, fn())
    for page in PAGES:
        f = SRC / page
        if not f.exists():
            stale.append(f"documentation/{page} (missing)"); continue
        out = OUT / ("index.html" if page == "README.md" else page[:-3] + ".html")
        put(out, render(page, f.read_text()))
    return stale

if __name__ == "__main__":
    chk = "--check" in sys.argv
    stale = build(check=chk)
    if chk:
        if stale: print("documentation is stale or missing - run python3 scripts/build_docs.py:\n  " + "\n  ".join(stale)); sys.exit(1)
        print("documentation up to date")
    else:
        print(f"built {len(PAGES)} pages -> docs/help/")
