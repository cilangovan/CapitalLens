# 💰 Profit Booking & Capital Protection

**Question it answers:** which winners should I trim, which positions are too big, and where must I re-check why I own something?

Tab id `profit` · loader `loadProfit()` · `docs/js/profit.js`

## Header tiles

Tap a tile for a pop-up that explains the number and lists the stocks behind it.

| Tile | Meaning |
|---|---|
| **1% risk per trade** | The rule: never lose more than 1% of holdings on one trade. The pop-up lists each stock's **max size** (risk £ ÷ its risk distance) and **exit price** (trailing stop = 3× its average daily move (ATR) below its 3-month high), and flags **oversized** positions |
| **Profit to book** | The sum suggested by the ladder for steps already reached. **Single stocks only**, each judged on its **own gain against its own average buy price** (first step +20%); funds (ETFs) are never auto-trimmed. Tap it: it lists what is due, or when £0, the **stocks closest to +20%** and any holdings **flagged "Book profit" by score (50–64) that carry no £ amount**. A rising *pie* does not move this tile; see card ⑥ |
| **Actions** | Counts per action level |

## Action levels

`Reassess` (something broke: trend, stop or fundamentals — re-check why you own it) → `Rebalance` → `Book profit` → `Let it run` → `Hold`. Listed in that urgency order.

## Sections

1. **Market conditions** — the regime used by the scoring.
2. **Sector exposure (look-through)** — with a cap (`maxSec`%) per sector.
3. **Holdings — weekly score & action** — each holding's score and action.
4. **Pie-level view.**
5. **⑥ Pie profit check** (own card): for each funded pie, biggest gain first: **gain % and £** (Trading 212's pie value against what was invested; "≈" when worked back from the rounded %), value, invested, share of holdings, stock/fund mix, **what the rules say at that gain** (<0 loss: nothing to book · <5% too early · 5–10% hold · 10–20% review allocation · 20%+ trim only if overweight and check which stocks passed +20%) and the best stock's gain against the +20% ladder start. Guidance only; nothing is sold automatically.
6. **⚠️ Watch-outs.**
7. **📘 Rulebook** (always shown):

| Individual stocks — staged booking | |
|---|---|
| +10% | Hold; review valuation |
| +15% | Check momentum, volume, fundamentals |
| +20% | Trim 10–15% |
| +30% | Trim another 15–20% |
| +40–50% | Recover initial capital |
| Trend break | Trailing exit 3× ATR below the 3-month high |

Score ≥ 80 lowers the trim % (let winners run). **ETFs** are hold-and-rebalance: +5–10% means hold with no automatic selling.

## Score

Six factors, weighted: Market trend 20 · Sector strength 20 · Price momentum 15 · Relative volume 15 · Fundamentals 20 · Concentration 10 (total 100). Colour: ≥80 green, ≥65 blue, ≥50 amber, below red.

## Live data vs snapshot

| Card / field | Source | Live? |
|---|---|---|
| Market regime chip, VIX, DMA table | `^GSPC`, `ACWI`, `^VIX` via relay (`/chart` POST, 1y daily) | ✅ Live — `pbPatchLiveRegime()` runs after render, 15-min client cache |
| 50/200 DMA ✓/✗ per holding | `r.yahoo_ticker` via relay | ✅ Live — `pbPatchLiveHoldingDMAs()` batch-fetches 4 at a time |
| Watch-outs note, Execute panel badge | Derived from live regime | ✅ Live — patched alongside regime |
| Sector exposure bars | ETF look-through % from pipeline | 📸 Snapshot — needs full pipeline run; labelled with run date |
| Pie-level view | Pie flags, avg score from pipeline | 📸 Snapshot — labelled |
| Holding scores, signals, notes | Pipeline factors (momentum, volume, fundamentals) | 📸 Snapshot — labelled |
| Breadth % | % of holdings above 50 DMA — from pipeline | 📸 Snapshot value used in regime scoring |

**Sector look-through cannot be recomputed live** — it requires ETF constituent sector weights that are only available during the full pipeline run.

## Live data architecture

`pbFetchPtsOrdered(sym)` — POST to `PROXY/chart` with `{symbol, range:'1y'}`. Returns sorted array of daily closes. No server-side KV cache (Cloudflare does not cache POST requests).

`pbComputeRegimeLive(storedBreadth)` — always fetches `^GSPC`, `ACWI`, `^VIX` in parallel (never reuses `_ovMk`, which may be hours old). 15-min client-side result cache `_pbLiveRegCache`.

`pbPatchLiveHoldingDMAs(rows)` — iterates `rows`, groups unique `yahoo_ticker` values, batch-fetches 4 at a time, patches `id="pb-dma-{sym}"` spans in-place. 15-min per-symbol client cache `_pbDmaCache`.

### Known limitation — breadth %
The breadth signal (% of your holdings above their 50 DMA) is kept from the pipeline snapshot. Computing it live would require fetching 1y data for every holding — that is done by the DMA patch for tick display, but the breadth number feeds into the regime score. Future improvement: derive live breadth from `_pbDmaCache` once it populates.

## Known bugs / fixed

| Date | Bug | Fix |
|---|---|---|
| 2026-11-23 | Live regime showed stale data (VIX 27.4, S&P ✗ DMA) despite green indicator — `pbComputeRegimeLive` reused `_ovMk.m['^GSPC'].pts` without an age check; `_ovMk` could be hours old from an earlier Overview tab fetch | Removed `_ovMk` reuse entirely; always fetch `^GSPC` fresh from relay |

## Data

`profit_booking` (per holding) and `profit_booking_summary` (totals, limits, regime), from `services/profit_booking_service.py`; in the private app from `docs/zk/profitbooking.js`.

## Tests

`tests/zk_profitbooking_test.mjs` (incl. pie `invested_gbp`/`gain_gbp`, JS = Python), `tests/profit_pies_layout_test.py` (Pie profit check card and the Profit to book explanation, 320/360/390px), `tests/ui_layout_test.py`.
