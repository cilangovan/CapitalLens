# UI requirements

Detail per menu is in the [menu pages](../reference/menu-map.md); the visual rules are in the [UI & style guide](../ui-design-system.md). This page is the requirement layer: what must be true, and how we know.

## A. Global rules (every dashboard)

| ID | Requirement | Check | Status |
|---|---|---|---|
| UI-G1 | **Mobile first.** Every dashboard and section fits 360px and 390px with no sideways scroll; tap targets are at least 40px | `tests/ui_layout_test.py` (CI; needs a database key), `ipo_layout_test.py`, `docs_layout_test.py` (320/360/390), `demo_layout_test.py`, `ops_layout_test.py` | ✅ |
| UI-G2 | **Every section collapses**; open or closed is stored per user (`user_ui_prefs`) and restored after logout and login. Any `.card` with an `<h3>` gets it | `docs/js/collapse.js`; no dedicated test named | 🟡 |
| UI-G3 | **Same time spans on every graph with a selector:** 1D · 1W · 1M · 3M · 6M · 9M · 1Y, plus All or MAX where the data allows. A span the data cannot cover says so | `tests/standards_test.py` | ✅ |
| UI-G4 | **Tooltips** on P&L bubbles and similar show the holding's full name and country flag; names and flags come from the database, never from JavaScript | rule in `CLAUDE.md`; standards test checks no holdings lists in JS | 🟡 |
| UI-G5 | **A feature reaches every dashboard** (legacy, demo, app, zkapp, zkapp-prod) from shared sources; generated files are never edited | standards test (same modules on legacy and demo); builds fail CI if stale | ✅ |
| UI-G6 | **Footer on every dashboard** with 📘 Documentation (`help/` or `../help/`), and a link on the sign-in box; at least 40px tall | `tests/standards_test.py`, `tests/docs_layout_test.py` | ✅ |
| UI-G7 | **Never a blank screen while loading:** a boot splash with spinner and text until the sign-in box or dashboard shows; every card "Loading…" has a spinner. CSS only | `tests/login_flash_browser_test.py` | ✅ |
| UI-G8 | **No login flash on refresh:** the sign-in box stays hidden until the saved-session check finishes | `tests/login_flash_browser_test.py`, `tests/zk_login_flash_test.mjs` | ✅ |
| UI-G9 | **Honest data:** unverifiable data is said to be missing; no fake "clear" status; ratings, prices and dates are never invented and name their source; estimates are labelled | per-feature tests (alerts, ratings, IPO, overview) | 🟡 |
| UI-G10 | **Broker definitions:** account figures use Trading 212's own meaning (investments value, cost basis, unrealised result) | `tests/zk_overview_stale_test.mjs`; "How the numbers add up" card | ✅ |
| UI-G11 | **Stale data is flagged:** a snapshot older than 12 hours shows a warning beside "updated" | `tests/zk_overview_stale_test.mjs` | ✅ |
| UI-G12 | **Currency display:** pence-quoted lines (GBX) are shown in pence (`p`), USD and EUR with `$` and `€` | `docs/js/positions.js`; no dedicated test named | 🟡 |
| UI-G13 | **Safe markup:** everything from the server passes `defuse`; page code escapes what it inserts; no inline script in the private app | `tests/security_check.py`, `tests/zk_handlers_test.mjs` | ✅ |
| UI-G14 | **Consistent patterns:** reuse collapsible cards, chips, `.w-cats` tabs, the `api()` helper and the encrypted store; look at the nearest feature first | review; style guide checklist | 🟡 |
| UI-G15 | **Accessibility:** colour is never the only cue (red/green also carry a sign or label), text contrast is legible on the dark theme, controls reachable by keyboard and labelled for screen readers | no standard or test exists | ⬜ |
| UI-G16 | **Personalisation (proposed):** theme, font, language, region and currency are per-user choices applied on every dashboard; converted currency is always labelled; missing translations fall back to English | [Epic: Personalisation](epic-personalisation.md); `tests/zk_appearance_test.mjs`, `tests/appearance_layout_test.py` (themes, fonts, size only) | 🟡 |

## B. Wireframes (phone, 360px)

**Shell**
```
┌────────────────────────────────┐
│ 🌐 CapitalLens [PRIVATE]       │  pill = variant
│ Updated 2h ago  ⚙ Settings  ⎋  │  ⚠ if older than 12 h
├────────────────────────────────┤
│ 📊 🫧 📋 🔬 🎯 💰 📈 ⭐ 🔔③ → │  scrolls inside the bar
├────────────────────────────────┤
│ ┌ Card title            ▾ ┐   │  tap heading = collapse
│ │ content                  │   │
│ └──────────────────────────┘   │
│ ┌ Card title            ▸ ┐   │  remembered per user
├────────────────────────────────┤
│        📘 Documentation        │
└────────────────────────────────┘
```

**Overview**
```
┌ Total  Investments  Cost basis ┐  stats strip, wraps
│ £..    £..          £..        │
│ Cash   Reserved                │
├ Investments value  1D 1W 1M 3M ┤
│ 6M 9M 1Y                       │
│   ╱╲  ╱‾‾╲___╱‾               │  line chart
├ Gain % by position  [period]   ┤
│ ████ AAA  +12%   ▏▏ BBB -3%    │
├ Portfolio by pie  (doughnut)   ┤
├ Market decline by country      ┤
│ ◀██ Japan -4%                  │
├ Markets I hold                 ┤
├ Active alerts · Sector · Country┤
```

**Positions drill-down (tap a pie, the account or a holding)**
```
┌ Defence                    ✕ ┐
│ Value £..   Last 24h +£..     │
│ Return +x%                    │
│ 1D 1W 1M 3M 6M 9M 1Y MAX      │
│   ╱‾╲_╱‾‾                     │
│ Holdings                      │
│ 🇬🇧 BAE Systems  £..  +£..    │  tap ticker = name, flag
└───────────────────────────────┘
```

**Alerts inbox**
```
┌ 🔔 Alerts   📥 Inbox③ 🗄 Archived 🧹 Cleared ┐
│ ☐ ● AAA review          ← swipe = clear  │
│    weight 14% vs 10% target (+4)         │
│    £ price · day −3% · 20d high · dd −8% │
│    flag: REVIEW · data: 4 of 4 checked   │
│ [✓ read] [🗄 archive] [✕ clear]          │
│ [Clear all read]            undo toast ⏎ │
└──────────────────────────────────────────┘
```

**Watchlist and IPO Watch**
```
┌ 📈 Stocks │ 🛢 Commodities │ ₿ Crypto ┐
│ [ search any stock worldwide…      ]  │
│ ☆ Bookmark → this week's call         │
│ 🟢 ENTER  AAA  £ per step · RSI · vol │
│                         ✕ remove      │
├ 🚀 IPO Watch ─────────────────────────┤
│ [search company/ticker/exchange/country]
│ chips: All US UK India HK Other  [exch▾]
│ ⭐ My IPO list: Nothing here yet.     │
│ result: Name · Exchange · status      │
│   rating pill (source on hover)       │
│   Opens · Closes · Lists   ☆ Bookmark │
└───────────────────────────────────────┘
```

**Settings panel (private app)**
```
┌ ⚙ Settings            ? ● ● ┐
│ 🔑 Check recovery key [____]  │
│ 🔄 Refresh your data          │
│   T212 key [____] secret [___]│  read-only, used once
│   [Refresh now]  ▓▓▓░ chip    │
│ Phone alerts  ntfy topic [__] │
└───────────────────────────────┘
```

## C. User stories by menu

Format: *As a … I want … so that …*, then acceptance criteria (AC). Test scenarios are in [Traceability](traceability.md).

| ID | Menu | Story | Acceptance criteria | Status |
|---|---|---|---|---|
| UI-1 | App shell | As an investor I want to sign in and land on my dashboard without a flash or blank screen, so that the app feels reliable | AC1 splash shows while the key unlocks; AC2 after 12 s it adds a "taking longer" hint; AC3 sign-in box appears only if there is no valid session; AC4 a broken saved session falls back to the box | ✅ |
| UI-2 | App shell | As an investor I want to know how fresh the numbers are | AC1 header shows age of newest snapshot; AC2 older than 12 h shows a warning | ✅ |
| UI-3 | Overview | As an investor I want my account totals as Trading 212 defines them | AC1 Total = Investments + Cash + Reserved (+ Other only if unexplained); AC2 older snapshots without account figures are labelled estimate with no cost-basis tile; AC3 the "How the numbers add up" card shows the formula | ✅ |
| UI-4 | Overview | I want to see how my investments value moved over 1D to 1Y | AC1 seven spans; AC2 sparse spans fall back to `pie_history` and say so; AC3 a span the data cannot cover says so | ✅ (charts: see CH) |
| UI-5 | Overview | I want to see which of my holdings' countries are declining | AC1 horizontal bars worst first, red decline, green gain; AC2 metals and non-country buckets are not shown as countries; AC3 seven spans | ✅ |
| UI-6 | Overview | I want the markets I hold (Nifty 50, Sensex, FTSE 100 …) and how far below their 1-year high they are | AC1 Trend, Weekly change and Table views; AC2 1D is intraday; AC3 history gaps are labelled | ✅ |
| UI-7 | P&L Bubbles | I want to see which holdings moved most today, this week, this month | AC1 one bubble per holding sized and coloured by P&L; AC2 tooltip shows full name and flag; AC3 the actual look-back is stated when history is short; AC4 empty state "No snapshot data yet." | 🟡 |
| UI-8 | Positions | I want every holding listed by pie, including shares outside pies | AC1 groups per pie with value, P&L and rows; AC2 an **Untagged** group is always shown; AC3 Emerging Markets is included; AC4 all-time return = broker return ÷ invested (the Untagged group has no test of its own) | 🟡 |
| UI-9 | Positions | I want a pie, holding or the whole account drill-down like the broker app | AC1 value, last 24 h, return, chart, holdings; AC2 ranges 1D…MAX; AC3 deposits do not count in last 24 h | ✅ |
| UI-10 | Analyst | I want analyst consensus and a stock-type label for what I hold | AC1 pie cards, Lynch buckets, ratings table for current holdings only; AC2 missing ratings shown as missing; AC3 Lynch badge explains reason and confidence and is labelled a screening aid | ✅ |
| UI-11 | Strategy | I want a weekly plan across my pies | AC1 four sections (institutional flow, holding decisions, entry analysis, weekly allocation); AC2 allocation reflects the monthly maximum and market mood; AC3 each section states its basis, none is advice | ✅ |
| UI-20 | Strategy | I want, under Entry Analysis, the support levels of the stocks I hold, with live status, commentary and a summary table | AC1 held stocks only (latest positions snapshot); AC2 zone, source tags, live price and distance, 52-week drawdown; AC3 status below / in / approaching / above / no live price; AC4 commentary from the numbers only, never advice; AC5 source and capture date named, snapshot price labelled as a snapshot; AC6 no live or mismatched-currency price → says so; AC7 summary table; AC8 fits 360px and 390px; collapsible; AC9 on every dashboard, demo included; AC10 type filter All / Stocks / ETFs / Commodities, Stocks by default, counts of what is held; AC11 ETFs and commodity funds show a computed 200-week EMA only, labelled computed; pence quotes shown as pence | ✅ |
| UI-21 | Settings | I want to choose my theme, font, language (English, French, German, Spanish, Italian), region and display currency, per user | See [Epic: Personalisation](epic-personalisation.md): AC per story UI-21a to UI-21g. Themes, fonts and text size built; language, region and currency not yet | 🟡 partly built |
| UI-21 | Watchlist | I want to arrange the watchlist cards up and down, and have my order remembered on my login | AC1 ⇅ Arrange per section (Stocks / Commodities / Crypto); AC2 ▲ ▼ buttons ≥ 40 px, ends disabled; AC3 order saved per user and restored after logout/login; AC4 private app stores it inside the encrypted watchlist row (server never sees tickers or order); AC5 never-arranged and new cards follow in the automatic order; AC6 ↺ Automatic order resets; AC7 failed save is reported; AC8 fits 320/360/390px; AC9 on every dashboard (demo keeps it in the browser); AC11 every card has a ⠿ drag handle (≥ 40 px, mouse and touch) that reorders by dragging, with the other cards folded while dragging; AC12 My IPO list cards have the same drag (⠿ strip ≥ 40 px, mouse and touch); AC10 the same ⇅ Arrange for **My IPO list** (encrypted `sort_order` in each `ipo_watch` row) | ✅ |
| UI-12 | Profit Booking | I want to know which winners to trim and what to re-check | AC1 action levels Reassess → Rebalance → Book profit → Let it run → Hold; AC2 1%-risk tile with max size and exit price per stock; AC3 rulebook always visible; AC4 six-factor score totalling 100 (scoring logic is tested by `tests/zk_profitbooking_test.mjs`; the tiles and pop-ups are held by review) | 🟡 |
| UI-13 | Returns | I want my real return after every deposit and withdrawal | AC1 profit = value − money in; AC2 ranges 1D…All plus YTD; AC3 profit/value switch; AC4 incomplete history is stated, nothing extrapolated | ✅ |
| UI-14 | Watchlist | I want to track stocks, commodities and crypto and get a weekly call | AC1 search worldwide; AC2 ☆ bookmark gives ENTER/ACCUMULATE/HOLD/AVOID with price points, amount, RSI, volume, quality; AC3 ✕ removes and stops tracking; AC4 analyst chip or "no coverage", never an invented rating | ✅ |
| UI-15 | IPO Watch | I want to find an upcoming IPO and keep the ones I care about | AC1 nothing preloaded; AC2 search by company, ticker, exchange or country with chips and exchange filter; AC3 ☆ Bookmark adds to My IPO list (per user, encrypted); AC4 a rating other than "Not rated" must show its source | ✅ |
| UI-16 | Alerts | I want review reports I can triage like email | AC1 report has weight vs target, threshold check, review flag, coverage note; AC2 no alert and no "clear" for unverifiable holdings; AC3 mark read, archive, clear (swipe + undo), restore, bulk; AC4 cleared items deleted after 30 days; AC5 phone push via ntfy on Refresh | ✅ |
| UI-17 | Settings | I want to refresh my data and keep my recovery key safe | AC1 Trading 212 key read-only, used once, never saved; AC2 recovery key check runs in the browser only; AC3 a progress chip shows during refresh; AC4 re-analysis automatic after 6 h or an app update | ✅ |
| UI-18 | Demo | As a prospect I want a one-hour demo login in one tap | See [Demo requirements](../demo-requirements.md) | ✅ |
| UI-19 | Ops | As platform staff I want health and growth figures without customer data | AC1 aggregates only; AC2 access needs staff list and second factor; AC3 nothing stored in the browser | ✅ |
