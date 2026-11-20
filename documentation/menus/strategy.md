# 🎯 Strategy

**Question it answers:** where is institutional money moving, what should I do with each holding, where is a good entry, and how should this week's budget be split?

Tab id `strategy` · loader `loadStrategy()` · `docs/js/strategy.js`

The tab stacks five sections (each a collapsible card):

## 1. 🌍 Global Institutional Capital (`#inst-flow-content`)

A weekly money-flow report: **market score cards** (score → label: ≥80 Strong Accumulation, ≥65 Positive, ≥45 Neutral, otherwise Weak), **sector rotation**, **opportunities**, **cautions** and **portfolio actions**.

- Data: `institutional_flow_reports` (public, shared), built weekly by `services/institutional_flow_service.py` (Saturday, see [Workflows](../workflows.md)) and in the browser by `docs/zk/flow.js`.
- Empty state: "No data yet — runs every Sunday." (the message is shown until the first report exists).

## 2. 📊 Holding Decisions (`#holding-dec-content`)

A weekly **per-stock / per-ETF decision score**, newest report first, lowest score first so the weakest holdings surface at the top.

- Data: `holding_decisions` (`services/holding_decision_service.py`, browser: `docs/zk/holdingdecision.js`).

## 3. 🎯 Entry Analysis

Live analysis per stock, grouped by pie: **PWI Scout · RSI · moving averages · 52-week range · average cost**. Tap a stock for its **entry zones, this-week target price and risk scorecard**.

- Data: `value_buy_scores` (`services/value_buy_service.py`, browser: `docs/zk/valuebuy.js`). The JSON columns `entry_zones`, `scorecard`, `earnings`, `this_week` are parsed **before** `defuse()` (which swaps quotes); the zero-knowledge shim does this in `parseJsonCols` (regression test in `tests/zk_shim_test.mjs`).
- Rating chips: 🟢 Strong Buy, 🟡 Accumulate, ⚪ Hold/Wait. Action chips: 🚀 BUY NOW, 📈 DCA — ADD, 🔵 ACCUMULATE, ⏳ WAIT FOR DIP, 🛑 HOLD / AVOID.

## 3b. 🛡️ Support Levels (`#support-levels-content`, directly under Entry Analysis)

**Stocks you hold only.** For each held stock that has a support level on file: a card with the **zone** (e.g. META `$550–560`), the source's tags ("Crucial support zone", "200-week EMA", "Previous breakout"…), the **live price and how far it is from the zone**, the 52-week drawdown, and a short **commentary**; a **summary table** (stock · zone · live · status) closes the section. Cards are sorted most urgent first: below the zone, in the zone, approaching, above, no live price.

- **Status** compares the live price with the zone: *Below the zone*, *In the zone*, *Approaching the zone* (within 3% above), *Above the zone*, or *Live price unavailable*. A single-number level ("wait for $150") counts as "in" within 1.5%.
- **Live price** comes from the Entry Analysis rows (`value_buy_scores`, native currency, so it is comparable with a USD zone). If it is missing, or in another currency, the card says so; it never guesses. The price the source showed when captured is labelled as a snapshot.
- **Commentary** is generated from the numbers only (distance to the zone, your average cost against the zone, the source's tags). It describes and never instructs; nothing here is advice.
- **Stale levels (issue #52):** a level older than 14 days gets a "Captured N days ago" chip and a "may have moved" note; the section header always names the oldest capture date.
- **Computed levels (issue #50):** a held US stock with **no** level on file gets one computed in the browser: the **200-week EMA** of ~5 years of price history (last close of each week, seeded with the simple average of the first 200 weekly closes, smoothing 2/201; needs at least 200 weeks, otherwise nothing is shown). It is labelled "CapitalLens (computed)" and "not an analyst view", is never marked stale, and uses the dashboard's existing `/chart` route (same price source as the charts, so it is covered by the market-data licence research in #11/#12).
- **Alerts (issue #51):** the morning Refresh raises an alert when a held stock reaches or breaks its zone; see [Alerts](alerts.md).
- **Held** = your latest positions snapshot (Trading 212 tickers mapped to symbols, e.g. `FB_US_EQ` → META). The match happens in your browser. Levels for stocks you do not hold are not shown; if none of your holdings has a level the section says so.
- Data: public shared table `support_levels` (`db/tenant/23_support_levels.sql`): an **external analyst view** (every row names its source and capture date), not our calculation. Seeded from KwickScan.com "Support levels to watch" captured 20 Nov 2026: META, BE, HOOD, INTC, NVDA, QCOM, CRM, NOW with detail, and ORCL, AMZN, TSLA from the summary table only. Updating levels is a data change (an upsert in a migration), not a code change.
- Demo: `demo_support_levels`, rebuilt by the daily demo refresh from the demo holdings' mock prices and labelled "Illustrative demo level / Demo data" (see [Demo](../demo.md)).
- Module `docs/js/support.js` (`loadSupportLevels`), rolled out to every dashboard. Requirements and rollout: [Epic: Support Levels](../requirements/epic-support-levels.md).

## 4. Weekly allocation (`#strategy-content`)

The **Aggressive-mode** plan:

- Stats: **Week** (n of 4–5), **This week** (£ suggested, of the monthly maximum), **Market mood** (😎 🙂 😨 😱 with VIX) and **Annualised** return versus the 10% base case / 15% optimistic case.
- **Recommendations:** one card per pie with an amount and the reason; priority colours HIGH / MEDIUM / LOW.
- **Notes** from the allocator.
- Data: `strategy_recommendations` (`services/strategy_service.py`, browser: `docs/zk/strategy.js`). Weightings are calibrated to a recurring £30 contribution on the Trading 212 pies.
- If there is no row yet: "No strategy data yet. Run the daily_services workflow." (legacy) or press Refresh (private).

## Behaviour

- Guest mode hides all five sections and shows "🔒 Sign in to view strategy recommendations".
- Nothing here is advice; each section states its basis.

## Tests

`tests/zk_strategy_test.mjs`, `tests/zk_flow_test.mjs`, `tests/zk_holding_value_test.mjs`, `tests/zk_shim_test.mjs` (Entry Analysis JSON regression), `tests/zk_support_levels_test.mjs` (Support Levels logic, stale warning, 200-week EMA, escaping, placement), `tests/zk_support_alert_test.mjs` (zone alerts), `tests/support_layout_test.py` (fits 320/360/390px, live and demo pages).
