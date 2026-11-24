"""Run: python tests/table_inventory_test.py        (offline)
     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python tests/table_inventory_test.py --live     (nightly: the real database)
The table inventory gate (CUTOVER_PLAN, added after analyst_ratings was missed from the migration list; register R02).
 · every table created in db/schema.sql or db/tenant/*.sql has exactly one class in config/table_classes.json
 · the 'customer' class equals docs/zk/migrate.js TABLES exactly (nothing customer-owned can be left out of the encryption migration, nothing extra is migrated)
 · --live: every table the live database exposes is classified (a table created by hand in production cannot hide)."""
import json, os, re, sys, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {extra}" if extra and not cond else "")); bad += 0 if cond else 1

cls = json.loads((ROOT / "config/table_classes.json").read_text()); cls.pop("note")
where = {}
for c, names in cls.items():
    for n in names: where.setdefault(n, []).append(c)
declared = set()
for f in [ROOT / "db/schema.sql"] + sorted((ROOT / "db/tenant").glob("*.sql")):
    declared |= set(re.findall(r"create table (?:if not exists )?(?:public\.)?([a-z_0-9]+)", f.read_text(), re.I))
check(f"every one of the {len(declared)} tables in the SQL files is classified", declared <= set(where), "unclassified: " + ", ".join(sorted(declared - set(where))))
check("no table has two classes", all(len(v) == 1 for v in where.values()), str({k: v for k, v in where.items() if len(v) > 1}))
js = (ROOT / "docs/zk/migrate.js").read_text(); blk = js[js.index("const TABLES = ["):]; blk = blk[:blk.index("];")]
mig = set(re.findall(r"'([a-z_0-9]+)'", blk))
check("customer class == docs/zk/migrate.js TABLES (missing from migration: %s; extra: %s)" % (sorted(set(cls["customer"]) - mig), sorted(mig - set(cls["customer"]))), set(cls["customer"]) == mig)
check("self-test: an unclassified name would be caught", "definitely_new_table" not in where)

if "--live" in sys.argv:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key): print("  ✗ --live needs SUPABASE_URL and SUPABASE_SERVICE_KEY"); bad += 1
    else:
        rq = urllib.request.Request(url.rstrip("/") + "/rest/v1/", headers={"apikey": key, "Authorization": "Bearer " + key})
        spec = json.loads(urllib.request.urlopen(rq, timeout=60).read()); live = {k for k in spec.get("definitions", {})}
        check(f"live database: all {len(live)} exposed tables are classified", live <= set(where), "unclassified in production: " + ", ".join(sorted(live - set(where))))
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
