#!/usr/bin/env python3
"""Run every regression, data-quality and standards suite, record each check as pass/fail, and (when credentials exist) log the run to the database.
  python3 scripts/regression_run.py                 run all suites, print a summary, write regression_report.json
  python3 scripts/regression_run.py --log           also POST the run to public.regression_runs / regression_results (needs SUPABASE_URL + SUPABASE_SERVICE_KEY)
  python3 scripts/regression_run.py --only tests/zk_dedupe_test.mjs ...   run just these
The suite list is built automatically: every tests/*_test.py and tests/zk_*_test.mjs, minus the ones that need secrets/Playwright unless --browser is given.
A new test file is therefore picked up with no edit here. Exit 1 if any check failed (so the workflow goes red) - the database log is written either way."""
import json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; T = ROOT / "tests"
NEEDS_SECRETS = {"ui_layout_test.py", "live_smoke.py", "security_check.py", "security_scan.py", "security_email.py", "security_issue_sync.py"}   # real database / live site
BROWSER = ({p.name for p in T.glob("*_layout_test.py")} | {"login_flash_browser_test.py", "ipo_watch_browser_test.py"}) - NEEDS_SECRETS
ARGS = sys.argv[1:]
def discover():
    py = sorted(p for p in T.glob("*_test.py"))
    js = sorted(T.glob("zk_*_test.mjs"))
    out = [p for p in py + js if p.name not in NEEDS_SECRETS and (p.name not in BROWSER or "--browser" in ARGS)]
    if "--only" in ARGS: out = [ROOT / a for a in ARGS[ARGS.index("--only") + 1:] if not a.startswith("--")]
    return out
REG = json.loads((T / "regression_register.json").read_text())
def bug_ids(name): return ",".join(r["id"] for r in REG if r["guard"] == name)
LINE = re.compile(r"^\s*(?:[✓✔]|PASS:?|ok\b)\s*(.+)$|^\s*(?:[✗✘]|FAIL:?)\s*(.+)$")
def run(path):
    cmd = ["node", str(path)] if path.suffix == ".mjs" else [sys.executable, str(path)]
    t0 = time.time(); p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
    out = (p.stdout or "") + (p.stderr or ""); res = []; lines = out.splitlines()
    for i, l in enumerate(lines):
        m = LINE.match(l)
        if m and (m.group(1) or m.group(2)) and not re.match(r"^\s*(?:PASS|FAIL)\s*$", l):
            ok = m.group(1) is not None; detail = ""
            if not ok: detail = " | ".join(x.strip() for x in lines[i + 1:i + 3] if x.startswith("      "))[:500]
            res.append({"check": (m.group(1) or m.group(2)).strip()[:300], "status": "pass" if ok else "fail", "detail": detail})
    if not res:                                                    # a suite that prints no per-check lines: one row for the whole file
        res.append({"check": "suite exit code", "status": "pass" if p.returncode == 0 else "fail", "detail": "" if p.returncode == 0 else out[-400:]})
    elif p.returncode != 0 and not any(r["status"] == "fail" for r in res):
        res.append({"check": "suite exit code", "status": "fail", "detail": out[-400:]})
    return res, round(time.time() - t0, 1)

suites = []; t_all = time.time()
for path in discover():
    rel = str(path.relative_to(ROOT)); res, secs = run(path)
    f = sum(r["status"] == "fail" for r in res); print(f"{'FAIL' if f else 'ok  '} {rel}  {len(res) - f} pass, {f} fail  ({secs}s)")
    for r in res:
        if r["status"] == "fail": print(f"       ✗ {r['check']}  {r['detail'][:160]}")
    suites.append({"suite": rel, "bug_ids": bug_ids(path.name), "results": res})
total = sum(len(s["results"]) for s in suites); failed = sum(r["status"] == "fail" for s in suites for r in s["results"])
sha = os.environ.get("GITHUB_SHA") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
run_row = {"commit_sha": sha, "ref": os.environ.get("GITHUB_REF_NAME") or "local", "trigger": os.environ.get("GITHUB_EVENT_NAME") or "local", "total": total, "passed": total - failed, "failed": failed,
           "duration_s": round(time.time() - t_all, 1), "run_url": (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else None)}
(ROOT / "regression_report.json").write_text(json.dumps({"run": run_row, "suites": suites}, indent=1))
print(f"\n{total - failed}/{total} checks pass, {failed} fail across {len(suites)} suites")

def post(path, body, prefer="return=representation"):
    rq = urllib.request.Request(os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path, data=json.dumps(body).encode(), method="POST",
        headers={"apikey": os.environ["SUPABASE_SERVICE_KEY"], "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_KEY"], "Content-Type": "application/json", "Prefer": prefer})
    return json.loads(urllib.request.urlopen(rq, timeout=60).read() or "null")
if "--log" in ARGS:
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY")): print("--log: SUPABASE_URL / SUPABASE_SERVICE_KEY not set, so the run was NOT logged to the database (report is in regression_report.json)")
    else:
        try:
            rid = post("regression_runs", run_row)[0]["id"]
            rows = [{"run_id": rid, "suite": s["suite"], "check_name": r["check"], "status": r["status"], "detail": r["detail"] or None, "bug_ids": s["bug_ids"] or None} for s in suites for r in s["results"]]
            for i in range(0, len(rows), 500): post("regression_results", rows[i:i + 500], "return=minimal")
            print(f"logged run {rid} ({len(rows)} results) to the database")
        except Exception as e: print(f"--log: could not write to the database: {e}"); failed = failed or 0
sys.exit(1 if failed else 0)
