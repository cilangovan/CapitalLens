"""Run: python tests/data_quality_test.py        (offline: the data files shipped in git)
     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python tests/data_quality_test.py --live     (nightly: the shared tables in the database)
Data quality for everything that is NOT customer data (customer data is encrypted, so the server cannot and must not inspect it):
 · config/popular_tickers.json   no duplicates, valid symbol shape, ranges present
 · config/ipo_calendar.json      required fields, allowed market/status/rating values, ISO dates in order, price range sane, http(s) source,
                                 a rating other than 'Not rated' must name its source (CLAUDE.md: never invent ratings; name the source)
 · docs/js/overview.js MM_TABS   Market Mood tabs: unique keys and index symbols
 · --live  market_cache          every popular symbol has a chart row, not empty, fetched recently (default max age 4 days: covers weekends)
 · --live  ipo_calendar          same field rules on the database rows; nothing 'upcoming/open' whose end date is long past
Exit 1 on any failure so the workflow goes red."""
import datetime as dt, json, os, re, sys, urllib.parse, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
bad = 0
def check(name, cond, extra=""):
    global bad
    print(("  ✓ " if cond else "  ✗ ") + name + (f"\n      {extra}" if extra and not cond else "")); bad += 0 if cond else 1
def iso(s):
    try: return dt.date.fromisoformat(s)
    except Exception: return None

MARKETS = {"US", "UK", "IN", "HK", "EU", "JP", "CN", "SG", "AU", "OTHER"}
STATUS = {"rumoured", "filed", "upcoming", "open", "priced", "listed", "postponed", "withdrawn"}
RATING = {"Subscribe", "Neutral", "Avoid", "Not rated"}
def ipo_problems(i, today):
    p = []
    for k in ("id", "market", "name", "status", "rating"):
        if not i.get(k): p.append(f"missing {k}")
    if i.get("market") not in MARKETS: p.append(f"market {i.get('market')!r}")
    if i.get("status") not in STATUS: p.append(f"status {i.get('status')!r}")
    if i.get("rating") not in RATING: p.append(f"rating {i.get('rating')!r}")
    if i.get("rating") not in (None, "Not rated") and not i.get("rating_source"): p.append("rating without rating_source")
    if i.get("source_url") and not re.match(r"^https?://", i["source_url"]): p.append("source_url not http(s)")
    d = {k: iso(i[k]) for k in ("start_date", "end_date", "listing_date") if i.get(k)}
    if any(v is None for v in d.values()): p.append("a date is not ISO yyyy-mm-dd")
    else:
        if d.get("start_date") and d.get("end_date") and d["start_date"] > d["end_date"]: p.append("start_date after end_date")
        if d.get("end_date") and d.get("listing_date") and d["end_date"] > d["listing_date"]: p.append("end_date after listing_date")
    lo, hi = i.get("price_low"), i.get("price_high")
    if lo is not None and hi is not None and (lo <= 0 or lo > hi): p.append("price range invalid")
    if i.get("id") and i.get("market") and not str(i["id"]).startswith(str(i["market"]) + ":"): p.append("id not prefixed with market")
    if i.get("status") in ("upcoming", "open") and d.get("end_date") and (today - d["end_date"]).days > 14: p.append("still upcoming/open 14+ days after end_date")
    return p

today = dt.date.today()
# self-test: the validator really catches bad rows
bads = ipo_problems({"id": "US:X", "market": "US", "name": "X", "status": "upcoming", "rating": "Subscribe", "start_date": "2026-02-01", "end_date": "2026-01-01"}, today)
check("self-test: validator flags a rating with no source and reversed dates", "rating without rating_source" in bads and "start_date after end_date" in bads, str(bads))

pt = json.loads((ROOT / "config/popular_tickers.json").read_text()); syms = pt["symbols"]
check("popular_tickers: no duplicate symbols", len(syms) == len(set(syms)), str(sorted({s for s in syms if syms.count(s) > 1})))
check("popular_tickers: every symbol has a valid shape", all(re.fullmatch(r"[A-Z0-9^][A-Z0-9.=\-^]{0,14}", s) for s in syms), str([s for s in syms if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.=\-^]{0,14}", s)]))
check("popular_tickers: ranges listed and non-empty", bool(pt.get("ranges")) and all(re.fullmatch(r"\d+(d|mo|y)", r) for r in pt["ranges"]), str(pt.get("ranges")))

cal = json.loads((ROOT / "config/ipo_calendar.json").read_text()); ipos = cal["ipos"]
check("ipo_calendar.json: as_of is a real date and not in the future", iso(cal.get("as_of", "")) is not None and iso(cal["as_of"]) <= today, str(cal.get("as_of")))
check("ipo_calendar.json: ids unique", len({i["id"] for i in ipos}) == len(ipos))
for i in ipos:
    pr = ipo_problems(i, today); check(f'ipo_calendar.json {i.get("id")}: field rules', not pr, "; ".join(pr))

js = (ROOT / "docs/js/overview.js").read_text(); blk = js[js.index("const MM_TABS"):js.index("const MM_ZONES")]
keys = re.findall(r"key:\s*'([^']+)'", blk); sy = [s for s in re.findall(r"sym:\s*(null|'[^']+')", blk) if s != "null"]
check("Market Mood: unique tab keys and unique index symbols", len(keys) == len(set(keys)) and len(sy) == len(set(sy)), f"{keys} {sy}")

if "--live" in sys.argv:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key): print("  ✗ --live needs SUPABASE_URL and SUPABASE_SERVICE_KEY"); bad += 1
    else:
        def rest(path):
            rq = urllib.request.Request(url.rstrip("/") + "/rest/v1/" + path, headers={"apikey": key, "Authorization": "Bearer " + key})
            return json.loads(urllib.request.urlopen(rq, timeout=60).read())
        maxage = float(os.environ.get("DQ_MAX_AGE_DAYS", "4")); now = dt.datetime.now(dt.timezone.utc)
        rows = {r["key"]: r for r in rest("market_cache?select=key,fetched_at,payload&key=like.chart:*")}
        miss = [s for s in syms if not any(k.startswith(f"chart:{s}:") for k in rows)]
        check(f"market_cache: every popular symbol has a chart row ({len(syms) - len(miss)}/{len(syms)})", not miss, "missing: " + ", ".join(miss[:25]))
        old = [k for k, r in rows.items() if (now - dt.datetime.fromisoformat(r["fetched_at"].replace("Z", "+00:00"))).total_seconds() > maxage * 86400]
        check(f"market_cache: nothing older than {maxage:g} days", not old, f"{len(old)} stale, e.g. {old[:8]}")
        empty = [k for k, r in rows.items() if not r.get("payload")]
        check("market_cache: no empty payloads", not empty, str(empty[:8]))
        db = rest("ipo_calendar?select=*")
        for i in db:
            pr = ipo_problems(i, today)
            if pr: check(f'ipo_calendar (database) {i.get("id")}', False, "; ".join(pr))
        check(f"ipo_calendar (database): {len(db)} rows pass the field rules", not any(ipo_problems(i, today) for i in db))
print("FAIL" if bad else "PASS"); raise SystemExit(1 if bad else 0)
