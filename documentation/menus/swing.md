# ⚡ Swing (1–10 day trades)

**Question it answers:** is there a stock outside my pies with a valid entry *today*, where do I get out, and has this method actually been tested?

Tab id `swing` · loader `loadSwing()` · `docs/js/swing.js` · back-test `scripts/swing_backtest.mjs` · result `docs/data/swing_backtest.json`

## The one rule that matters

**No valid entry = no recommendation.** The card says **“No entry today”**. Nothing is shown as “watch”, “almost” or “wait for”, and doing nothing is a valid answer. **Nothing is recommended until the rules have been back-tested**: with no passing back-test the tab shows no entries at all, only the reason.

## Universe (what is scanned)

- **Your holdings that are not inside a pie** (Untagged / Individual) with an Entry Analysis score of **60+**.
- **Watchlist stocks** whose quality label is **Good**. ETFs, crypto and commodities are left out.
- Anything below the quality bar is listed under *Not checked*, with the reason. Pie holdings are never scanned.

## Entry rules (fixed, not tuned on the data)

All must be true: price above a **rising 50-day average** · RSI 70 or lower · not stretched far above the 20-day average · average daily turnover over 1 million · daily range 1–6% of price · volume data present (no volume = “cannot verify”, never an entry) · at least 60 daily bars.

Then one of two setups:

| Setup | Needs |
|---|---|
| **Pullback bounce** | RSI fell from 58+ to 35–55 · price at the 20/50-day zone · a green day back up on **at least normal volume** · room below the recent high for 1.5× the risk |
| **Breakout** | Close above the 20-day high on **1.5× volume**, not already more than 1 ATR past the level |

## Exit plan (shown with every entry)

- **Stop:** under the last 3 lows (never more than 3 ATR below the price; if it would be, there is no entry).
- **Target:** 2× the risk (2R).
- **Time exit:** the close of day 10 if neither is hit. Entry is skipped if the live price has already run more than half an ATR past the signal, or is through the stop.
- Type an **amount per trade** (no fixed budget) to see shares and the £ at risk to the stop.

## Validation box

Shows the latest back-test: all trades, **out-of-sample** (most recent 40% of dates, never tuned on) and a **random 10-day entry** baseline, after a 0.4% round-trip cost, next-day-open entries and stop-before-target. The tab opens its gate only if out-of-sample expectancy is **positive**, profit factor **≥ 1.2**, there are **150+ trades** (40+ out of sample) and it **beats the random entry**. Re-run weekly and on any rule change by the **Swing back-test** workflow.

## What it does not do (and says so)

Earnings dates are not checked (avoid holding through results) · the back-test uses today's liquid stocks, so survivorship bias flatters it · the quality screen has no history, so it is not in the back-test · live prices come from Yahoo daily data, refreshed on **Scan now**.

## Data

Daily candles `[time, open, high, low, close, volume]` come from the dashboard's `/chart` route (private app: the relay via `watchlistops.chart`; legacy: the worker's `/chart`). The **demo** has no volume candles, so every stock shows “data unverified” there.

Tests: `tests/zk_swing_test.mjs` (rules, exits, costs, no look-ahead, the gate) · `tests/swing_layout_test.py` (360/390px, gate closed / open / no entry).

## 🧪 Paper trading (fake money, under the Swing tab)

A **forward test**, not a recommendation. You type a **weekly amount** (there is no default) and two fake accounts get the same deposit every Monday-week:

| Account | What it does |
|---|---|
| **Trend account** | Buys that amount of a stock when the **Minervini trend template + 20-day breakout on 1.5× volume** fires on a completed day, **filled at the next session's open**, up to 5 at a time. Sells at the next open after a close under the **50-day average**, at once on a **15% fall**, or after 120 days |
| **World ETF** (`VWRP.L`) | Puts the same deposit into the ETF each week (the bar the trend account must beat) |

- **Honest fills:** signals use completed bars only; an order is cancelled if the open is above the entry ceiling (price ran away) or through the stop; every buy and sell pays **0.2%**. No real money, no orders are ever sent.
- **Catches up when opened:** nothing runs while the app is closed. Missed weeks are credited and the ETF is bought at that week's real open.
- **Universe:** the stocks the Swing tab scans (holdings outside pies and Good-quality watchlist stocks), so it only trades names you have. The demo has no volume candles, so the trend side shows no data there.
- **Why it exists:** the back-test of this strategy did **not** hold up on stocks it had not seen (`docs/data/swing_confirm.json`), so it is tested on real future prices first. Judge after **8–12 weeks and 20+ closed trades**.
- **Stored in the database:** the whole account is one JSON value under the key `__paper` in your `user_ui_prefs` row (per user, follows your login on the private app; browser-only on the legacy page, like the demo). Reset deletes it.

Tests: `tests/zk_paper_test.mjs` (deposits, next-open fills, fees, stop / 50-day / time exits, cancels, idempotent re-runs) · `tests/paper_layout_test.py`.
