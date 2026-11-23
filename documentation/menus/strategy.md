# 🎯 Strategy

**Question it answers:** where is institutional money moving, what should I do with each holding, where is a good entry, and — when the market dips — where should the amount I choose go?

Tab id `strategy` · loader `loadStrategy()` · `docs/js/strategy.js`

The tab stacks six sections (each a collapsible card). The **💧 Dip Planner** sits at the top; there is no fixed budget anywhere on this tab.

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

### 🧪 5-check review (in every stock's expanded card: here, in Holding Decisions and in the [Watchlist](watchlist.md))

Each stock's card ends with a **5-check review** box: your own prompt (how the company makes money · why people keep buying and what is hard to copy · is the price fair against growth and profit · the 3 biggest risks · would a long-term holder still hold after a 30% fall, then bull case, bear case and a one-line verdict; no buy/sell call, "say so if you are not sure of a number") with **only the stock name and ticker filled in**.

- Buttons: **📋 Copy prompt** (clipboard, stays in the browser) and **ChatGPT · Claude · Grok**, each with a small letter badge (not the company's logo) that opens that assistant's own page (`chatgpt.com`, `claude.ai`, `grok.com`) with the prompt already in the box. Nothing leaves the page until you tap one. **Show the prompt** previews the exact text.
- CapitalLens does **not** run the prompt and adds no figures of its own: the answer is Claude's general knowledge, not live data, and the box says so, so check any number it gives.
- The text is fixed in `docs/js/fivecheck.js` (one place); the name and ticker are escaped and newlines stripped so a stock name can never add lines to the prompt. No inline handlers (one delegated click listener). Rolled out to every dashboard. If an assistant ignores the pre-filled text, Copy prompt and paste.
- Tests: `tests/zk_fivecheck_test.mjs` (prompt verbatim, escaping, copy and fallback, wiring on all five dashboards), `tests/fivecheck_layout_test.py` (320/360/390px, buttons ≥ 40px, copy + link carry the prompt), `tests/standards_test.py`.

## 3b. 🛡️ Support Levels (`#support-levels-content`, directly under Entry Analysis)

**Stocks you hold only.** For each held stock that has a support level on file: a card with the **zone** (e.g. META `$550–560`), the source's tags ("Crucial support zone", "200-week EMA", "Previous breakout"…), the **live price and how far it is from the zone**, the 52-week drawdown, and a short **commentary**; a **summary table** (stock · zone · live · status) closes the section. Cards are sorted most urgent first: below the zone, in the zone, approaching, above, no live price.

- **Type filter:** chips **All · Stocks · ETFs · Commodities** (with how many of each you hold) sit at the top of the section. **Stocks is the default**, so the section looks as before. The type comes from your Profit Booking row (stock, ETF, or an ETF whose sector or name is metals/commodities such as gold, silver, copper, oil, uranium; no row counts as a stock). Analyst levels exist for stocks only, so **ETFs and commodity funds get the computed 200-week EMA** (labelled computed), fetched the first time you pick that type (a spinner shows meanwhile) and cached for the page's life. A fund with under 200 weeks of price history shows no level and the section says how many had none. Listings on the London exchange are quoted in pence (shown as `2,500p`, never as pounds); Xetra and Amsterdam in euros; the quote currency from the price history decides, and the live price comes from the same series so level and price are always in the same unit. Not mapped: other exchanges.
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

## 0. 💧 Dip Planner (`#dip-planner-content`, top of the tab)

**No fixed budget.** You type what you want to invest (or tap £50 / £100 / £200 / £500) and press **Plan it**. The plan is worked out in the browser from the Entry Analysis rows, your pies and the market mood saved by the last Refresh; nothing is sent anywhere. Module `docs/js/dipplan.js` (`loadDipPlanner`, `dipPlanRun`, pure `dpPlanCompute`), rolled out to every dashboard.

1. **Is it a dip?** *Strong* (full amount used): market mood is Fear or Extreme fear (VIX 20+) or the S&P 500 is 8%+ below its high. *Moderate* (half used, half kept back): S&P 4–8% down, or 40%+ of your holdings 8%+ below their own highs. Otherwise **no dip: the cash is held** and the card says so. Tick **Plan it even if there is no market dip** to see where it would go anyway (labelled as not a dip signal).
2. **Score every stock 0–100** from seven signals: RSI 18, Momentum 12, Volume 10, Entry point 20, Dip depth 10, PE ratio 12, Quality score (Entry Analysis) 18. A signal with no data (for example no PE on an ETF) is left out and the rest re-weighted; the stock's chips show "n/a".
3. **Decide per stock:** 80+ strong buy, 72+ buy, 58+ accumulate, otherwise hold. **Overbought** (RSI 70+, or RSI 65+ at the 52-week high, or Entry Analysis "hold / avoid") is always hold: no new money.
4. **Decide per pie:** a pie is **INVEST** if at least one stock passes and its average score is 50+, otherwise **HOLD** with the reason. The money is split by buy strength; no pie gets more than 50% (65% when only two pies qualify). Holdings outside any pie are listed as "Not in a pie" and bought directly.
5. **Whole pie or custom balance:** if the signal-based split is within 15 points of the pie's own target weights, the card says *invest in the whole pie*; otherwise *custom balance* and names the stocks to favour and to skip. Each stock shows its target and current weight in the pie and both amounts (whole-pie £ and custom £). Amounts add up to the penny.
6. Each pie opens to its stocks with signal chips (green / amber / red), the score and the reason.

**Honesty:** prices, RSI, volume, momentum and PE are Yahoo daily data from the last Refresh (the card shows when, and warns after 3 days). **Fear & Greed is CapitalLens' own reading** (VIX, S&P drawdown and news headlines), not CNN's index. Pie weights come from your Trading 212 pies; if they cannot be found, equal weights are assumed and the card says so. It is a rule-based screen, not advice.

Data: `value_buy_scores.this_week` (now also carries `pe`, `fwd_pe`, `vol_ratio`, `mom_4w`, `mom_1w`, `t212`; written by `services/value_buy_service.py` and `docs/zk/valuebuy.js`, parity-tested), `portfolio_snapshots.raw.pies` (target and current weights), `strategy_recommendations.market_mood`.

## 4. Market mood and pace (`#strategy-content`)

- Stats: **Market mood** (😎 🙂 😨 😱 with VIX) and **Annualised** return versus the 10% base case / 15% optimistic case.
- The old weekly allocation tiles (week number, "This week £ of the monthly maximum"), the per-pie £ recommendation list and the allocator notes were removed from this tab (the fixed monthly budget is gone). The allocator still runs behind the scenes (`services/strategy_service.py`, browser `docs/zk/strategy.js`): its market mood feeds the Dip Planner and its weekly figure still sizes the [Watchlist](watchlist.md) pool.
- If there is no row yet the Dip Planner still works from the Entry Analysis rows and says there is no market reading yet.

## Behaviour

- Guest mode hides all the sections and shows "🔒 Sign in to view strategy recommendations".
- Nothing here is advice; each section states its basis.

## Tests

`tests/zk_strategy_test.mjs`, `tests/zk_flow_test.mjs`, `tests/zk_holding_value_test.mjs`, `tests/zk_shim_test.mjs` (Entry Analysis JSON regression), `tests/zk_support_levels_test.mjs` (Support Levels logic, stale warning, 200-week EMA, escaping, placement), `tests/zk_support_alert_test.mjs` (zone alerts), `tests/support_layout_test.py` (fits 320/360/390px, live and demo pages), `tests/zk_dipplan_test.mjs` (Dip Planner: signals, dip rules, pie/stock split to the penny, whole vs custom, escaping), `tests/dipplan_layout_test.py` (Dip Planner fits 320/360/390px, tap targets ≥ 40px).

## Bought so far this week (stored, no longer shown here)
The allocator still counts filled (and partly filled) Trading 212 **BUY** orders from Monday to today and from the 1st (`net_value`, the cash that left the account) into `strategy_recommendations.invested` (legacy/demo) or the encrypted row (private app), guarded by `tests/zk_strategy_test.mjs`. With the fixed budget gone the Strategy tab no longer compares it with a suggested amount; the purchases themselves are on the Positions tab under Recent purchases.
