#!/usr/bin/env python3
"""
CapitalLens — Security issue sync.

Reads documentation/security-scan-report.md and the JSON findings file
(documentation/security-findings.json) produced by security_scan.py --json,
then uses the GitHub CLI (gh) to:
  - Open a new issue for each finding not already tracked
  - Close issues whose finding has been resolved (no longer in the scan)
  - Add a comment to existing open issues with today's scan status

Each issue carries:
  - Title: [SECURITY][SEVERITY][LAYER] Short description
  - Labels: security, severity:<level>, layer:<frontend|worker|csp|database>
  - Body:  OWASP category, file, line, description, snippet, remediation hint

Usage (called by CI):
  python tests/security_issue_sync.py --findings documentation/security-findings.json
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LAYER_MAP = {
    "A03:XSS": "frontend",
    "A03:XSS/stored": "frontend",
    "A03:XSS/onclick-backslash": "frontend",
    "A03:XSS/eval": "frontend",
    "A02:Credentials": "frontend",
    "A07:Session": "frontend",
    "A05:CSP": "csp",
    "A05:CORS": "worker",
    "A05:Headers": "worker",
    "A05:Config": "worker",
    "A07:Auth": "worker",
    "A01:RLS": "database",
    "A10:SSRF": "worker",
}

REMEDIATION = {
    "A03:XSS/stored": "Wrap the DB-sourced field with the page's `esc()` equivalent before inserting into innerHTML/title/onclick.",
    "A03:XSS/onclick-backslash": "Escape backslashes (`replace(/\\\\/g, '\\\\\\\\')`) BEFORE escaping single-quotes in onclick attribute strings.",
    "A03:XSS/eval": "Replace `eval`/`new Function`/`document.write` with safe DOM APIs. Use `textContent` for text, `createElement` for HTML.",
    "A02:Credentials": "Remove the hardcoded secret. Use environment variables / GitHub Secrets / Cloudflare Secrets and never commit credentials.",
    "A07:Session": "Replace `localStorage.setItem` with `sessionStorage.setItem` for all session tokens (clears on tab close).",
    "A05:CSP": "Tighten the Content-Security-Policy header. See REC-001 in documentation/security-audit.md.",
    "A05:CORS": "Replace the wildcard `Allow-Origin: *` with the explicit allowed origin list.",
    "A05:Headers": "Add the missing security response header to the Cloudflare Worker. See REC-002 in documentation/security-audit.md.",
    "A07:Auth": "Ensure every authenticated route calls `verifySession()` before processing the request.",
}

SEVERITY_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}


def gh(*args, capture=True, check=True):
    """Run a gh CLI command."""
    cmd = ["gh"] + list(args)
    result = subprocess.run(cmd, capture_output=capture, text=True)
    if check and result.returncode != 0:
        print(f"  gh error: {result.stderr.strip()}", file=sys.stderr)
    return result


def existing_security_issues(owner_repo: str) -> dict[str, dict]:
    """Fetch open and recently closed security issues. Returns dict keyed by fingerprint."""
    result = gh(
        "issue", "list",
        "--repo", owner_repo,
        "--label", "security",
        "--state", "all",
        "--limit", "200",
        "--json", "number,title,state,body,labels",
    )
    if result.returncode != 0:
        return {}
    issues = json.loads(result.stdout)
    out = {}
    for iss in issues:
        # Extract fingerprint from body (<!-- fp: xxx --> comment)
        body = iss.get("body", "")
        import re
        m = re.search(r"<!-- fp: ([A-Za-z0-9_:\-/.]+) -->", body)
        if m:
            out[m.group(1)] = iss
    return out


def fingerprint(finding: dict) -> str:
    """Stable key for a finding — file + category (not line, since auto-fix shifts lines)."""
    return f"{finding['category']}::{finding['file']}"


def layer(category: str) -> str:
    return LAYER_MAP.get(category, "frontend")


def issue_title(f: dict) -> str:
    em = SEVERITY_EMOJI.get(f["severity"], "⚪")
    return f"[SECURITY][{f['severity'].upper()}][{layer(f['category']).upper()}] {em} {f['description'][:80]}"


def issue_body(f: dict, fp: str) -> str:
    rem = REMEDIATION.get(f["category"], "Review the finding and apply the appropriate fix.")
    snippet = f.get("snippet", "")
    snippet_block = f"```\n{snippet}\n```" if snippet else "_no snippet_"
    return f"""## Security Finding

**OWASP:** `{f['category']}`
**Severity:** {SEVERITY_EMOJI.get(f['severity'], '')} **{f['severity'].upper()}**
**Layer:** {layer(f['category'])}
**File:** `{f['file']}`{f':' + str(f['line']) if f.get('line') else ''}
**Auto-fixable:** {'✅ Yes — run `python tests/security_scan.py --fix`' if f.get('fixable') else '❌ Manual fix required'}
**Detected:** {f.get('detected_at', 'CI scan')}

### Description
{f['description']}

### Snippet
{snippet_block}

### Remediation
{rem}

### References
- [OWASP Top 10 {f['category'].split(':')[0]}](https://owasp.org/Top10/)
- `tests/security_scan.py` — automated scanner
- `documentation/security-audit.md` — full audit report

---
<!-- fp: {fp} -->
"""


def sync(findings_path: Path, owner_repo: str, dry_run: bool = False):
    findings = json.loads(findings_path.read_text()) if findings_path.exists() else []
    existing = existing_security_issues(owner_repo)

    new_count = closed_count = updated_count = 0
    current_fps = set()

    for f in findings:
        fp = fingerprint(f)
        current_fps.add(fp)
        sev = f["severity"]
        lyr = layer(f["category"])
        labels = f"security,severity:{sev},layer:{lyr}"

        if fp in existing:
            iss = existing[fp]
            if iss["state"] == "CLOSED":
                # Regressed — reopen
                print(f"  Reopening #{iss['number']}: {fp}")
                if not dry_run:
                    gh("issue", "reopen", str(iss["number"]), "--repo", owner_repo)
                    gh("issue", "comment", str(iss["number"]), "--repo", owner_repo,
                       "--body", f"⚠️ **Regression detected** — this finding reappeared in the latest scan.\n\nAuto-fix: `python tests/security_scan.py --fix`")
                updated_count += 1
            # Already open — just comment with today's scan confirmation
            # (don't spam on every daily run; skip if already updated today)
        else:
            # New finding — open issue
            title = issue_title(f)
            body = issue_body(f, fp)
            print(f"  Creating issue [{sev.upper()}][{lyr}]: {f['description'][:60]}")
            if not dry_run:
                result = gh(
                    "issue", "create",
                    "--repo", owner_repo,
                    "--title", title,
                    "--body", body,
                    "--label", labels,
                )
                if result.returncode == 0:
                    new_count += 1
                    print(f"    → {result.stdout.strip()}")

    # Close issues for findings that are no longer present (fixed)
    for fp, iss in existing.items():
        if fp not in current_fps and iss["state"] == "OPEN":
            print(f"  Closing #{iss['number']} (resolved): {fp}")
            if not dry_run:
                gh("issue", "close", str(iss["number"]), "--repo", owner_repo,
                   "--comment", "✅ **Resolved** — this finding no longer appears in the latest security scan.\n\nClosed automatically by `tests/security_issue_sync.py`.",
                   "--reason", "completed")
            closed_count += 1

    print(f"\n  Issues: {new_count} opened · {closed_count} closed · {updated_count} reopened")
    return new_count, closed_count, updated_count


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--findings", required=True, help="Path to security-findings.json")
    p.add_argument("--repo", default="cilangovan/CapitalLens")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    sync(Path(args.findings), args.repo, dry_run=args.dry_run)
