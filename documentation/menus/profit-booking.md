# 💰 Profit Booking & Capital Protection

**Question it answers:** which winners should I trim, which positions are too big, and where must I re-check why I own something?

Tab id `profit` · loader `loadProfit()` · `docs/js/profit.js`

## Header tiles

Tap a tile for a pop-up that explains the number and lists the stocks behind it.

| Tile | Meaning |
|---|---|
| **1% risk per trade** | The rule: never lose more than 1% of holdings on one trade. The pop-up lists each stock's **max size** (risk £ ÷ its risk distance) and **exit price** (trailing stop = 3× its average daily move (ATR) below its 3-month high), and flags **oversized** positions |
| **Profit to book** | The sum suggested by the ladder for steps already reached |
| **Actions** | Counts per action level |

## Action levels

`Reassess` (something broke: trend, stop or fundamentals — re-check why you own it) → `Rebalance` → `Book profit` → `Let it run` → `Hold`. Listed in that urgency order.

## Sections

1. **Market conditions** — the regime used by the scoring.
2. **Sector exposure (look-through)** — with a cap (`maxSec`%) per sector.
3. **Holdings — weekly score & action** — each holding's score and action.
4. **Pie-level view.**
5. **⚠️ Watch-outs.**
6. **📘 Rulebook** (always shown):

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

## Data

`profit_booking` (per holding) and `profit_booking_summary` (totals, limits, regime), from `services/profit_booking_service.py`; in the private app from `docs/zk/profitbooking.js`.

## Tests

`tests/zk_profitbooking_test.mjs`, `tests/ui_layout_test.py`.
