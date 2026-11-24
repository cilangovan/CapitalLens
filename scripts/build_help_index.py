#!/usr/bin/env python3
"""Builds docs/help/help-index.json: the knowledge base of the Help assistant (epic #54).

Only the USER-FACING pages are indexed (allow-list, never a block-list): the documentation home, the product overview and one page per menu.
Architecture, security, operations, engineering, database, demo-requirements and regression pages are never indexed, so the assistant cannot quote them.
Each chunk is one heading section: {id, page, title, heading, url (relative to the portal root), text}. Deterministic output (CI --check).

  python3 scripts/build_help_index.py           write docs/help/help-index.json
  python3 scripts/build_help_index.py --check   exit 1 if it is stale (also run through build_docs.py --check)
"""
import json, pathlib, re, sys
import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "documentation"
OUT = ROOT / "docs" / "help" / "help-index.json"
ALLOW = ["README.md", "product-overview.md"] + sorted(f"menus/{p.name}" for p in (SRC / "menus").glob("*.md"))
MAX_CHARS = 1100                                     # a chunk the model can read 5 of without blowing its context

def plain(md):
    t = re.sub(r"```.*?```", " ", md, flags=re.S)                    # code blocks are not help text
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)                       # images
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)                    # links -> their text
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"^\s*\|?[\s:|-]{3,}\|?\s*$", " ", t, flags=re.M)      # table rules
    t = t.replace("|", " ; ")
    t = re.sub(r"[*_>#]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()

def split_text(text):
    if len(text) <= MAX_CHARS: return [text]
    parts, cur = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if cur and len(cur) + len(sentence) + 1 > MAX_CHARS: parts.append(cur); cur = ""
        cur = (cur + " " + sentence).strip()
    if cur: parts.append(cur)
    return parts

def chunks_of(page):
    md_text = (SRC / page).read_text()
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"]); md.convert(md_text)
    ids = []
    def walk(tokens):
        for t in tokens: ids.append((t["id"], t["name"])); walk(t["children"])
    walk(md.toc_tokens)                                              # same slugs the portal pages use for their headings
    lines, fence, sections, cur, hi = md_text.split("\n"), False, [], None, 0
    for line in lines:
        if line.lstrip().startswith("```"): fence = not fence
        m = None if fence else re.match(r"^(#{1,6})\s+(.*\S)\s*$", line)
        if m:
            if cur: sections.append(cur)
            anchor, name = ids[hi] if hi < len(ids) else ("", m.group(2)); hi += 1
            cur = {"anchor": anchor, "heading": re.sub(r"[*_`]", "", name), "body": []}
        elif cur is not None: cur["body"].append(line)
    if cur: sections.append(cur)
    page_title = sections[0]["heading"] if sections else page
    out = []
    for s in sections:
        text = plain("\n".join(s["body"]))
        if len(text) < 30: continue                                  # heading-only / empty sections add noise
        base = page[:-3] + ".html" if page != "README.md" else "index.html"
        for i, part in enumerate(split_text(text)):
            out.append({"id": f"{page[:-3]}#{s['anchor']}" + (f".{i + 1}" if i else ""), "page": page, "title": page_title, "heading": s["heading"],
                        "url": base + (f"#{s['anchor']}" if s["anchor"] else ""), "text": part})
    return out

def index_text():
    chunks = [c for p in ALLOW for c in chunks_of(p)]
    return json.dumps({"version": 1, "pages": ALLOW, "chunks": chunks}, ensure_ascii=False, indent=0) + "\n"

if __name__ == "__main__":
    text = index_text()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text: print("docs/help/help-index.json is stale - run python3 scripts/build_help_index.py"); sys.exit(1)
        print("help index up to date"); sys.exit(0)
    OUT.write_text(text); print(f"help index: {len(ALLOW)} pages, {text.count(chr(34) + 'id' + chr(34))} chunks, {len(text) // 1024} KB")
