"""Upserts config/ipo_calendar.json into public.ipo_calendar (service key). Public data only; touches no customer table.

Run:  python -m services.ipo_service            (SUPABASE_URL, SUPABASE_KEY = service key)
      python -m services.ipo_service --check    (validate the JSON, no network)

Rules: rows in the file are upserted by id; rows absent from the file are left alone; a bad row fails the run before anything
is written; a rating other than 'Not rated' must name its source."""
import json, os, re, sys, urllib.request
from datetime import date
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "config" / "ipo_calendar.json"
MARKETS = {"US", "UK", "IN", "HK", "EU", "JP", "CN", "SG", "AU", "OTHER"}
STATUSES = {"rumoured", "filed", "upcoming", "open", "priced", "listed", "postponed", "withdrawn"}
RATINGS = {"Subscribe", "Neutral", "Avoid", "Not rated"}
COLUMNS = ["id", "market", "exchange", "name", "ticker", "sector", "status", "start_date", "end_date", "listing_date", "currency",
           "price_low", "price_high", "deal_size_usd", "rating", "rating_source", "note", "source_name", "source_url"]
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(rows):
    errs, seen = [], set()
    for r in rows:
        i = r.get("id", "?")
        if not r.get("id") or r["id"] in seen: errs.append(f"{i}: missing or duplicate id")
        seen.add(r.get("id"))
        if r.get("market") not in MARKETS: errs.append(f"{i}: bad market")
        if not r.get("name"): errs.append(f"{i}: name required")
        if r.get("status", "upcoming") not in STATUSES: errs.append(f"{i}: bad status")
        if r.get("rating", "Not rated") not in RATINGS: errs.append(f"{i}: bad rating")
        if r.get("rating", "Not rated") != "Not rated" and not r.get("rating_source"): errs.append(f"{i}: a rating needs rating_source")
        for k in ("start_date", "end_date", "listing_date"):
            if r.get(k) and not DATE.match(r[k]): errs.append(f"{i}: {k} must be YYYY-MM-DD")
        if r.get("start_date") and r.get("end_date") and r["start_date"] > r["end_date"]: errs.append(f"{i}: start_date after end_date")
        if r.get("source_url") and not str(r["source_url"]).startswith(("http://", "https://")): errs.append(f"{i}: source_url must be http(s)")
        lo, hi = r.get("price_low"), r.get("price_high")
        if lo is not None and hi is not None and lo > hi: errs.append(f"{i}: price_low above price_high")
    return errs


def load(path=CONFIG):
    d = json.loads(Path(path).read_text())
    rows = d["ipos"]
    errs = validate(rows)
    if errs: raise SystemExit("ipo_calendar.json invalid:\n  " + "\n  ".join(errs))
    return d.get("as_of") or date.today().isoformat(), rows


def payload(as_of, rows):
    return [{**{c: r.get(c) for c in COLUMNS}, "status": r.get("status", "upcoming"), "rating": r.get("rating", "Not rated"), "as_of": as_of,
             "updated_at": date.today().isoformat() + "T00:00:00Z"} for r in rows]


def upsert(url, key, body):
    req = urllib.request.Request(url.rstrip("/") + "/rest/v1/ipo_calendar?on_conflict=id", data=json.dumps(body).encode(), method="POST",
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    with urllib.request.urlopen(req, timeout=30) as r: return r.status


def main(argv):
    as_of, rows = load()
    if "--check" in argv:
        print(f"ok: {len(rows)} IPO rows valid"); return 0
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not url or not key: raise SystemExit("SUPABASE_URL and SUPABASE_KEY required")
    print(f"upserted {len(rows)} rows (HTTP {upsert(url, key, payload(as_of, rows))})"); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
