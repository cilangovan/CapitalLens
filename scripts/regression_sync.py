#!/usr/bin/env python3
"""Keep tests/regression_register.json up to date from git history, automatically.
  python3 scripts/regression_sync.py            report: fix commits that have no register row yet
  python3 scripts/regression_sync.py --write    add a row for every fix commit not yet in the register, then regenerate documentation/regression-register.md
  python3 scripts/regression_sync.py --check    exit 1 if a fix commit made AFTER the baseline touched no test file (rule 3: every bug fix ships a regression test);
                                                put [no-test: reason] in the commit message for the rare fix that cannot have one
A 'fix commit' is a subject starting with fix / bug / hotfix / security (any case). The guard of an auto row is the test file(s) that same commit touched; if it touched none,
the row is a GAP (shown in the register page and counted) until a guard is written and the row is edited. Rows are never deleted or rewritten, only added."""
import json, re, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; REGF = ROOT / "tests/regression_register.json"
BASELINE = "3cd0bc8"            # the commit that introduced the register; --check only judges commits after it
FIX = re.compile(r"^(fix|bug|hotfix|security)\b", re.I)
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout
def commits():
    out = []
    for l in git("log", "--no-merges", "--format=%H|%h|%ad|%s", "--date=short").splitlines():
        full, short, d, subj = l.split("|", 3)
        if FIX.match(subj): out.append((full, short, d, subj))
    return out
def tests_touched(full): return sorted({Path(f).name for f in git("show", "--name-only", "--format=", full).split() if f.startswith("tests/") and Path(f).suffix in (".py", ".mjs", ".sql") and "regression_register" not in f})
def area(subj):
    m = re.match(r"^\w+\(([^)]+)\)", subj)
    if m: return m.group(1)
    for k in ("analyst", "value-buy", "value_buy", "history", "returns", "cors", "worker", "security", "sign-in", "strategy", "radial", "sector"):
        if k in subj.lower(): return k.replace("_", "-")
    return "general"
reg = json.loads(REGF.read_text()); known = {c for r in reg for c in r.get("commits", [])}
def seen(short): return any(short.startswith(k) or k.startswith(short) for k in known)
new = []
for full, short, d, subj in commits():
    if seen(short): continue
    t = tests_touched(full)
    new.append({"id": "A" + short, "date": d, "area": area(subj), "bug": re.sub(r"\s+", " ", subj)[:200], "guard": t[0] if len(t) == 1 else (t[0] if t else ""), "marker": "", "commits": [short], "auto": True})
if "--check" in sys.argv:
    base_set = set(git("rev-list", f"{BASELINE}..HEAD").split()); bad = []
    for full, short, d, subj in commits():
        if full in base_set and not tests_touched(full) and "[no-test" not in git("log", "-1", "--format=%B", full): bad.append(f"{short} {subj[:70]}")
    for b in bad: print("  ✗ fix commit with no test file:", b)
    print("PASS: every fix since the register began ships a test" if not bad else "FAIL: add a guard test (and a register row), or put [no-test: reason] in the commit message")
    sys.exit(1 if bad else 0)
print(f"{len(new)} fix commits not in the register yet ({sum(1 for n in new if n['guard'])} with a test touched in the same commit, {sum(1 for n in new if not n['guard'])} gaps)")
for n in new[:60]: print(" ", n["id"], n["date"], (n["guard"] or "GAP"), "-", n["bug"][:70])
if "--write" in sys.argv and new:
    reg += sorted(new, key=lambda r: r["date"]); REGF.write_text(json.dumps(reg, indent=1, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(ROOT / "tests/regression_register_test.py"), "--write"], cwd=ROOT)
    print(f"added {len(new)} rows")
