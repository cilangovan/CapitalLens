"""Demo parity guard (issue #28). Run: python tests/demo_parity_test.py
1. Offline (always): every per-user table the dashboards read must be in the demo parity list (db/tenant/22_demo_parity_guard.sql), so a new live
   feature cannot be forgotten. 2. Online (only when DEMO_SUPABASE_URL and DEMO_SERVICE_KEY are set, e.g. a CI secret): the demo project must have
   no empty feature. Skipped, not passed, when the secrets are absent."""
import os, re, sys, json, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sql = (ROOT / "db/tenant/22_demo_parity_guard.sql").read_text()
listed = set(re.findall(r"\('([a-z_0-9]+)','[^']+', (?:true|false)\)", sql))
shim = (ROOT / "docs/zk/shim.js").read_text()
enc = re.search(r"const ENCRYPTED = \{(.*?)\};", shim, re.S).group(1)
tables = set(re.findall(r"(\w+): '(\w+)'", enc)) and {b for a, b in re.findall(r"(\w+): '(\w+)'", enc)}
# stores that exist only for the private app / have no demo feature, or are covered by another listed table
exempt = {"ipo_watch", "positions_all", "portfolio_snapshots_all"}
missing = sorted(t for t in tables - exempt if t not in listed)
bad = 0
print(("  ✓ " if not missing else "  ✗ ") + "every dashboard table is in the demo parity list" + (f"  missing: {missing}" if missing else "")); bad += bool(missing)
url, key = os.environ.get("DEMO_SUPABASE_URL"), os.environ.get("DEMO_SERVICE_KEY")
if url and key:
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/rpc/demo_parity_gaps", data=b"{}", method="POST", headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    gaps = json.load(urllib.request.urlopen(req, timeout=30)).get("gaps", ["(no answer)"])
    print(("  ✓ " if not gaps else "  ✗ ") + "demo project has no empty feature" + (f"  empty: {gaps}" if gaps else "")); bad += bool(gaps)
else:
    print("  - live parity check skipped (set DEMO_SUPABASE_URL and DEMO_SERVICE_KEY to enable)")
sys.exit(1 if bad else 0)
