#!/usr/bin/env python3
"""
CapitalLens — Daily security email digest.

Reads documentation/security-findings.json (from security_scan.py --json)
and GitHub Issues (via gh CLI) to build a categorised HTML email:

  Sections:
    🔴 Critical / 🟠 High / 🟡 Medium  → grouped by layer (Frontend · Worker · CSP · Database)
    🔵 Low / ⚪ Info                    → summary table only
    ✅ Resolved since last email        → closed issues from the past 24 h

  Delivery: SendGrid API (env SENDGRID_API_KEY + DIGEST_TO_EMAIL).
  Falls back to printing the email body if the env vars are absent (useful for local testing).

Usage:
  python tests/security_email.py
  SENDGRID_API_KEY=xxx DIGEST_TO_EMAIL=hoop@example.com python tests/security_email.py
"""
import json
import os
import subprocess
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FINDINGS_JSON = ROOT / "documentation" / "security-findings.json"
REPO = "cilangovan/CapitalLens"

LAYER_MAP = {
    "A03:XSS": "Frontend", "A03:XSS/stored": "Frontend",
    "A03:XSS/onclick-backslash": "Frontend", "A03:XSS/eval": "Frontend",
    "A02:Credentials": "Frontend", "A07:Session": "Frontend",
    "A05:CSP": "CSP", "A05:CORS": "Worker", "A05:Headers": "Worker",
    "A05:Config": "Worker", "A07:Auth": "Worker",
    "A01:RLS": "Database", "A10:SSRF": "Worker",
}
SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
SEV_COLOR = {"critical": "#dc2626", "high": "#ea580c", "medium": "#ca8a04",
             "low": "#2563eb", "info": "#6b7280"}
SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}


def gh_issues(state="open") -> list[dict]:
    r = subprocess.run(
        ["gh", "issue", "list", "--repo", REPO, "--label", "security",
         "--state", state, "--limit", "100", "--json",
         "number,title,state,labels,createdAt,closedAt,url"],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        return []
    return json.loads(r.stdout)


def recently_closed(hours=25) -> list[dict]:
    issues = gh_issues(state="closed")
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)
    out = []
    for iss in issues:
        closed = iss.get("closedAt")
        if closed:
            dt = datetime.datetime.fromisoformat(closed.replace("Z", "+00:00"))
            if dt > cutoff:
                out.append(iss)
    return out


def layer(category: str) -> str:
    return LAYER_MAP.get(category, "Frontend")


def build_html(findings: list[dict], open_issues: list[dict], resolved: list[dict]) -> str:
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%A %d %b %Y %H:%M UTC")
    total = len(findings)
    failures = [f for f in findings if SEV_ORDER.get(f["severity"], 9) <= 2]  # critical/high/medium
    warnings = [f for f in findings if SEV_ORDER.get(f["severity"], 9) > 2]

    overall = "🟢 PASS — no high/medium/critical findings" if not failures else \
              f"🔴 FAIL — {len(failures)} finding(s) need attention"
    overall_color = "#16a34a" if not failures else "#dc2626"

    # Group findings by severity then layer
    from collections import defaultdict
    by_sev_layer: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for f in findings:
        by_sev_layer[f["severity"]][layer(f["category"])].append(f)

    rows_html = ""
    for sev in ["critical", "high", "medium"]:
        for lyr, fs in sorted(by_sev_layer.get(sev, {}).items()):
            for f in fs:
                color = SEV_COLOR.get(sev, "#6b7280")
                em = SEV_EMOJI.get(sev, "⚪")
                fix_badge = '<span style="background:#16a34a;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px">auto-fixable</span>' if f.get("fixable") else ""
                rows_html += f"""
<tr>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;color:{color};white-space:nowrap">{em} {sev.upper()}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb">{lyr}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px">{f['category']}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb">{f['description']} {fix_badge}<br><span style="color:#6b7280;font-size:12px">{f['file']}:{f.get('line','')}</span></td>
</tr>"""

    # Low / info summary table
    warn_rows = ""
    for sev in ["low", "info"]:
        for lyr, fs in sorted(by_sev_layer.get(sev, {}).items()):
            for f in fs:
                color = SEV_COLOR.get(sev, "#6b7280")
                em = SEV_EMOJI.get(sev, "⚪")
                warn_rows += f"""
<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;color:{color};font-size:13px">{em} {sev.upper()}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">{lyr}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;font-family:monospace">{f['category']}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">{f['description']}</td>
</tr>"""

    # Open GitHub issues
    issue_rows = ""
    for iss in sorted(open_issues, key=lambda x: x["number"]):
        labels = ", ".join(l["name"] for l in iss.get("labels", []) if l["name"] != "security")
        issue_rows += f"""
<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">
    <a href="{iss['url']}" style="color:#3b82f6">#{iss['number']}</a>
  </td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">{iss['title'][:80]}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280">{labels}</td>
</tr>"""

    # Resolved section
    resolved_rows = ""
    for iss in resolved:
        resolved_rows += f"""
<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px">
    ✅ <a href="{iss['url']}" style="color:#16a34a">#{iss['number']}</a>
  </td>
  <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">{iss['title'][:80]}</td>
</tr>"""

    resolved_section = ""
    if resolved_rows:
        resolved_section = f"""
<h2 style="color:#16a34a;font-size:16px;margin:24px 0 8px">✅ Resolved in the last 24 h</h2>
<table style="width:100%;border-collapse:collapse;font-family:sans-serif">
  <thead><tr>
    <th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Issue</th>
    <th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Title</th>
  </tr></thead>
  <tbody>{resolved_rows}</tbody>
</table>"""

    no_issues_note = "" if open_issues else "<p style='color:#16a34a;font-size:13px'>No open security issues. 🎉</p>"
    no_findings_note = "" if failures else "<p style='color:#16a34a;padding:16px 0'>✅ No critical / high / medium findings.</p>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>CapitalLens Security Digest — {now}</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#111">

<div style="background:{overall_color};color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:24px">
  <strong style="font-size:18px">CapitalLens — Daily Security Digest</strong><br>
  <span style="font-size:14px">{now}</span><br>
  <span style="font-size:16px;margin-top:8px;display:block">{overall}</span>
</div>

<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-family:sans-serif;font-size:14px">
  <tr>
    <td style="padding:8px 16px;background:#fef2f2;border-radius:6px;text-align:center"><strong style="color:#dc2626">{sum(1 for f in findings if f['severity']=='critical')}</strong><br><span style="font-size:12px;color:#6b7280">Critical</span></td>
    <td style="padding:8px 16px;background:#fff7ed;border-radius:6px;text-align:center"><strong style="color:#ea580c">{sum(1 for f in findings if f['severity']=='high')}</strong><br><span style="font-size:12px;color:#6b7280">High</span></td>
    <td style="padding:8px 16px;background:#fefce8;border-radius:6px;text-align:center"><strong style="color:#ca8a04">{sum(1 for f in findings if f['severity']=='medium')}</strong><br><span style="font-size:12px;color:#6b7280">Medium</span></td>
    <td style="padding:8px 16px;background:#eff6ff;border-radius:6px;text-align:center"><strong style="color:#2563eb">{sum(1 for f in findings if f['severity']=='low')}</strong><br><span style="font-size:12px;color:#6b7280">Low (backlog)</span></td>
    <td style="padding:8px 16px;background:#f9fafb;border-radius:6px;text-align:center"><strong>{len(open_issues)}</strong><br><span style="font-size:12px;color:#6b7280">Open Issues</span></td>
    <td style="padding:8px 16px;background:#f0fdf4;border-radius:6px;text-align:center"><strong style="color:#16a34a">{len(resolved)}</strong><br><span style="font-size:12px;color:#6b7280">Resolved (24 h)</span></td>
  </tr>
</table>

<h2 style="color:#111;font-size:16px;margin:24px 0 8px">🔍 Critical / High / Medium Findings</h2>
{no_findings_note}
{'<table style="width:100%;border-collapse:collapse;font-family:sans-serif"><thead><tr><th style="text-align:left;padding:8px;background:#f9fafb;font-size:12px;color:#6b7280">Severity</th><th style="text-align:left;padding:8px;background:#f9fafb;font-size:12px;color:#6b7280">Layer</th><th style="text-align:left;padding:8px;background:#f9fafb;font-size:12px;color:#6b7280">OWASP</th><th style="text-align:left;padding:8px;background:#f9fafb;font-size:12px;color:#6b7280">Description</th></tr></thead><tbody>' + rows_html + '</tbody></table>' if failures else ''}

<h2 style="color:#6b7280;font-size:16px;margin:24px 0 8px">🔵 Low / Info (backlog warnings)</h2>
{'<table style="width:100%;border-collapse:collapse;font-family:sans-serif"><thead><tr><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Severity</th><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Layer</th><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">OWASP</th><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Description</th></tr></thead><tbody>' + warn_rows + '</tbody></table>' if warn_rows else '<p style="color:#6b7280;font-size:13px">None.</p>'}

<h2 style="color:#111;font-size:16px;margin:24px 0 8px">📋 Open GitHub Security Issues</h2>
{no_issues_note}
{'<table style="width:100%;border-collapse:collapse;font-family:sans-serif"><thead><tr><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">#</th><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Title</th><th style="text-align:left;padding:6px 8px;background:#f9fafb;font-size:12px;color:#6b7280">Labels</th></tr></thead><tbody>' + issue_rows + '</tbody></table>' if issue_rows else ''}

{resolved_section}

<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
  <p>
    Sent by <strong>CapitalLens security_email.py</strong> via GitHub Actions<br>
    Scanner: <code>tests/security_scan.py</code> (OWASP A02·A03·A05·A07)<br>
    Full report: <a href="https://github.com/{REPO}/blob/main/documentation/security-audit.md">documentation/security-audit.md</a><br>
    GitHub Issues: <a href="https://github.com/{REPO}/issues?q=label%3Asecurity">github.com/{REPO}/issues?label=security</a>
  </p>
  <p>Auto-fix unescaped DB fields: <code>python tests/security_scan.py --fix</code></p>
</div>

</body>
</html>"""


def send_via_sendgrid(html: str, subject: str, to_email: str, api_key: str):
    import urllib.request
    payload = json.dumps({
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": "security@capitallens.app", "name": "CapitalLens Security"},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }).encode()
    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        print(f"  SendGrid: {resp.status}")


def main():
    findings = json.loads(FINDINGS_JSON.read_text()) if FINDINGS_JSON.exists() else []
    open_issues = gh_issues(state="open")
    resolved = recently_closed(hours=25)

    failures = [f for f in findings if SEV_ORDER.get(f["severity"], 9) <= 1]  # crit/high
    overall = "FAIL" if failures else "PASS"
    total = len(findings)
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    subject = f"[CapitalLens Security] {overall} — {sum(1 for f in findings if f['severity'] in ('critical','high'))} High+ · {total} total · {today}"

    html = build_html(findings, open_issues, resolved)

    api_key  = os.environ.get("SENDGRID_API_KEY", "")
    to_email = os.environ.get("DIGEST_TO_EMAIL", "")

    if api_key and to_email:
        send_via_sendgrid(html, subject, to_email, api_key)
        print(f"  Email sent to {to_email}: {subject}")
    else:
        # Fallback: write to file (useful for local review or if SendGrid not configured)
        out = ROOT / "documentation" / "security-email-preview.html"
        out.write_text(html)
        print(f"  No SENDGRID_API_KEY / DIGEST_TO_EMAIL set.")
        print(f"  Email preview written to {out.relative_to(ROOT)}")
        print(f"  Subject: {subject}")


if __name__ == "__main__":
    main()
