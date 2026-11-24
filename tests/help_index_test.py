#!/usr/bin/env python3
"""Help assistant knowledge base (epic #54): only user-facing pages, every link resolves into the portal, chunks are sane, and it is never stale."""
import json, pathlib, re, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_help_index as B
fails = 0
def ok(name, cond):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + name)
    if not cond: fails += 1
idx = json.loads((ROOT / "docs/help/help-index.json").read_text()); chunks = idx["chunks"]
ok("help-index.json is up to date with the documentation (run scripts/build_help_index.py)", subprocess.run([sys.executable, str(ROOT / "scripts/build_help_index.py"), "--check"], capture_output=True).returncode == 0)
ok("help-index.json is not git-ignored (the worker reads it from GitHub Pages; .gitignore has a blanket *.json rule)", subprocess.run(["git", "check-ignore", "-q", "docs/help/help-index.json"], cwd=ROOT).returncode == 1)
pages = {c["page"] for c in chunks}
ok("only the allow-list is indexed (home, product overview, menus/*)", pages <= set(B.ALLOW) and all(p in ("README.md", "product-overview.md") or p.startswith("menus/") for p in pages))
BANNED = ("security", "ops-dashboard", "engineering", "database", "regression", "demo-requirements", "architecture", "workflows", "requirements", "ui-design", "demo.md")
ok("no admin / security / operations / engineering page can be indexed", not [p for p in B.ALLOW if any(b in p for b in BANNED)] and not [p for p in pages if any(b in p for b in BANNED)])
ok("every menu page of the portal is covered", {f"menus/{p.name}" for p in (ROOT / "documentation/menus").glob("*.md")} <= pages)
bad = []
for c in chunks:
    f = ROOT / "docs/help" / c["url"].split("#")[0]
    if not f.exists(): bad.append(c["url"]); continue
    if "#" in c["url"] and f'id="{c["url"].split("#")[1]}"' not in f.read_text(): bad.append(c["url"])
ok("every chunk URL points at a real portal page and heading anchor" + (f" (broken: {bad[:3]})" if bad else ""), not bad)
ok("chunks are small enough to send five at a time (<= 1200 chars) and never empty", all(30 <= len(c["text"]) <= 1200 for c in chunks))
ok("chunk ids are unique and urls are relative (no external links)", len({c["id"] for c in chunks}) == len(chunks) and not any(re.match(r"^[a-z]+:|^//", c["url"]) for c in chunks))
ok("no code blocks or raw markdown tables leak into chunk text", not any("```" in c["text"] or "|---" in c["text"] for c in chunks))
print(f"\n{'PASS' if not fails else 'FAIL'}"); sys.exit(1 if fails else 0)
