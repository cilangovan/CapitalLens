# 📊 Overview

**Question it answers:** how is the whole account doing right now, and what needs attention?

Tab id `overview` · loader `loadOverview()` · `docs/js/overview.js`

## Cards

| Card | What it shows | Data |
|---|---|---|
| **Stats strip** (`#stats-strip`) | Total Value, Invested, Cash, Total P&L (£ and %), Positions, Winners, Losers, Alerts | Latest row of `portfolio_snapshots` and its `positions` |
| **Gain % by Position** | Bar chart of each holding's gain. Period buttons **1D · 1W · 1M · 3M · 1Y · All**. Holdings with no data for a period show "No data yet for this period" instead of a zero bar | `positions` of the latest snapshot compared with the snapshot nearest the period start |
| **Portfolio by Pie** | Doughnut of value per pie. Pie colours are derived from the pie name, so no user pie names are stored in code | `positions.pie` |
| **Active Alerts** | The unread inbox alerts, newest first | `alerts` |
| **📐 Sector Map** | Value by sector, looking through ETFs to their underlying sectors | `instrument_sector_weights` + `instruments`; row-level security returns only instruments you hold |
| **🌍 Country Exposure** | Value by country, looking through ETFs | `instrument_country_weights` |

## Behaviour

- **Stale data warning:** a snapshot older than 12 hours is flagged beside the "updated" time.
- **All-time period** uses Trading 212's own profit figure; shorter periods difference two snapshots.
- Guest mode masks values with `***`.
- All sector, country, name and flag data comes from the database, never from a list in JavaScript.

## HTML / style

`#overview.tab > #stats-strip.stats-strip` then a `.grid2` of two `.card`s (one column below 700px), then full-width cards. Period buttons are `.period-btn` (min height 40px). Colours: gains `var(--green)`, losses `var(--red)`. Charts use the vendored `chart.umd.min.js`.

## Tests

`tests/ui_layout_test.py` (360/390px, no sideways scroll), `tests/zk_overview_stale_test.mjs` (stale-data warning).
