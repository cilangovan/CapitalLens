# 📊 Overview

**Question it answers:** how is the whole account doing right now, and what needs attention?

Tab id `overview` · loader `loadOverview()` · `docs/js/overview.js`

## Cards

| Card | What it shows | Data |
|---|---|---|
| **Stats strip** (`#stats-strip`) | **Total Value** (whole account incl. cash), **Investments** (value of your shares = cost basis + unrealised result), **Cost basis** (money put into the shares you hold), **Cash** (free cash), **Reserved** (cash held for pending limit orders plus pie cash; shown only when above zero), **Unrealised P&L** (£ and % **of cost basis**), Winners, Losers, Positions, Alerts | The snapshot's own Trading 212 account figures (`raw.account`: `invested`, `ppl`, `total`, `free`, `blocked`, `pieCash`) so the numbers match the Trading 212 app; per-position counts from `positions` |
| **Gain % by Position** | Bar chart of each holding's gain. Period buttons **1D · 1W · 1M · 3M · 1Y · All**. Holdings with no data for a period show "No data yet for this period" instead of a zero bar | `positions` of the latest snapshot compared with the snapshot nearest the period start |
| **Portfolio by Pie** | Doughnut of value per pie. Pie colours are derived from the pie name, so no user pie names are stored in code | `positions.pie` |
| **Active Alerts** | The unread inbox alerts, newest first | `alerts` |
| **📐 Sector Map** | Value by sector, looking through ETFs to their underlying sectors | `instrument_sector_weights` + `instruments`; row-level security returns only instruments you hold |
| **🌍 Country Exposure** | Value by country, looking through ETFs | `instrument_country_weights` |

## Behaviour

- **Definitions match Trading 212** (Investments value, Unrealised result, Cost basis). Older snapshots that lack the account figures fall back to total − free cash, labelled "estimate", with no Cost basis tile.
- **Why a figure can still differ from the Trading 212 app:** the dashboard shows the snapshot taken at the time shown in the header ("Updated … ago"), while the app is live; Total Value includes cash, the app's Investments screen does not.

- **Stale data warning:** a snapshot older than 12 hours is flagged beside the "updated" time.
- **All-time period** uses Trading 212's own profit figure; shorter periods difference two snapshots.
- Guest mode masks values with `***`.
- All sector, country, name and flag data comes from the database, never from a list in JavaScript.

## HTML / style

`#overview.tab > #stats-strip.stats-strip` then a `.grid2` of two `.card`s (one column below 700px), then full-width cards. Period buttons are `.period-btn` (min height 40px). Colours: gains `var(--green)`, losses `var(--red)`. Charts use the vendored `chart.umd.min.js`.

## Tests

`tests/ui_layout_test.py` (360/390px, no sideways scroll), `tests/zk_overview_stale_test.mjs` (stale-data warning).

## How the numbers add up (card)

A collapsible card under the stats strip with one bar and the formulas, using the snapshot's Trading 212 account figures: Total Value = Investments + Cash + Reserved (+ Other, only if something is left unexplained); Investments = cost basis + unrealised result; Unrealised % = result ÷ cost basis. If the snapshot has no account breakdown it says so instead of drawing numbers. Its open/closed state is remembered per user like every card.

## Snapshot columns

New snapshots store `invested` = cost basis + unrealised result and `total_ppl` = Trading 212's unrealised result (both from the account figures), not total minus free cash. Older snapshots keep the old values and are labelled as estimates.

## Market decline by country (card)

A collapsible card with 1D / 1W / 1M / 3M / 1Y buttons and one horizontal bar per country (red for a decline, green for a gain, worst first). It is **your holdings by country**, not index data: each holding's price change between the latest saved snapshot and an older one, weighted by its value at the start. Funds are split by their country weights (`instrument_country_weights`); holdings with no country data are grouped as **Unclassified**, never hidden. A holding with no price at both dates is left out. A span longer than the saved history says "not enough saved history yet" instead of showing a made-up bar. The older snapshot is the newest one that is at least about 80% of the span old, and its date is shown. Source: the `portfolio_snapshots` and `positions` tables. Guarded by `tests/zk_overview_stale_test.mjs`.

## Investments value over time (card)

A collapsible line chart with 1D / 1W / 1M / 3M / 1Y buttons, like the Trading 212 home screen. Each point is a saved snapshot's **investments value as Trading 212 defines it** (cost basis + unrealised result, from the snapshot's account data). Snapshots saved before that data was kept are left out so the line never mixes two definitions; the card says how many points it has and how many days they cover, and draws no line with fewer than two points. The change shown is first to last point in the span, and the card notes that buying or selling moves the value, so a rise is not always performance. Points exist only for days you pressed Refresh ("nothing runs while the app is closed"), so it is sparser than Trading 212's own chart. Source: `portfolio_snapshots`. Guarded by `tests/zk_overview_stale_test.mjs`.

### Longer spans (rebuilt history)

Saved snapshots only exist for days you pressed Refresh. When a span has too few snapshots, both the line chart and the decline-by-country card fall back to `pie_history` (the same data as the Positions drill-down: holdings rebuilt from your Trading 212 order history, valued at daily closes) and say so on the card ("rebuilt from your Trading 212 order history"). The decline card uses each holding's price (value ÷ quantity) at both dates, only for holdings you owned at both. Snapshots win when they cover the span. Guarded by `tests/zk_overview_stale_test.mjs`.

## Markets I hold (card)

Index moves for the markets behind your holdings: 1D / 1W / 1M / 3M / 1Y change and how far each index is below its highest close of the past year ("from 1Y high"). Nifty 50, Sensex and FTSE 100 are always shown; other indices (S&P 500, Nasdaq 100, DAX, Nikkei 225, SSE Composite, TAIEX, FTSE MIB, IBEX 35, AEX, WIG20) appear when that country is in your holdings' country weights (`instrument_country_weights`), marked "you hold". Source: Yahoo Finance daily closes through the same `/chart` route as the watchlist (1y range, one call per index, cached 15 minutes). A span the data does not reach shows "–", and an index Yahoo does not return shows "no data"; nothing is guessed. These are the indices' own moves, not your holdings'.

### Market decline by country: what counts as a country

The decline-by-country card lists only real countries in its main list. Commodity funds (Silver, Gold), "Other" and "Unclassified" are shown under their own "Not countries" heading. Guarded by `tests/zk_overview_stale_test.mjs`.
