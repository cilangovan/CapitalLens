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
def in_ci(name):
    if name in wf: return True
    return (name.startswith("zk_") and name.endswith("_test.mjs") and "tests/zk_*_test.mjs" in wf)

check("ids are unique and every row has all fields", len({r["id"] for r in REG}) == len(REG) and all({"id", "date", "area", "bug", "guard", "marker"} <= set(r) for r in REG))
for r in REG:
    g = T / r["guard"]
    ok = g.exists() and re.search(r["marker"], g.read_text(errors="ignore"), re.I) is not None
    check(f'{r["id"]} {r["area"]}: guard {r["guard"]} exists and still mentions "{r["marker"]}"', ok)
    check(f'{r["id"]} guard runs in CI', in_ci(r["guard"]))

GAPS = [  # bugs that are fixed but not fully guarded yet (to be logged as GitHub issues labelled regression-gap; the session could not create issues)
 ("G1", "Python vs JS number formatting parity: Python rounds halves to even, JS rounds halves up (8.5% showed as 8% vs 9%). Parity tests compare values and buckets, not formatted text."),
 ("G2", "Table inventory gate is a manual SQL query: a customer table missing from migrate.js TABLES (analyst_ratings) is only caught by hand. Needs a nightly check; required before cutover step 7."),
 ("G3", "360px header overflow is guarded only by ui_layout_test.py, which needs Supabase secrets. Needs a synthetic-data header test that runs everywhere."),
 ("G4", "Backfill older fix commits into this register; build the real-browser end-to-end test (login, Analyst, Lynch) from issue #9; run data_quality_test.py --live once with real secrets (not run offline)."),
]
def render():
    rows = "\n".join(f'| {r["id"]} | {r["date"]} | {r["area"]} | {r["bug"]} | `tests/{r["guard"]}` |' for r in sorted(REG, key=lambda r: r["id"]))
    return ("# Regression register (bug → guard test)\n\n> **Generated** by `python3 tests/regression_register_test.py --write` from `tests/regression_register.json`. Edit the JSON, not this page.\n\n"
            "Every bug that was fixed has a row here: what broke and the test that fails if it ever returns. The whole register runs in the **Regression & data quality** workflow "
            "(`.github/workflows/regression.yml`) on every push, on pull requests and nightly. Rule: a bug fix is not done until its row and its guard test are in the same commit.\n\n"
            "**Data quality** (`tests/data_quality_test.py`) runs in the same workflow: the data files in git (popular tickers, IPO calendar, Market Mood tabs) on every push, and nightly the live shared tables (market-cache freshness, IPO calendar rules). A nightly failure opens or updates one GitHub issue, \"Data quality failing\". Customer data is encrypted and is never inspected.\n\n"
            "| ID | Date | Area | What broke | Guard test |\n|---|---|---|---|---|\n" + rows + "\n\n## Known gaps (fixed, not fully guarded yet)\n\n" + "\n".join(f"- **{g}** {d}" for g, d in GAPS) + "\n")
if "--write" in sys.argv: DOC.write_text(render()); print("wrote", DOC.relative_to(ROOT))
check("documentation/regression-register.md is in sync with the register (run with --write)", DOC.exists() and DOC.read_text() == render())
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
