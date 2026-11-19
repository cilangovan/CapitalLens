"""Run: python tests/standards_test.py — the machine-checkable part of CLAUDE.md (the owner's standing rules).
1. CLAUDE.md exists and still carries every section.  2. No Claude/Anthropic/Co-Authored-By in commit messages.
3. Every dashboard gets every module (legacy page and demo page load the same scripts).
4. Every table the dashboards read is served: by the legacy worker, the private app's shim, or is a documented private-app-only route.
5. No inline <script> blocks or javascript: URLs (strict CSP) in the source pages.  6. Generated pages exist for every dashboard."""
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
hits = [c.split("\x1f")[0][:8] for c in log.split("\x1e") if re.search(r"co-authored-by|claude|anthropic", c, re.I)]
check("no Claude / Anthropic / Co-Authored-By signature in any commit message", not hits, f"commits: {hits[:5]}")

def scripts(f): return {s.split("/")[-1] for s in re.findall(r'<script src="([^"?]+)', (ROOT / f).read_text())}
variant = {"auth.js", "demo-auth.js", "demo-shim.js"}
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

check("generated pages exist for every dashboard", all((ROOT / p).exists() for p in ("docs/app/index.html", "docs/zkapp/index.html", "docs/zkapp-prod/index.html")))
print("\nstandards: " + ("all good" if not bad else f"{bad} failed")); sys.exit(1 if bad else 0)
