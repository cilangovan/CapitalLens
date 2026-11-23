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


## Recent purchases (last 7 days)
A card at the top of Positions tracks what you bought in the last 7 days, so a new investment can be followed without hunting for it. One row per ticker (several fills are combined at their weighted fill price) showing when it was bought, what you paid, your fill price, the latest price and the move **since purchase** (% and an estimated £). Source: your filled Trading 212 BUY orders against the latest price at your last Refresh, so it is an **estimate** (FX moves are not included) and only as fresh as the last Refresh. A purchase shows "N days left" and drops off by itself 7 days after it was filled; when nothing is left the card is not shown at all. If a holding has no latest price, or was sold, the row says "price n/a" / "not held now" instead of inventing a number. Collapsible like every card. Code: `docs/js/recent.js` (the private app reads orders through the encrypted store; the demo seeds two mock buys daily via `seed_demo_recent_buys`, `db/tenant/27_demo_recent_buys.sql`). Guarded by `tests/zk_recent_test.mjs` and `tests/recent_layout_test.py` (320/360/390px).


## Purchases outside pies
A card under the untagged holdings lists **one short line per stock** you hold outside a pie: name, number of buys, shares, total return (% and an estimated £). **Tap a stock** and a pop-up opens with its buys as a table (Bought · Shares · Paid · Return · £, oldest first, with an "All buys" total). **Tap a buy** for its detail: a **−5% and −10% stop-loss** price (with the £ at risk, flagged if the price is already below it), **+10 / +20 / +30% sell steps**, a copy-ready line such as `SELL 1 NVDA limit 130.00`, and the stops measured from today's price. **‹ All buys** goes back; **Close**, the ✕ or Esc closes the pop-up. Sells are matched **oldest buy first (FIFO)**; a stock you have sold completely, or that sits only inside pies, is **not listed**. Stocks are sorted by £ gain.

Honest limits: it is an **estimate** from your filled Trading 212 orders (FX moves and fees are not included, and the price is as of the last Refresh). If the synced order history holds fewer shares than you own outside pies (older buys) the pop-up says "not in the synced order history" and the row shows "incomplete history"; if it holds more (shares moved into a pie) it says so. Missing prices show "n/a", never zero. CapitalLens never places orders: you set any limit or stop order yourself in Trading 212. Code: `docs/js/lots.js`; the demo seeds mock buys via `seed_demo_lots` (`db/tenant/28_demo_lots.sql`). Guarded by `tests/zk_lots_test.mjs` and `tests/lots_layout_test.py` (320/360/390px, every theme, keyboard).
