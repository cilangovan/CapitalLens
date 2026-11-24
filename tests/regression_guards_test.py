"""Run: python tests/regression_guards_test.py
Static guards for bugs that unit tests cannot see (listed in tests/regression_register.json: R13, R14).
R13  Cloudflare Workers reject fetch(..., {redirect:'error'}) at RUNTIME, so every relay call failed even though unit tests passed.
R14  A data file the code needs was hidden by .gitignore, so CI never saw it: every file under config/ must be tracked by git."""
import re, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {extra}" if extra and not cond else "")); bad += 0 if cond else 1

PAT = re.compile(r"""redirect\s*:\s*['"]error['"]""")
self_test = bool(PAT.search("fetch(u,{redirect:'error'})")) and bool(PAT.search('fetch(u, { redirect: "error" })')) and not PAT.search("redirect: 'manual'")
check("self-test: the pattern flags redirect:'error' and allows manual/follow", self_test)
offenders = [str(p.relative_to(ROOT)) for p in list((ROOT / "cloudflare-worker").glob("*.js")) + list((ROOT / "docs").rglob("*.js")) + list((ROOT / "services").rglob("*.js")) if PAT.search(p.read_text(errors="ignore"))]
check("R13 no Worker / browser script uses fetch redirect:'error' (Workers reject it at runtime)", not offenders, str(offenders))

tracked = set(subprocess.run(["git", "ls-files", "config", "tests"], cwd=ROOT, capture_output=True, text=True).stdout.split())
on_disk = {str(p.relative_to(ROOT)) for d in ("config", "tests") for p in (ROOT / d).glob("*") if p.is_file() and "__pycache__" not in str(p)}
check("R14 every file under config/ and tests/ is tracked by git (an ignore rule must not hide it from CI)", on_disk <= tracked, str(sorted(on_disk - tracked)))
check("R14 the Swing back-test result docs/data/swing_backtest.json is not hidden by .gitignore (the workflow could not commit it, so the tab never saw a result)", subprocess.run(["git", "check-ignore", "-q", "docs/data/swing_backtest.json"], cwd=ROOT).returncode == 1)
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
