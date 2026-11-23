#!/usr/bin/env python3
"""
CapitalLens — OWASP-aligned security scanner and auto-fixer.

OWASP checks covered:
  A03 Injection / XSS
    • Stored XSS: DB-sourced string fields in innerHTML / title= / onclick= without esc()
    • onclick backslash injection: replace(/'/g, ...) without prior replace(/\\/g, ...)
    • e.message exposure: error.message in innerHTML without esc()
    • eval / new Function / document.write / string timers in source
  A05 Security Misconfiguration
    • CSP present and strict (no wildcard script-src, connect-src locked)
    • unsafe-inline in script-src (warning, not failure — still a backlog item)
    • Missing security headers in Cloudflare Worker
  A02 Cryptographic / Credential Failures
    • Hardcoded secrets (JWT eyJ…, sk_/pk_/ghp_/glpat_ patterns)
    • Session token in localStorage (must only be sessionStorage)
  A07 Auth / Session
    • Worker verifySession gate on every authenticated route

Auto-fix mode (--fix):
  When an unescaped DB field is found in an innerHTML/title/onclick context, the scanner
  wraps it with the nearest esc-equivalent function already imported on that page.
  It outputs a unified diff and re-writes the file. The original is backed up as .bak.
  After fixing, it runs itself again to confirm zero findings.

Usage:
  python tests/security_scan.py              # scan only, exit 0 or 1
  python tests/security_scan.py --fix        # scan, auto-fix, re-scan; exit 0 if clean
  python tests/security_scan.py --report     # scan, write documentation/security-scan-report.md
"""

import argparse
import difflib
import json
import os
import re
import shutil
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_DIR = ROOT / "docs" / "js"
WORKER = ROOT / "cloudflare-worker" / "worker.js"
REPORT_PATH = ROOT / "documentation" / "security-scan-report.md"

# ── Esc-equivalent function names ────────────────────────────────────────────
# Maps JS file name → esc function used on that page
# 'esc' is the global defined in api.js and available everywhere
FILE_ESC = {
    "drilldown.js": "ddEsc",
    "pie_drill.js": "pdEsc",
    "dipplan.js":   "dpEsc",
    "watchlist.js": "_wesc",
    "heatmap.js":   "_hmEsc",
    "alerts.js":    "_esc",
}

def esc_fn(filename: str) -> str:
    return FILE_ESC.get(filename, "esc")

# ── DB field patterns (string data, not numeric/boolean) ─────────────────────
# Variable prefixes: single letters that commonly hold DB row objects in this codebase.
# Excluded: 'a' alone (too broad — matches AI tool iterator 'a.name', 'a.key', 'a.url')
DB_STRING_FIELD = re.compile(
    r"\b(?:r|h|p|x|s|u|sig|reg|n|d|item|stock|row|pos)\."
    r"(?:ticker|display|pie|name|action|sector|summary|report_date|decision"
    r"|buy_signal|sell_signal|notes|rule|volume|mode|flags|reason|confidence"
    r"|lynch_reason|lynch_confidence|yahoo_ticker|message|label|title|desc"
    r"|description|category|exchange|country|status|source|rating|signal|kind)\b"
    r"|e\.message\b|error\.message\b"
)

# Contexts that render into DOM
RISKY_CTX = re.compile(
    r"innerHTML\s*[+\-]?=|"
    r'title\s*=\s*[`"][^`"]*\$\{|'
    r'onclick\s*=\s*[`"][^`"]*\$\{'
)

# Existing esc function call patterns (prefix lookback — appears before or wrapping the field)
ESC_FNS = re.compile(
    r"\b(?:esc|ddEsc|pdEsc|dpEsc|_wesc|_hmEsc|_esc|encodeURIComponent|"
    r"fmtGbp|fmtGbpPlain|fmt|signed|money|Number|parseInt|parseFloat|Boolean)\s*\("
)

# Patterns that appear AFTER the field and indicate safe treatment
# e.g. p.ticker.replace(/\\/g,...) or (p.pie || '__ALL__').replace(...)
ESC_SUFFIX = re.compile(r"\.replace\s*\(")

# Hardcoded secret patterns
SECRET_PATTERNS = [
    (re.compile(r"eyJ[A-Za-z0-9_-]{20,}"),        "hardcoded JWT token"),
    (re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{20,}"), "Stripe secret key"),
    (re.compile(r"\bpk_(?:live|test)_[A-Za-z0-9]{20,}"), "Stripe public key"),
    (re.compile(r"\bghp_[A-Za-z0-9]{36}\b"),        "GitHub PAT"),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),     "GitLab PAT"),
    (re.compile(r"\bAKIA[A-Z0-9]{16}\b"),            "AWS access key"),
]

# ── Findings dataclass ────────────────────────────────────────────────────────

class Finding:
    SEVERITIES = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

    def __init__(self, file, line, col, severity, category, description, snippet, fixable=False):
        self.file        = str(file.relative_to(ROOT)) if hasattr(file, "relative_to") else file
        self.line        = line
        self.col         = col
        self.severity    = severity   # critical|high|medium|low|info
        self.category    = category   # e.g. "A03:XSS", "A05:CSP"
        self.description = description
        self.snippet     = snippet[:120]
        self.fixable     = fixable

    def __str__(self):
        sev = self.severity.upper().ljust(8)
        return f"  [{sev}] {self.file}:{self.line}  {self.category}  {self.description}\n           {self.snippet!r}"


# ── Scanner ───────────────────────────────────────────────────────────────────

def scan_js_xss(path: Path) -> list[Finding]:
    """Detect unescaped DB string fields in innerHTML / title / onclick contexts."""
    findings = []
    fn = path.name
    ef = esc_fn(fn)
    src = path.read_text()
    lines = src.splitlines()

    for i, line in enumerate(lines, 1):
        if not RISKY_CTX.search(line):
            continue
        db_matches = list(DB_STRING_FIELD.finditer(line))
        if not db_matches:
            continue
        for m in db_matches:
            start = m.start()
            # Look back to the nearest ${ or start-of-line for the esc context
            tpl_open = line.rfind("${", 0, start)
            prefix_start = tpl_open if tpl_open != -1 else max(0, start - 60)
            prefix = line[prefix_start:start]
            # Already escaped? (esc wraps the field, prefix contains the esc call opening)
            if ESC_FNS.search(prefix):
                continue
            # Field is the argument to a non-rendering method (.replace, .test, .includes, .indexOf…)
            suffix = line[start + len(m.group()):min(len(line), start + len(m.group()) + 60)]
            if re.search(r"^[\w\s]*\)\s*\?", suffix[:30]):
                # e.g. /regex/.test(e.message) ? — boolean usage, not rendered
                pass   # fall through to check the prefix for test(
            if ESC_SUFFIX.search(suffix[:30]):
                continue
            # Check if this occurrence is as an argument to a boolean/non-rendering method
            # Look for pattern: method(e.message) where method is non-rendering
            safe_method_ctx = re.search(
                r"\b(?:test|includes|indexOf|startsWith|endsWith|match|search|split|"
                r"toLowerCase|toUpperCase|trim|length)\s*\(\s*" + re.escape(m.group()),
                line[max(0, start - 30):start + len(m.group()) + 2]
            )
            if safe_method_ctx:
                continue
            # e.g. /regex/.test(e.message) — the field appears as the argument
            if re.search(r"\.\s*test\s*\(\s*" + re.escape(m.group()), line[max(0, start - 10):start + len(m.group()) + 2]):
                continue
            # Whole expression from ${ has a .replace( on it (e.g. (p.pie || '__ALL__').replace(...))
            expr_to_end = line[tpl_open:] if tpl_open != -1 else line[start:]
            if ESC_SUFFIX.search(expr_to_end[:80]):
                continue
            # Also check if the field is used only in a comparison (class=), not rendered
            # e.g. ${RT.period === x.label ? ...} — x.label not rendered, used as comparator
            surrounding = line[max(0, start - 5):min(len(line), start + len(m.group()) + 5)]
            if re.search(r"===?\s*" + re.escape(m.group()), surrounding) or \
               re.search(re.escape(m.group()) + r"\s*===?", surrounding):
                continue
            # onclick backslash check: replace(/'/g) without prior replace(/\\/g)
            if "onclick" in line and "replace(/'/g" in line and "replace(/\\\\/g" not in line:
                findings.append(Finding(
                    path, i, start, "high", "A03:XSS/onclick-backslash",
                    f"onclick single-quote escape missing backslash escape — `{m.group()}` can break out via backslash",
                    line.strip(), fixable=False,  # requires manual structural fix
                ))
                continue
            findings.append(Finding(
                path, i, start, "high", "A03:XSS/stored",
                f"unescaped DB field `{m.group()}` in DOM sink — wrap with {ef}()",
                line.strip(), fixable=True,
            ))
    return findings


def scan_js_secrets(path: Path) -> list[Finding]:
    findings = []
    # Skip vendor files
    if "vendor" in str(path):
        return findings
    src = path.read_text()
    for lineno, line in enumerate(src.splitlines(), 1):
        if line.strip().startswith("//"):
            continue
        for pat, label in SECRET_PATTERNS:
            if pat.search(line):
                findings.append(Finding(
                    path, lineno, 0, "critical", "A02:Credentials",
                    label + " pattern detected in source",
                    line.strip(), fixable=False,
                ))
    return findings


def scan_js_dangerous_calls(path: Path) -> list[Finding]:
    findings = []
    src = path.read_text()
    bad = re.compile(r"\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(|"
                     r"setTimeout\(\s*['\"`]|setInterval\(\s*['\"`]|innerHTML\s*\+=\s*[^e]")
    for lineno, line in enumerate(src.splitlines(), 1):
        if line.strip().startswith("//"):
            continue
        m = bad.search(line)
        if m:
            findings.append(Finding(
                path, lineno, m.start(), "high", "A03:XSS/eval",
                f"dangerous DOM/eval pattern: `{m.group()}`",
                line.strip(), fixable=False,
            ))
    return findings


def scan_session_storage(path: Path) -> list[Finding]:
    """Flag any token written to localStorage (must be sessionStorage only)."""
    findings = []
    src = path.read_text()
    local_re = re.compile(r"localStorage\s*\.\s*setItem\s*\([^)]*token", re.IGNORECASE)
    for lineno, line in enumerate(src.splitlines(), 1):
        if line.strip().startswith("//"):
            continue
        m = local_re.search(line)
        if m:
            findings.append(Finding(
                path, lineno, m.start(), "high", "A07:Session",
                "session token written to localStorage (must be sessionStorage only)",
                line.strip(), fixable=False,
            ))
    return findings


def scan_csp(html_path: Path) -> list[Finding]:
    findings = []
    if not html_path.exists():
        findings.append(Finding(html_path, 0, 0, "high", "A05:CSP", "HTML file not found", ""))
        return findings
    src = html_path.read_text()
    csp_m = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', src)
    if not csp_m:
        findings.append(Finding(html_path, 0, 0, "high", "A05:CSP", "No Content-Security-Policy meta tag", src[:80]))
        return findings
    pol = {}
    for directive in csp_m.group(1).split(";"):
        parts = directive.strip().split(None, 1)
        if parts:
            pol[parts[0]] = parts[1] if len(parts) > 1 else ""

    if "'none'" not in pol.get("default-src", "*"):
        findings.append(Finding(html_path, 0, 0, "medium", "A05:CSP", "default-src not 'none'", csp_m.group(0)[:80]))
    if "'none'" not in pol.get("object-src", "*"):
        findings.append(Finding(html_path, 0, 0, "medium", "A05:CSP", "object-src not 'none' (plugin attack vector)", csp_m.group(0)[:80]))
    if "'none'" not in pol.get("base-uri", "*"):
        findings.append(Finding(html_path, 0, 0, "medium", "A05:CSP", "base-uri not 'none' (base tag injection)", csp_m.group(0)[:80]))
    script_src = pol.get("script-src", "")
    if "*" in script_src or "http:" in script_src:
        findings.append(Finding(html_path, 0, 0, "critical", "A05:CSP", "script-src allows arbitrary scripts", script_src))
    if "'unsafe-inline'" in script_src:
        findings.append(Finding(html_path, 0, 0, "low", "A05:CSP",
            "unsafe-inline in script-src (backlog: migrate on* attrs to handlers.js)", script_src))
    if "'unsafe-eval'" in script_src:
        findings.append(Finding(html_path, 0, 0, "high", "A05:CSP", "unsafe-eval in script-src", script_src))
    conn = pol.get("connect-src", "*")
    if "*" in conn:
        findings.append(Finding(html_path, 0, 0, "high", "A05:CSP", "connect-src wildcard — allows data exfiltration to any host", conn))

    return findings


def scan_worker_headers(worker_path: Path) -> list[Finding]:
    findings = []
    if not worker_path.exists():
        return findings
    src = worker_path.read_text()
    checks = [
        ("X-Content-Type-Options", "medium", "A05:Headers", "X-Content-Type-Options header missing from worker"),
        ("Referrer-Policy",         "low",    "A05:Headers", "Referrer-Policy header missing from worker"),
        ("Strict-Transport-Security", "low",  "A05:Headers", "HSTS header missing from worker (REC-002)"),
        ("X-Frame-Options",         "low",    "A05:Headers", "X-Frame-Options header missing from worker"),
    ]
    for header, sev, cat, desc in checks:
        if header not in src:
            findings.append(Finding(worker_path, 0, 0, sev, cat, desc, ""))
    return findings


def scan_worker_auth(worker_path: Path) -> list[Finding]:
    findings = []
    if not worker_path.exists():
        return findings
    src = worker_path.read_text()
    if "verifySession" not in src:
        findings.append(Finding(worker_path, 0, 0, "critical", "A07:Auth",
            "No verifySession() found in worker — unauthenticated access possible", ""))
    if re.search(r"Allow-Origin['\"]?\s*:\s*['\"]\*", src):
        findings.append(Finding(worker_path, 0, 0, "high", "A05:CORS",
            "Wildcard CORS allow-origin in worker", ""))
    if "/auth/debug" in src:
        findings.append(Finding(worker_path, 0, 0, "high", "A05:Config",
            "Debug endpoint /auth/debug exists in worker", ""))
    return findings


# ── Auto-fixer ────────────────────────────────────────────────────────────────

def _wrap_field_with_esc(line: str, field_match: re.Match, ef: str) -> str:
    """
    Wraps the matched DB field expression with esc(). Handles:
      ${r.ticker}       → ${esc(r.ticker)}
      ${r.pie||'—'}     → ${esc(r.pie||'—')}
      ${h.notes?`...`:''}  — not auto-fixed (too complex)
    Returns modified line or original if pattern too complex.
    """
    # Find the template literal expression boundary: ${ ... }
    start = field_match.start()

    # Walk left to find the opening ${
    left = line.rfind("${", 0, start)
    if left == -1:
        return line

    # Walk right to find the closing }
    depth = 1
    right = left + 2
    while right < len(line) and depth > 0:
        if line[right] == "{":
            depth += 1
        elif line[right] == "}":
            depth -= 1
        right += 1

    if depth != 0:
        return line   # unbalanced — skip

    expr = line[left + 2:right - 1]  # content inside ${ }

    # Skip if already has esc or is too complex (ternary, nested template)
    if re.search(r"\besc\b|\bddEsc\b|\bpdEsc\b|\bdpEsc\b|\b_wesc\b|\b_hmEsc\b|\b_esc\b", expr):
        return line
    if "`" in expr or ("?" in expr and ":" in expr):
        return line   # ternary — too complex for auto-fix

    new_expr = f"{ef}({expr})"
    return line[:left + 2] + new_expr + line[right - 1:]


def autofix_file(path: Path, findings: list[Finding]) -> bool:
    """Apply auto-fixes for fixable XSS findings. Returns True if any changes made."""
    fixable = [f for f in findings if f.fixable and f.file == str(path.relative_to(ROOT))]
    if not fixable:
        return False

    ef = esc_fn(path.name)
    src = path.read_text()
    lines = src.splitlines(keepends=True)
    changed = False

    # Group by line number, process from bottom up to preserve offsets
    line_nums = sorted(set(f.line for f in fixable), reverse=True)
    for lineno in line_nums:
        idx = lineno - 1
        line = lines[idx]
        db_matches = list(DB_STRING_FIELD.finditer(line))
        for m in reversed(db_matches):  # right-to-left to preserve offsets
            prefix = line[max(0, m.start() - 20):m.start()]
            if ESC_FNS.search(prefix):
                continue
            new_line = _wrap_field_with_esc(line, m, ef)
            if new_line != line:
                lines[idx] = new_line
                line = new_line
                changed = True

    if changed:
        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        new_src = "".join(lines)
        # Print diff
        diff = list(difflib.unified_diff(
            src.splitlines(keepends=True),
            new_src.splitlines(keepends=True),
            fromfile=f"a/{path.relative_to(ROOT)}",
            tofile=f"b/{path.relative_to(ROOT)}",
            n=2,
        ))
        print(f"\n  🔧 Auto-fixed {path.name} ({len(diff)} diff lines):")
        for d in diff[:60]:
            print("    " + d, end="")
        if len(diff) > 60:
            print(f"\n    ... ({len(diff) - 60} more lines)")
        path.write_text(new_src)
    return changed


# ── Report writer ─────────────────────────────────────────────────────────────

def write_report(findings: list[Finding], fixed: int):
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda f: (sev_order.get(f.severity, 5), f.file, f.line))

    counts = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1

    now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# Security Scan Report",
        f"",
        f"**Generated:** {now}  ",
        f"**Tool:** `tests/security_scan.py` (OWASP A02·A03·A05·A07)  ",
        f"**Auto-fixed this run:** {fixed} finding(s)",
        f"",
        f"## Summary",
        f"",
        f"| Severity | Count |",
        f"|---|---|",
    ]
    for sev in ["critical", "high", "medium", "low", "info"]:
        c = counts.get(sev, 0)
        lines.append(f"| {sev.capitalize()} | {c} |")

    if not findings:
        lines += ["", "✅ **No findings** — all OWASP checks passed."]
    else:
        lines += ["", "## Findings", ""]
        for f in findings:
            icon = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}.get(f.severity, "⚪")
            fix_note = " *(auto-fixable with --fix)*" if f.fixable else ""
            lines += [
                f"### {icon} [{f.severity.upper()}] {f.category}",
                f"**File:** `{f.file}`:{f.line}  ",
                f"**Description:** {f.description}{fix_note}  ",
                f"```",
                f"{f.snippet}",
                f"```",
                f"",
            ]

    lines += [
        "## OWASP Coverage",
        "",
        "| Check | OWASP | Status |",
        "|---|---|---|",
        "| Stored XSS — unescaped DB fields in innerHTML | A03 | ✅ Automated |",
        "| Stored XSS — e.message in DOM sinks | A03 | ✅ Automated |",
        "| onclick backslash injection | A03 | ✅ Automated (detection) |",
        "| eval / new Function / document.write | A03 | ✅ Automated |",
        "| Hardcoded secrets (JWT, PAT, API keys) | A02 | ✅ Automated |",
        "| Token in localStorage | A07 | ✅ Automated |",
        "| CSP strictness and directives | A05 | ✅ Automated |",
        "| Worker CORS wildcard | A05 | ✅ Automated |",
        "| Worker security headers | A05 | ✅ Automated |",
        "| Worker verifySession gate | A07 | ✅ Automated |",
        "| Worker SSRF (symbol/table allowlists) | A10 | ✅ Automated (security_check.py) |",
        "| Supabase RLS (anon key reads nothing) | A01 | ✅ Automated (security_check.py live) |",
        "| SQL injection | A03 | ✅ Supabase ORM (no raw concat) |",
        "| Auth brute force | A07 | ✅ Automated (security_check.py) |",
    ]

    REPORT_PATH.write_text("\n".join(lines) + "\n")
    print(f"\n  📄 Report written to {REPORT_PATH.relative_to(ROOT)}")


# ── Main ──────────────────────────────────────────────────────────────────────

def run(fix=False, report=False, json_out=False) -> int:
    all_findings: list[Finding] = []
    total_fixed = 0

    # 1. XSS scan across all dashboard JS files
    print("\nScanning JS files for XSS vectors...")
    for js_path in sorted(JS_DIR.glob("*.js")):
        f = scan_js_xss(js_path)
        s = scan_js_dangerous_calls(js_path)
        c = scan_js_secrets(js_path)
        t = scan_session_storage(js_path)
        for finding in f + s + c + t:
            print(str(finding))
        all_findings += f + s + c + t

        if fix and f:
            changed = autofix_file(js_path, f)
            if changed:
                total_fixed += 1

    # 2. CSP checks
    print("\nChecking CSP headers...")
    for html in [
        ROOT / "docs" / "index.html",
        ROOT / "docs" / "app" / "index.html",
        ROOT / "docs" / "demo" / "index.html",
    ]:
        f = scan_csp(html)
        for finding in f:
            print(str(finding))
        all_findings += f

    # 3. Worker checks
    print("\nChecking Cloudflare Worker...")
    f = scan_worker_headers(WORKER)
    h = scan_worker_auth(WORKER)
    for finding in f + h:
        print(str(finding))
    all_findings += f + h

    # 4. If fix mode: re-run scan to verify fixes applied
    if fix and total_fixed > 0:
        print(f"\n  ✅ Applied fixes to {total_fixed} file(s). Re-scanning to verify...")
        # rebuild the auto-patched findings to verify
        recheck: list[Finding] = []
        for js_path in sorted(JS_DIR.glob("*.js")):
            recheck += scan_js_xss(js_path)
        still_fixable = [f for f in recheck if f.fixable]
        if still_fixable:
            print(f"  ⚠️  {len(still_fixable)} fixable finding(s) remain after auto-fix (manual review needed):")
            for f in still_fixable:
                print(str(f))
        else:
            print("  ✅ All auto-fixable XSS findings resolved.")

    if report:
        write_report(all_findings, total_fixed)

    if json_out:
        write_json(all_findings, total_fixed)

    # Classify: low/info are warnings, medium+ are failures
    failures = [f for f in all_findings if Finding.SEVERITIES.get(f.severity, 0) >= 2]
    warnings = [f for f in all_findings if Finding.SEVERITIES.get(f.severity, 0) < 2]

    print(f"\n{'='*60}")
    print(f"Findings: {len(failures)} failure(s)  {len(warnings)} warning(s)")
    if failures:
        print("FAIL — fix the above before shipping.")
    else:
        print("PASS ✅")

    return 1 if failures else 0


def write_json(findings: list[Finding], fixed: int):
    """Write machine-readable findings for security_issue_sync.py."""
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = [
        {
            "file":        f.file,
            "line":        f.line,
            "severity":    f.severity,
            "category":    f.category,
            "description": f.description,
            "snippet":     f.snippet,
            "fixable":     f.fixable,
            "detected_at": now,
        }
        for f in findings
    ]
    out_path = ROOT / "documentation" / "security-findings.json"
    out_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"  📋 JSON findings written to {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="CapitalLens OWASP security scanner")
    p.add_argument("--fix",    action="store_true", help="auto-fix unescaped DB fields")
    p.add_argument("--report", action="store_true", help="write documentation/security-scan-report.md")
    p.add_argument("--json",   action="store_true", dest="json_out", help="write documentation/security-findings.json for issue sync")
    args = p.parse_args()
    sys.exit(run(fix=args.fix, report=args.report, json_out=args.json_out))
