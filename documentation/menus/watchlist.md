# ⭐ Watchlist & IPO Watch

**Question it answers:** what should I buy this week from the things I am tracking, and what is about to list?

Tab id `watchlist` · loaders `loadWatchlist()` and `loadIpo()` · `docs/js/watchlist.js`, `docs/js/drilldown.js`, `docs/js/ipo.js`

## Watchlist

Three sections (tabs `.w-cats`): **📈 Stocks · 🛢 Commodities · ₿ Crypto**.

- **Search** (any stock or ETF worldwide, e.g. `Toyota`, `0700.HK`; crypto via Yahoo and Trading 212 ETPs; commodities via Trading 212 ETCs and market futures). Quick picks for commodities (Gold, Silver, Brent, WTI, Natural gas, Copper, Platinum, Wheat) and crypto (Bitcoin, Ethereum, Solana, XRP, Cardano).
- **☆ Bookmark** an item to put it on the weekly plan. Each bookmarked item shows this week's **call**:

| Call | Meaning |
|---|---|
| 🟢 ENTER | Buy this week |
| 🔵 ACCUMULATE | Buy in steps |
| 🟡 HOLD | Wait for the price points |
| 🔴 AVOID | Not this week |

  together with **price points with £ per step, how much to buy** (from the per-category weekly budget), **RSI**, **volume** and **quality**.
- **✕ Remove** stops all tracking of that item.
- **Tap a name** for the full detail page: live chart (1D…5Y with 50/200-day moving averages), day and 52-week range, key stats, analyst rating and target, trading / profitability / leverage, company profile, insights and score radar, and this week's plan. Live prices use the `/chart` route (Yahoo Finance).
- Prices from London lines quoted in pence are shown in pence.
- Data: `watchlist` and `watchlist_analysis` (`services/watchlist_service.py`; private app: `docs/zk/watchlist.js`, `watchlistops.js`). Weekly budgets are settings: `watchlist_weekly_budget`, `commodity_weekly_budget`, `crypto_weekly_budget`.

## 🚀 IPO Watch (card under the watchlist)

IPOs across **all markets**: where each lists, status, rating **with its source**, and the opens / closes / listing dates.

| Element | Detail |
|---|---|
| Market tabs | **ALL**, **⭐ Watching** (only when per-user watching is available), **US**, **UK**, **IN**, **HK**, **OTHER** |
| Status (phase) | open · closed · upcoming · priced · filed · rumoured · listed · postponed · withdrawn, derived from the dates |
| Each row | Name, ticker, exchange, sector, rating pill (hover for source), **Opens / Closes / Lists**, price range or price, deal size, note, source link |
| **Watch / Remove** | A ☆ Watch button on every card; a watched card shows ★ Watching and a **✕** (same ✕ as the stock watchlist, top right, 40px) that removes it from your list. Per-user, stored encrypted in the private app (`ipo_watch`); the Watching tab lists your picks. Legacy and demo dashboards hide the buttons |

- **Honest ratings:** a rating other than *Not rated* must carry a `rating_source`; ratings are never invented. Today all rows are *Not rated* until a rating source is chosen.
- **Honest dates:** an IPO whose price is not final says so in its note (for example "final price not confirmed").
- Data: shared public table `ipo_calendar`, upserted from `config/ipo_calendar.json` by `services/ipo_service.py` (workflow `IPO Calendar`, weekdays 06:15 UTC). There is no live exchange feed; the calendar is curated JSON with a named source on every row.
- Per-user watch: routes `POST ipo/watch` and `ipo/unwatch` are answered in the browser by `docs/zk/shim.js` into the encrypted store (no database migration needed; `enc_rows.kind = 'ipo_watch'`).

## Tests

`tests/zk_watchlist_test.mjs`, `tests/zk_watchlistops_test.mjs`, `tests/zk_ipo_test.mjs`, `tests/ipo_service_test.py`, `tests/ipo_layout_test.py` (320/360/390px), `tests/ipo_watch_browser_test.py`.
