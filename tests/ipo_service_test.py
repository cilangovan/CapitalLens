"""Run: python tests/ipo_service_test.py   — the IPO feed refuses bad rows before anything is written."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from services import ipo_service as S

ok = lambda name, cond: (print(("  ✓ " if cond else "  ✗ ") + name), cond)[1]
good = {"id": "US:T", "market": "US", "name": "T", "status": "upcoming", "start_date": "2026-11-01", "end_date": "2026-11-05"}
res = [
    ok("valid row passes", S.validate([good]) == []),
    ok("shipped seed file is valid", S.validate(S.load()[1]) == []),
    ok("duplicate id refused", any("duplicate" in e for e in S.validate([good, dict(good)]))),
    ok("bad market / status / rating refused", all(any(k in e for e in S.validate([{**good, "market": "XX", "status": "meh", "rating": "Great"}])) for k in ("bad market", "bad status", "bad rating"))),
    ok("a rating needs a source", any("rating_source" in e for e in S.validate([{**good, "rating": "Subscribe"}]))),
    ok("a rating with a source passes", S.validate([{**good, "rating": "Subscribe", "rating_source": "Broker"}]) == []),
    ok("start after end refused", any("start_date after" in e for e in S.validate([{**good, "start_date": "2026-12-01"}]))),
    ok("bad date and javascript: url refused", len(S.validate([{**good, "listing_date": "19/11/2026", "source_url": "javascript:alert(1)"}])) == 2),
    ok("price_low above price_high refused", any("price_low" in e for e in S.validate([{**good, "price_low": 9, "price_high": 5}]))),
    ok("payload carries every column and defaults", set(S.payload("2026-11-19", [good])[0]) >= set(S.COLUMNS) and S.payload("2026-11-19", [good])[0]["rating"] == "Not rated"),
]
print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed"); sys.exit(0 if all(res) else 1)
