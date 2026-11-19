# 🎯 Strategy

**Question it answers:** where is institutional money moving, what should I do with each holding, where is a good entry, and how should this week's budget be split?

Tab id `strategy` · loader `loadStrategy()` · `docs/js/strategy.js`

The tab stacks four sections (each a collapsible card):

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

## 4. Weekly allocation (`#strategy-content`)

The **Aggressive-mode** plan:

- Stats: **Week** (n of 4–5), **This week** (£ suggested, of the monthly maximum), **Market mood** (😎 🙂 😨 😱 with VIX) and **Annualised** return versus the 10% base case / 15% optimistic case.
- **Recommendations:** one card per pie with an amount and the reason; priority colours HIGH / MEDIUM / LOW.
- **Notes** from the allocator.
- Data: `strategy_recommendations` (`services/strategy_service.py`, browser: `docs/zk/strategy.js`). Weightings are calibrated to a recurring £30 contribution on the Trading 212 pies.
- If there is no row yet: "No strategy data yet. Run the daily_services workflow." (legacy) or press Refresh (private).

## Behaviour

- Guest mode hides all four sections and shows "🔒 Sign in to view strategy recommendations".
- Nothing here is advice; each section states its basis.

## Tests

`tests/zk_strategy_test.mjs`, `tests/zk_flow_test.mjs`, `tests/zk_holding_value_test.mjs`, `tests/zk_shim_test.mjs` (Entry Analysis JSON regression).
