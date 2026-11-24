"""Run: python tests/regression_register_test.py [--write]
The bug → guard register (tests/regression_register.json). Every bug that was fixed has ONE row: what broke, and the test that fails if it returns.
Checks: ids unique; the guard test exists; the marker text is really inside that test (so the guard still mentions the bug); the guard runs in CI
(workflows run it by name, or it matches a glob loop such as tests/zk_*_test.mjs); documentation/regression-register.md is in sync (--write regenerates it).
Adding a bug fix = add a row here in the same commit (CLAUDE.md rule 3)."""
import json, re, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
T = ROOT / "tests"; REG = json.loads((T / "regression_register.json").read_text()); DOC = ROOT / "documentation/regression-register.md"
wf = "\n".join(p.read_text() for p in (ROOT / ".github/workflows").glob("*.yml"))
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {extra}" if extra and not cond else "")); bad += 0 if cond else 1
_run = (ROOT / "scripts/regression_run.py").read_text()
_secret = set(re.findall(r'"([a-z_0-9]+\.py)"', _run[_run.index("NEEDS_SECRETS"):_run.index("BROWSER")]))
def in_ci(name):
    if name in wf: return True
    if "regression_run.py --browser" in wf and re.fullmatch(r"(zk_[a-z_0-9]+_test\.mjs|[a-z_0-9]+_test\.py)", name) and name not in _secret: return True     # the runner discovers every test file that needs no secrets
    return (name.startswith("zk_") and name.endswith("_test.mjs") and "tests/zk_*_test.mjs" in wf)

check("ids are unique and every row has all fields", len({r["id"] for r in REG}) == len(REG) and all({"id", "date", "area", "bug", "guard", "marker"} <= set(r) for r in REG))
GAPROWS = [r for r in REG if not r["guard"]]
for r in REG:
    if not r["guard"]: continue                                   # a gap row: listed in the page, counted below, never silently dropped
    g = T / r["guard"]
    ok = g.exists() and (not r["marker"] or re.search(r["marker"], g.read_text(errors="ignore"), re.I) is not None)
    check(f'{r["id"]} {r["area"]}: guard {r["guard"]} exists' + (f' and still mentions "{r["marker"]}"' if r["marker"] else ""), ok)
    check(f'{r["id"]} guard runs in CI', in_ci(r["guard"]))
print(f"  i {len(REG) - len(GAPROWS)} bugs guarded, {len(GAPROWS)} known gaps (fix commits with no automated test yet; listed in the register page)")

def render():
    ok = [r for r in REG if r["guard"]]; gaps = [r for r in REG if not r["guard"]]
    rows = "\n".join(f'| {r["id"]} | {r["date"]} | {r["area"]} | {r["bug"]} | `tests/{r["guard"]}` | {", ".join(r.get("commits", []))} |' for r in sorted(ok, key=lambda r: (r["date"], r["id"])))
    grows = "\n".join(f'| {r["id"]} | {r["date"]} | {r["area"]} | {r["bug"]} | {", ".join(r.get("commits", []))} |' for r in sorted(gaps, key=lambda r: (r["date"], r["id"])))
    return ("# Regression register (bug → guard test)\n\n> **Generated** by `python3 tests/regression_register_test.py --write` from `tests/regression_register.json`. Edit the JSON, not this page.\n\n"
            "Every bug that was fixed has a row here: what broke and the test that fails if it ever returns. The whole register runs in the **Regression & data quality** workflow "
            "(`.github/workflows/regression.yml`) on every push, on pull requests and nightly. Rule: a bug fix is not done until its row and its guard test are in the same commit.\n\n"
            "**Data quality** (`tests/data_quality_test.py`) runs in the same workflow: the data files in git (popular tickers, IPO calendar, Market Mood tabs) on every push, and nightly the live shared tables (market-cache freshness, IPO calendar rules). A nightly failure opens or updates one GitHub issue, \"Data quality failing\". Customer data is encrypted and is never inspected.\n\n"
            "| ID | Date | Area | What broke | Guard test | Fix commit |\n|---|---|---|---|---|---|\n" + rows + "\n\n## Known gaps (fixed, no automated test yet)\n\nFound automatically from git history by `scripts/regression_sync.py`. Most need a live service (Yahoo, Trading 212, Supabase) or a visual check that cannot run offline. Write the guard, then set `guard` on the row.\n\n| ID | Date | Area | What broke | Fix commit |\n|---|---|---|---|---|\n" + grows + "\n")
if "--write" in sys.argv: DOC.write_text(render()); print("wrote", DOC.relative_to(ROOT))
check("documentation/regression-register.md is in sync with the register (run with --write)", DOC.exists() and DOC.read_text() == render())
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
