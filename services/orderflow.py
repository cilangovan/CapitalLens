"""ORDER-FLOW ESTIMATE from daily candles. Same algorithm as docs/zk/orderflow.js (shared golden vectors: tests/data/orderflow_golden.json).

This is an ESTIMATE inferred from each candle's volume and where it closed inside its range. Yahoo's free data has no order book, no tape and no buy/sell
split, so real order flow ("buy orders of 20k lots") cannot be measured. What can be seen is the footprint a big buyer or seller leaves: volume far above
normal, a wide candle, a close near the high (or low) and a price move the same way. The threshold is RELATIVE (x times the stock's own 20-day average
volume), never a fixed lot count. It can only make a buy more careful or add a supporting reason; it never creates a buy on its own (not back-tested).
"""
import math

LOOKBACK, RECENT, EVENT_RVOL, CLOSE_LOC, PRESSURE = 20, 5, 2.5, 0.5, 0.15
MIN_BARS = LOOKBACK + 1
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOTE = {
    "unverified": "Order flow cannot be estimated: not enough reliable volume history.",
    "neutral": "No unusual large-order footprint in the last 5 sessions (estimated from candles).",
    "buyers": "Buying pressure over the last 20 days (estimated): closes sit in the upper part of the daily range on volume.",
    "sellers": "Selling pressure over the last 20 days (estimated): closes sit in the lower part of the daily range on volume.",
}
SCORE = {"accumulation_new": 1, "accumulation_old": 0.9, "buyers": 0.7, "neutral": 0.5, "sellers": 0.3, "distribution_old": 0.2, "distribution_new": 0.1}


def _rnd(x, d):                       # round half away from zero, like JS Math.round on x*10^d (Python's round() is banker's)
    f = 10 ** d
    return math.floor(x * f + 0.5) / f if x >= 0 else -math.floor(-x * f + 0.5) / f


def _fmt_shares(x):
    if x >= 1e6: return f"{_rnd(x / 1e6, 1):g}M"
    if x >= 1e3: return f"{int(math.floor(x / 1e3 + 0.5))}k"
    return str(int(math.floor(x + 0.5)))


def _fmt_date(d):
    if not d: return "that day"
    p = str(d)[:10].split("-")
    return f"{int(p[2])} {_MON[int(p[1]) - 1]}" if len(p) == 3 else str(d)


def _mean(a): return sum(a) / len(a)


def estimate(h, l, c, v, dates=None, partial=False):
    """h/l/c/v: daily lists, oldest first. dates: optional 'YYYY-MM-DD' per bar. partial: last bar is today's unfinished session (dropped)."""
    out = {"state": "unverified", "score": None, "rvol": None, "pressure": None, "date": None, "age": None, "extra_shares": None, "estimated": True, "note": NOTE["unverified"]}
    if h is None or l is None or c is None or v is None: return out
    n = min(len(h), len(l), len(c), len(v)) - (1 if partial else 0)
    if n < MIN_BARS + 1: return out
    try:
        H, L, C, V = ([float(x) for x in a[:n]] for a in (h, l, c, v))   # None / non-numeric -> unverified
    except (TypeError, ValueError):
        return out
    for i in range(max(n - (LOOKBACK + RECENT), 0), n):
        if not all(math.isfinite(x) for x in (H[i], L[i], C[i], V[i])) or V[i] < 0 or C[i] <= 0: return out
    if sum(1 for i in range(n - LOOKBACK - 1, n) if V[i] > 0) < LOOKBACK: return out

    def clv(i):
        r = H[i] - L[i]
        return ((C[i] - L[i]) - (H[i] - C[i])) / r if r > 0 else 0.0

    ev = None
    for i in range(n - RECENT, n):
        av = _mean(V[i - LOOKBACK:i]); ar = _mean([H[j] - L[j] for j in range(i - LOOKBACK, i)])
        if not (av > 0) or not (ar > 0): continue
        rvol, rng, loc, chg = V[i] / av, H[i] - L[i], clv(i), C[i] / C[i - 1] - 1
        if rvol >= EVENT_RVOL and rng >= ar and ((loc >= CLOSE_LOC and chg > 0) or (loc <= -CLOSE_LOC and chg < 0)):
            ev = {"i": i, "dir": 1 if loc > 0 else -1, "rvol": rvol, "extra": V[i] - av}
    sv = sum(V[i] for i in range(n - LOOKBACK, n)); svc = sum(V[i] * clv(i) for i in range(n - LOOKBACK, n))
    pressure = svc / sv if sv > 0 else 0.0
    last_avg = _mean(V[n - 1 - LOOKBACK:n - 1]); last_r = V[n - 1] / last_avg if last_avg > 0 else None
    out["pressure"] = _rnd(pressure, 2); out["rvol"] = None if last_r is None else _rnd(last_r, 2)
    if ev:
        age = n - 1 - ev["i"]; d = dates[ev["i"]] if dates else None; extra = _fmt_shares(ev["extra"])
        out.update(state="accumulation" if ev["dir"] > 0 else "distribution", age=age, date=str(d)[:10] if d else None, rvol=_rnd(ev["rvol"], 2), extra_shares=int(math.floor(ev["extra"] + 0.5)))
        out["score"] = SCORE[out["state"] + ("_new" if age <= 1 else "_old")]
        word, side, hl = ("buyer", "up", "high") if ev["dir"] > 0 else ("seller", "down", "low")
        out["note"] = (f"Large-{word} footprint (estimated): volume {_rnd(ev['rvol'], 1):g}× normal on {_fmt_date(d)} (about {extra} more shares than usual), "
                       f"price {side} and closing near the day's {hl}. Inferred from the candle, not from actual orders.")
    elif pressure >= PRESSURE: out.update(state="buyers", score=SCORE["buyers"], note=NOTE["buyers"])
    elif pressure <= -PRESSURE: out.update(state="sellers", score=SCORE["sellers"], note=NOTE["sellers"])
    else: out.update(state="neutral", score=SCORE["neutral"], note=NOTE["neutral"])
    return out
