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

  together with **price points with £ per step, how much to buy** (from the per-category weekly budget), **RSI**, **volume** and **quality** and an **analyst chip** (Yahoo Finance recommendation and number of analysts, or "no coverage"; never an invented rating).
- **✕ Remove** stops all tracking of that item.
- **Tap a name** for the full detail page: live chart (1D…5Y with 50/200-day moving averages), day and 52-week range, key stats, analyst rating and target, trading / profitability / leverage, company profile, insights and score radar, and this week's plan. Live prices use the `/chart` route (Yahoo Finance).
- Prices from London lines quoted in pence are shown in pence.
- Data: `watchlist` and `watchlist_analysis` (`services/watchlist_service.py`; private app: `docs/zk/watchlist.js`, `watchlistops.js`). Weekly budgets are settings: `watchlist_weekly_budget`, `commodity_weekly_budget`, `crypto_weekly_budget`.

## 🚀 IPO Watch (card under the watchlist)

Works like the stock watchlist: **nothing is listed until you bookmark it.** The IPO calendar is only the thing you search.

1. **Search** the calendar by company, ticker, sector, exchange or country name (for example `Anthropic`, `Nasdaq`, `India`). Several words narrow the result.
2. **Filter** by **country** (chips: All countries, US, UK, India, HK, Other) and by **exchange** (dropdown built from the calendar). A filter on its own lists everything that matches.
3. **☆ Bookmark** a result. It appears under **⭐ My IPO list** (and the result reads ★ In my list).
4. **✕** on a card in My IPO list removes it (same ✕ as the stock watchlist, top right, 40px).

| Element | Detail |
|---|---|
| My IPO list | Empty by default ("Nothing here yet. Search above, then tap ☆ Bookmark…"). Per-user, stored encrypted in the private app (`ipo_watch`) |
| Search results | Shown only while a query or a filter is set, with a count; hidden when cleared |
| Each card | Name, ticker, exchange, sector, status, rating pill (hover for source), **Opens / Closes / Lists**, price range or price, deal size, note, source link |
| Status (phase) | open · closed · upcoming · priced · filed · rumoured · listed · postponed · withdrawn, derived from the dates |
| Legacy and demo dashboards | Search and filters work; there is no per-user list, so no Bookmark buttons |

- **Honest ratings:** a rating other than *Not rated* must carry a `rating_source`; ratings are never invented. Today all rows are *Not rated* until a rating source is chosen.
- **Honest dates:** an IPO whose price is not final says so in its note (for example "final price not confirmed").
- Data: shared public table `ipo_calendar` (the searchable catalogue, nothing about any customer), upserted from `config/ipo_calendar.json` by `services/ipo_service.py` (workflow `IPO Calendar`, weekdays 06:15 UTC). There is no live exchange feed; the catalogue is curated JSON with a named source on every row.
- Per-user list: routes `POST ipo/watch` and `ipo/unwatch` are answered in the browser by `docs/zk/shim.js` into the encrypted store (no database migration needed; `enc_rows.kind = 'ipo_watch'`).

## Tests

`tests/zk_watchlist_test.mjs`, `tests/zk_watchlistops_test.mjs`, `tests/zk_ipo_test.mjs`, `tests/ipo_service_test.py`, `tests/ipo_layout_test.py` (320/360/390px, every filter), `tests/ipo_watch_browser_test.py` (real typing, filters, bookmark, ✕).
