# 🔬 Analyst

**Question it answers:** what do analysts think of what I hold, and what kind of stock is each one?

Tab id `analyst` · loader `loadAnalyst()` · `docs/js/analyst.js`

## Cards

| Card | What it shows |
|---|---|
| **Pie rating cards** (`#pie-ratings`) | One card per pie summarising the analyst consensus of its holdings |
| **Peter Lynch buckets** | Holdings grouped by Lynch's six categories, per pie, with a colour legend |
| **Full Analyst Ratings** (`#analyst-table-wrap`) | Table: every current holding with rating, target and the Lynch badge |

Only **current holdings** are listed (ratings are filtered to the latest snapshot's tickers).

## Peter Lynch buckets

| Bucket | Meaning |
|---|---|
| Fund / ETF | Not classified as a company |
| 1 Fast Grower | High growth |
| 2 Stalwart | Large, steady |
| 3 Cyclical | Moves with the economic cycle |
| 4 Slow Grower | Low growth, often dividends |
| 5 Turnaround | Recovering |
| 6 Asset Play | Value in assets |

The badge is a **rule-based estimate from public fundamentals** (growth, profit margin, book value, sector). Hover the badge for the reason and the confidence. A **screening aid, not advice**. `—` means "run Refresh to classify"; `?` means no data, and the hover says why.

## Data

- `analyst_ratings` (Yahoo Finance via `services/analyst_service.py`; in the private app `docs/zk/analystratings.js`), with Lynch columns added by `db/tenant/14_lynch_columns.sql`.
- The Lynch rules exist twice and are kept in step by a parity test: `services/lynch_service.py` and `docs/zk/lynch.js` (`tests/zk_lynch_parity_test.mjs`).

## Behaviour

Guest mode shows "🔒 Sign in to view analyst ratings". Missing ratings show as missing, never as a neutral rating.

## Tests

`tests/zk_analystratings_test.mjs`, `tests/zk_lynch_test.mjs`, `tests/zk_lynch_parity_test.mjs`.
