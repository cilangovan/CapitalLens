# 📋 Positions

**Question it answers:** what exactly do I hold, in which pie, and how is each line doing?

Tab id `positions` · loader `loadPositions()` · `docs/js/positions.js`, `docs/js/pie_drill.js`

## What you see

1. **ALL POSITIONS card** at the top: account value, rate of return, result in £. Tap it for the whole-account chart.
2. **One group per pie** (Defence, Atomic Resources, Cloud Empire, and so on, from the data): pie value and P&L, then one row per holding with quantity, price, value and P&L.
3. **Untagged** group: shares held **outside any pie** (for example NVIDIA, SpaceX, SGLN, or shares moved out of a pie). They are always listed, never dropped. The Emerging Markets pie is included like any other.

## Prices

Trading 212 quotes in the instrument's own currency. **Pence-quoted lines (GBX) are shown in pence (`p`), not as £.** USD and EUR show `$` and `€`.

## Drill-down pop-up (tap a pie, the whole account, or a holding)

Modelled on the Trading 212 pie screen: **value · last 24h · rate of return · chart · holdings**. Chart ranges **1D 1W 1M 3M 6M 9M 1Y MAX**:

| Range | Source |
|---|---|
| 1D | Your intraday `portfolio_snapshots` (actual Trading 212 values) |
| 1W … MAX | `pie_history`: holdings rebuilt from your Trading 212 trade history, valued at daily closes |

- **Rate of return (all-time)** = Trading 212 return ÷ invested, exactly as the Trading 212 app shows it.
- **Last 24h** is the change in profit; deposits do not count.
- Holdings = invested + P&L (not total minus free cash, which would also count blocked and pie cash).
- History is Trading 212's own data stored in the database (rebuilt by `services/pie_history_service.py` or the browser equivalent `docs/zk/piehistory.js`).

## Tooltips

Hover or tap any ticker for the flag, full name and what it is (`tickertips.js`, data from `instrument_exposure`).

## Collapsing

Each pie group is collapsible; state is remembered per user.

## HTML / style

`#positions > #positions-list` containing `.card.pd-allcard` and `.pie-group` blocks; the drill-down is an overlay (`pd-*` classes). Rows wrap on narrow screens; tap targets ≥ 40px.

## Tests

`tests/ui_layout_test.py`, `tests/zk_piehistory_test.mjs`.
